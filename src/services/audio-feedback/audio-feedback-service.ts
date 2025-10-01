import { randomUUID } from "crypto";
import { ConfigurationManager } from "../../config/configuration-manager";
import type {
  StateChangeEvent as ConversationStateChangeEvent,
} from "../../conversation/conversation-state-machine";
import { Logger } from "../../core/logger";
import type {
  AccessibilityProfile,
  AudioCueCategory,
  AudioCueHandle,
  AudioCueId,
  AudioCueRequest,
  AudioFeedbackConfig,
  AudioFeedbackControlMessage,
  AudioFeedbackEvent,
  AudioFeedbackMetrics,
  AudioFeedbackPanelAdapter,
  AudioFeedbackService,
  AudioFeedbackStateMessage,
} from "../../types/audio-feedback";

/**
 * Minimal disposable contract used to model configuration and event subscriptions.
 */
interface DisposableLike {
  dispose(): void;
}

/**
 * Tracks failed cue handles inside the degraded-mode evaluation window.
 */
interface FailureRecord {
  handleId: string;
  timestamp: number;
}

const MAX_CONCURRENT_CUES = 2;
const DEFAULT_FADE_OUT_MS = 250;

/**
 * Hosts audio feedback orchestration for the extension, coordinating cue scheduling,
 * degraded-mode handling, and telemetry across the extension host and webview player.
 */
export class AudioFeedbackServiceImpl implements AudioFeedbackService {
  private initialized = false;
  private config!: AudioFeedbackConfig;
  private readonly handles = new Map<string, AudioCueHandle>();
  private readonly activeHandleOrder: string[] = [];
  private readonly lastCategoryPlayback = new Map<AudioCueCategory, number>();
  private readonly failureHistory: FailureRecord[] = [];
  private degraded = false;
  private cooldownTimer: NodeJS.Timeout | undefined;
  private configDisposable: DisposableLike | undefined;
  private eventDisposable: DisposableLike | undefined;
  private lastStateCue: AudioCueId | undefined;

  private latencyTotal = 0;
  private playedCount = 0;
  private failureCount = 0;
  private suppressedCount = 0;
  private duckingEngagements = 0;
  private totalCues = 0;

  /**
   * Creates a new audio feedback service instance bound to configuration and panel adapters.
   *
   * @param configManager - Provides access to validated configuration and change notifications.
   * @param panel - Adapter used to send control/state messages to the webview player.
   * @param logger - Structured logger for diagnostics and telemetry.
   */
  constructor(
    private readonly configManager: ConfigurationManager,
    private readonly panel: AudioFeedbackPanelAdapter,
    private readonly logger: Logger,
  ) {}

  /**
   * Initializes the service by hydrating configuration, subscribing to changes, and wiring
   * event listeners for cue lifecycle notifications emitted by the webview.
   *
   * @throws Error when initialization prerequisites fail (surfaced via rejected promises).
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.config = this.configManager.getAudioFeedbackConfig();
    this.sendConfigureMessage();

    this.configDisposable = this.configManager.onConfigurationChanged(
      async (change) => {
        if (change.section === "audioFeedback") {
          this.applyConfiguration();
        }
      },
    );

    this.eventDisposable = this.panel.onAudioFeedbackEvent((message) => {
      this.handleWebviewEvent(message.payload);
    });

    this.initialized = true;
    this.logger.debug("Audio feedback service initialized", {
      enabled: this.config.enabled,
      profile: this.config.accessibilityProfile,
    });
  }

  /**
   * Disposes active subscriptions, timers, and tracked handles, returning the service to an
   * uninitialized state ready for garbage collection.
   */
  dispose(): void {
    this.configDisposable?.dispose();
    this.configDisposable = undefined;
    this.eventDisposable?.dispose();
    this.eventDisposable = undefined;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
    this.handles.clear();
    this.activeHandleOrder.length = 0;
    this.lastCategoryPlayback.clear();
    this.failureHistory.length = 0;
    this.initialized = false;
    this.degraded = false;
  }

  /**
   * Indicates whether {@link initialize} has already completed successfully.
   *
   * @returns True when the service is ready to schedule cues.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Schedules a cue for playback, applying psychoacoustic spacing, gain calculations, and
   * degraded-mode suppression before dispatching a play command to the webview.
   *
   * @param request - Cue metadata provided by callers.
   * @returns A handle representing the scheduled cue.
   */
  async playCue(request: AudioCueRequest): Promise<AudioCueHandle> {
    this.ensureInitialized();

    const handleId = randomUUID();
    const now = Date.now();
    const category = request.category;
    const handle: AudioCueHandle = {
      id: handleId,
      cueId: request.cueId,
      startedAt: now,
      status: "pending",
    };

    if (!this.config.enabled) {
      return this.markSuppressed(handle, "cues-disabled");
    }

    if (this.degraded) {
      return this.markSuppressed(handle, "degraded-mode-active");
    }

    const profile = request.accessibilityProfile ??
      this.config.accessibilityProfile;
    if (profile === "silent") {
      return this.markSuppressed(handle, "accessibility-silent");
    }

    const spacing = this.lastCategoryPlayback.get(category);
    if (spacing && now - spacing < this.config.psychoacousticSpacingMs) {
      return this.markSuppressed(handle, "psychoacoustic-spacing");
    }

    const gain = this.resolveGain(category, profile, request.gainOverride);
    if (gain <= 0) {
      return this.markSuppressed(handle, "gain-zero");
    }

    if (this.activeHandleOrder.length >= MAX_CONCURRENT_CUES) {
      const oldestId = this.activeHandleOrder.shift();
      if (oldestId) {
        await this.stopCue(oldestId);
      }
    }

    this.lastCategoryPlayback.set(category, now);
    this.handles.set(handleId, handle);
    this.activeHandleOrder.push(handleId);

    const duckStrategy =
      request.duckStrategy ?? this.config.defaultDucking ?? "none";
    this.totalCues += 1;
    if (duckStrategy !== "none") {
      this.duckingEngagements += 1;
    }

    const control: AudioFeedbackControlMessage = {
      type: "audioFeedback.control",
      payload: {
        command: "play",
        handleId,
        cueId: request.cueId,
        category,
        duckStrategy,
        accessibilityProfile: profile,
        gain,
        fadeOutMs: DEFAULT_FADE_OUT_MS,
      },
    };

    this.panel.sendAudioFeedbackControl(control);
    return handle;
  }

  /**
   * Requests that the webview stop the specified cue, e.g. when a newer cue preempts it.
   *
   * @param handleId - Identifier of the cue to stop.
   */
  async stopCue(handleId: string): Promise<void> {
    const handle = this.handles.get(handleId);
    if (!handle) {
      return;
    }
    if (handle.status === "stopped") {
      return;
    }
    const control: AudioFeedbackControlMessage = {
      type: "audioFeedback.control",
      payload: {
        command: "stop",
        handleId,
        reason: "host-request",
      },
    };
    this.panel.sendAudioFeedbackControl(control);
  }

  /**
   * Stops all currently tracked cues simultaneously.
   */
  async stopAllCues(): Promise<void> {
    const ids = Array.from(this.handles.keys());
    await Promise.all(ids.map((id) => this.stopCue(id)));
  }

  /**
   * Provides aggregated playback metrics for telemetry and diagnostics.
   *
   * @returns Calculated playback, failure, and ducking metrics.
   */
  getMetrics(): AudioFeedbackMetrics {
    const averageLatencyMs = this.playedCount
      ? this.latencyTotal / this.playedCount
      : 0;
    const duckingRatio = this.totalCues
      ? this.duckingEngagements / this.totalCues
      : 0;
    return {
      averageLatencyMs,
      playedCount: this.playedCount,
      failureCount: this.failureCount,
      suppressedCount: this.suppressedCount,
      duckingEngagementRatio: duckingRatio,
    };
  }

  /**
   * Indicates whether the service has entered degraded mode due to recent failures.
   *
   * @returns True when degraded mode is active.
   */
  isDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Reacts to conversation state transitions by triggering appropriate audio cues and managing
   * degraded-mode transitions based on recovery metadata.
   *
   * @param event - Conversation state change emitted by the state machine.
   */
  handleConversationStateChange(
    event: ConversationStateChangeEvent,
  ): void {
    const state = event.transition.to;
    let cueId: AudioCueId | undefined;
    let category: AudioCueCategory = "state";

    switch (state) {
      case "preparing":
        cueId = "session.start";
        category = "session";
        break;
      case "listening":
        cueId = "listening.prompt";
        break;
      case "processing":
      case "waitingForCopilot":
        cueId = "thinking.transition";
        break;
      case "speaking":
        cueId = "speaking.transition";
        break;
      case "interrupted":
        cueId = "interruption.detected";
        category = "state";
        break;
      case "faulted":
        cueId = "error.critical";
        category = "error";
        break;
      case "terminating":
      case "idle":
        cueId = "session.end";
        category = "session";
        break;
      default:
        break;
    }

    if (!cueId) {
      return;
    }

    if (cueId === this.lastStateCue && state !== "interrupted") {
      return;
    }

    this.lastStateCue = cueId;
    void this.playCue({ cueId, category }).catch((error) => {
      this.logger.warn("Failed to schedule audio cue", {
        cueId,
        error: error?.message ?? error,
      });
    });

    if (event.metadata?.circuitOpen) {
      this.enterDegradedMode("circuit-open");
    } else if (this.degraded && state === "listening") {
      this.exitDegradedMode("conversation-stable");
    }
  }

  /**
   * Synchronizes degraded-mode state with broader fallback notifications from other services.
   *
   * @param active - True when fallback mode is active.
   * @param reason - Optional explanation for logging and state propagation.
   */
  handleFallbackState(active: boolean, reason?: string): void {
    if (active) {
      this.enterDegradedMode(reason ?? "fallback-active");
      void this.playCue({
        cueId: "degraded.enter",
        category: "accessibility",
        duckStrategy: "none",
      }).catch(() => {
        /* swallow */
      });
    } else {
      this.exitDegradedMode(reason ?? "fallback-cleared");
      void this.playCue({
        cueId: "degraded.exit",
        category: "accessibility",
        duckStrategy: "none",
      }).catch(() => {
        /* swallow */
      });
    }
  }

  /**
   * Handles cue lifecycle notifications received from the webview player.
   *
   * @param event - Event payload describing the cue status.
   */
  private handleWebviewEvent(event: AudioFeedbackEvent): void {
    const handle = this.handles.get(event.handleId);
    if (!handle) {
      return;
    }

    handle.status = event.status as AudioCueHandle["status"];

    if (event.status === "played") {
      this.playedCount += 1;
      if (typeof event.latencyMs === "number") {
        this.latencyTotal += event.latencyMs;
      }
      this.removeHandle(handle.id);
      this.trimFailures(Date.now());
    } else if (event.status === "failed") {
      this.failureCount += 1;
      this.failureHistory.push({
        handleId: handle.id,
        timestamp: Date.now(),
      });
      this.removeHandle(handle.id);
      this.evaluateDegradedMode();
    } else if (event.status === "suppressed") {
      this.suppressedCount += 1;
      this.removeHandle(handle.id);
    } else if (event.status === "stopped") {
      this.removeHandle(handle.id);
    }
  }

  /**
   * Removes the provided handle from active tracking collections.
   *
  * @param handleId - Identifier for the handle to remove.
   */
  private removeHandle(handleId: string): void {
    this.handles.delete(handleId);
    const idx = this.activeHandleOrder.indexOf(handleId);
    if (idx >= 0) {
      this.activeHandleOrder.splice(idx, 1);
    }
  }

  /**
   * Resolves the final gain applied to a cue, factoring in profile adjustments and overrides.
   *
   * @param category - Cue category used for base gain lookup.
   * @param profile - Accessibility profile in effect.
   * @param override - Optional caller-specified gain.
   * @returns A normalized gain multiplier.
   */
  private resolveGain(
    category: AudioCueCategory,
    profile: AccessibilityProfile,
    override?: number,
  ): number {
    if (typeof override === "number") {
      return Math.max(0, override);
    }
    const base = this.config.categoryGains[category] ?? 1;
    switch (profile) {
      case "high-contrast":
        return Math.min(base * 1.25, 2);
      case "silent":
        return 0;
      default:
        return base;
    }
  }

  /**
   * Ensures consumers initialize the service before invoking public APIs.
   *
   * @throws Error when called before {@link initialize} completes.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("AudioFeedbackService has not been initialized");
    }
  }

  /**
   * Applies refreshed configuration settings and propagates updates to the webview.
   */
  private applyConfiguration(): void {
    this.config = this.configManager.getAudioFeedbackConfig();
    this.logger.debug("Audio feedback configuration updated", {
      enabled: this.config.enabled,
      profile: this.config.accessibilityProfile,
      ducking: this.config.defaultDucking,
    });
    this.sendConfigureMessage();
    if (!this.config.enabled) {
      void this.stopAllCues();
    }
  }

  /**
   * Sends the latest configuration and degraded-state snapshot to the webview player.
   */
  private sendConfigureMessage(): void {
    const control: AudioFeedbackControlMessage = {
      type: "audioFeedback.control",
      payload: {
        command: "configure",
        accessibilityProfile: this.config.accessibilityProfile,
        duckStrategy: this.config.defaultDucking,
        categoryGains: this.config.categoryGains,
      },
    };

    this.panel.sendAudioFeedbackControl(control);
    const statePayload: AudioFeedbackStateMessage["payload"] = {
      degraded: this.degraded,
      reason: this.degraded ? "degraded-mode-active" : undefined,
    };
    this.panel.sendAudioFeedbackState(statePayload);
  }

  /**
   * Removes failure records that are older than the degraded-mode evaluation window.
   *
   * @param now - Current timestamp in milliseconds.
   */
  private trimFailures(now: number): void {
    const windowMs = this.config.degradedMode.windowMs;
    while (this.failureHistory.length) {
      const record = this.failureHistory[0];
      if (now - record.timestamp > windowMs) {
        this.failureHistory.shift();
      } else {
        break;
      }
    }
  }

  /**
   * Evaluates whether repeated failures should enter degraded mode.
   */
  private evaluateDegradedMode(): void {
    const now = Date.now();
    this.trimFailures(now);
    if (
      this.failureHistory.length >= this.config.degradedMode.failureThreshold
    ) {
      this.enterDegradedMode("failure-threshold");
    }
  }

  /**
   * Enables degraded mode, stops active cues, and starts the cooldown timer.
   *
   * @param reason - Explanation recorded in logs and state notifications.
   */
  private enterDegradedMode(reason: string): void {
    if (this.degraded) {
      return;
    }
    this.degraded = true;
    this.logger.warn("Audio feedback entering degraded mode", { reason });
    this.panel.sendAudioFeedbackState({ degraded: true, reason });
    void this.stopAllCues();
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }
    this.cooldownTimer = setTimeout(() => {
      this.exitDegradedMode("cooldown-expired");
    }, this.config.degradedMode.cooldownMs);
  }

  /**
   * Restores normal operation from degraded mode and clears failure history.
   *
   * @param reason - Explanation recorded in logs and state notifications.
   */
  private exitDegradedMode(reason: string): void {
    if (!this.degraded) {
      return;
    }
    this.degraded = false;
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = undefined;
    }
    this.failureHistory.length = 0;
    this.logger.info("Audio feedback recovered from degraded mode", {
      reason,
    });
    this.panel.sendAudioFeedbackState({ degraded: false, reason });
  }

  /**
   * Records a cue as suppressed, avoiding playback while updating metrics.
   *
   * @param handle - Handle representing the suppressed cue.
   * @param reason - Explanation logged for diagnostics.
   * @returns The updated handle with suppressed status.
   */
  private markSuppressed(
    handle: AudioCueHandle,
    reason: string,
  ): AudioCueHandle {
    this.suppressedCount += 1;
    handle.status = "suppressed";
    this.logger.debug("Audio cue suppressed", {
      cueId: handle.cueId,
      reason,
    });
    return handle;
  }
}

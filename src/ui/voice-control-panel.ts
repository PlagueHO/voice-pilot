import * as vscode from "vscode";
import type { ServiceInitializable } from "../core/service-initializable";
import type {
  AudioFeedbackControlMessage,
  AudioFeedbackEventMessage,
  AudioFeedbackPanelAdapter,
  AudioFeedbackStateMessage,
} from "../types/audio-feedback";
import type { TurnEventDiagnostics } from "../types/conversation";
import { renderVoiceControlPanelHtml } from "./templates/voice-control-panel.html";
import {
  createInitialPanelState,
  deriveMicrophoneStatusFromState,
  ensureEntryId,
  isSessionActive,
  MicrophoneStatus,
  PanelActionMessage,
  PanelFeedbackMessage,
  PanelInboundMessage,
  PanelOutboundMessage,
  PanelStatus,
  TranscriptEntry,
  UserFacingError,
  VoiceControlPanelState,
  withTranscriptAppend,
  withTranscriptCommit,
} from "./voice-control-state";

type PanelAction = PanelActionMessage["action"];
export type PanelActionHandler = (action: PanelAction) => Promise<void> | void;
type PanelFeedbackHandler = (message: PanelFeedbackMessage) => void;

interface SessionUpdatePayload {
  sessionId?: string | null;
  status?: PanelStatus;
  statusLabel?: string;
  statusMode?: string | null;
  statusDetail?: string | null;
  fallbackActive?: boolean;
  sessionStartedAt?: string | null;
  elapsedSeconds?: number | null;
  renewalCountdownSeconds?: number | null;
  diagnostics?: TurnEventDiagnostics | null;
  error?: UserFacingError | null;
}

interface TurnStatusUpdateOptions {
  mode?: string | null;
  fallback?: boolean;
  detail?: string | null;
  status?: PanelStatus;
  error?: UserFacingError | null;
}

/**
 * Provides the VoicePilot control surface within the VS Code sidebar.
 *
 * @remarks
 * The panel maintains its own UI state and communicates with the webview via
 * structured messages. It queues outbound messages until the webview becomes
 * visible to avoid race conditions during activation.
 */
export class VoiceControlPanel
  implements
    ServiceInitializable,
    vscode.WebviewViewProvider,
    AudioFeedbackPanelAdapter
{
  public static readonly viewType = "voicepilot.voiceControl";

  private readonly actionHandlers = new Set<PanelActionHandler>();
  private readonly feedbackHandlers = new Set<PanelFeedbackHandler>();
  private readonly pendingMessages: PanelOutboundMessage[] = [];
  private readonly audioFeedbackHandlers = new Set<
    (message: AudioFeedbackEventMessage) => void
  >();

  private initialized = false;
  private visible = false;
  private registration?: vscode.Disposable;
  private currentView?: vscode.WebviewView;
  private state: VoiceControlPanelState = createInitialPanelState();

  /**
   * Creates a new panel instance bound to the given extension context.
   *
   * @param context - VS Code extension context used for resource resolution and lifecycle tracking.
   */
  constructor(private readonly context: vscode.ExtensionContext) {}

  /** @inheritdoc */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.registration = vscode.window.registerWebviewViewProvider(
      VoiceControlPanel.viewType,
      this,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    );
    this.initialized = true;
  }

  /** @inheritdoc */
  dispose(): void {
    this.registration?.dispose();
    this.registration = undefined;
    this.currentView = undefined;
    this.pendingMessages.length = 0;
    this.actionHandlers.clear();
    this.feedbackHandlers.clear();
    this.audioFeedbackHandlers.clear();
    this.initialized = false;
    this.visible = false;
  }

  /**
   * Indicates whether the panel has been registered with VS Code.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Determines whether the panel is currently visible to the user.
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Reveals the panel, optionally avoiding focus transfer.
   *
   * @param preserveFocus - When true, keeps the existing editor focus.
   */
  async show(preserveFocus = false): Promise<void> {
    await this.reveal(preserveFocus);
  }

  /**
   * Reveals the view within the VoicePilot sidebar container.
   *
   * @param preserveFocus - When true, avoids shifting focus to the panel.
   */
  async reveal(preserveFocus = false): Promise<void> {
    this.visible = true;

    if (this.currentView) {
      try {
        this.currentView.show?.(preserveFocus);
      } catch (error) {
        console.warn(
          "VoicePilot: Failed to reveal voice control panel view",
          error,
        );
      }
      return;
    }

    try {
      await vscode.commands.executeCommand(
        "workbench.view.extension.voicepilot",
      );
    } catch (error) {
      console.warn(
        "VoicePilot: Failed to execute reveal command for panel",
        error,
      );
    }
  }

  /**
   * Registers a callback for panel-triggered actions (e.g., user clicks).
   *
   * @param handler - Callback invoked with the action identifier.
   * @returns Disposable for unregistering the handler.
   */
  onAction(handler: PanelActionHandler): vscode.Disposable {
    this.actionHandlers.add(handler);
    return new vscode.Disposable(() => this.actionHandlers.delete(handler));
  }

  /**
   * Registers a listener for feedback events emitted by the webview UI.
   *
   * @param handler - Callback receiving raw feedback payloads.
   * @returns Disposable for unregistering the handler.
   */
  onFeedback(handler: PanelFeedbackHandler): vscode.Disposable {
    this.feedbackHandlers.add(handler);
    return new vscode.Disposable(() => this.feedbackHandlers.delete(handler));
  }

  sendAudioFeedbackControl(message: AudioFeedbackControlMessage): void {
    this.enqueueMessage(message);
  }

  sendAudioFeedbackState(payload: AudioFeedbackStateMessage["payload"]): void {
    this.enqueueMessage({
      type: "audioFeedback.state",
      payload,
    });
  }

  onAudioFeedbackEvent(
    handler: (message: AudioFeedbackEventMessage) => void,
  ): vscode.Disposable {
    this.audioFeedbackHandlers.add(handler);
    return new vscode.Disposable(() => {
      this.audioFeedbackHandlers.delete(handler);
    });
  }

  /**
   * Clears the current pending action and notifies the webview.
   */
  acknowledgeAction(): void {
    if (!this.state.pendingAction) {
      return;
    }
    this.state = {
      ...this.state,
      pendingAction: null,
    };
    this.sendSessionUpdate();
    this.flushPendingMessages();
  }

  /**
   * Applies a partial session update from the session manager.
   *
   * @param update - Payload describing updated session properties.
   */
  updateSession(update: SessionUpdatePayload): void {
    const nextStatus = update.status ?? this.state.status;
    const nextLabel = update.statusLabel ?? this.deriveStatusLabel(nextStatus);

    const nextState: VoiceControlPanelState = {
      ...this.state,
      sessionId:
        update.sessionId === null
          ? undefined
          : (update.sessionId ?? this.state.sessionId),
      sessionStartedAt:
        update.sessionStartedAt === null
          ? undefined
          : (update.sessionStartedAt ?? this.state.sessionStartedAt),
      elapsedSeconds:
        update.elapsedSeconds === null
          ? undefined
          : (update.elapsedSeconds ?? this.state.elapsedSeconds),
      renewalCountdownSeconds:
        update.renewalCountdownSeconds === null
          ? undefined
          : (update.renewalCountdownSeconds ??
            this.state.renewalCountdownSeconds),
      status: nextStatus,
      statusLabel: nextLabel,
      statusMode:
        update.statusMode === null
          ? undefined
          : (update.statusMode ?? this.state.statusMode),
      statusDetail:
        update.statusDetail === null
          ? undefined
          : (update.statusDetail ?? this.state.statusDetail),
      fallbackActive:
        typeof update.fallbackActive === "boolean"
          ? update.fallbackActive
          : this.state.fallbackActive,
      diagnostics:
        update.diagnostics === null
          ? undefined
          : (update.diagnostics ?? this.state.diagnostics),
      errorBanner:
        update.error === undefined
          ? this.state.errorBanner
          : (update.error ?? undefined),
      pendingAction: null,
    };

    if (nextState.status !== "error" && !nextState.errorBanner) {
      nextState.errorBanner = undefined;
    }

    if (!isSessionActive(nextState)) {
      nextState.fallbackActive = false;
      if (nextState.statusMode === "Fallback Mode") {
        nextState.statusMode = undefined;
      }
    }

    const previousMic = this.state.microphoneStatus;
    this.state = nextState;
    this.refreshMicrophoneState(previousMic);
    this.sendSessionUpdate();
    this.flushPendingMessages();
  }

  /**
   * Updates the panel status and optional error banner.
   *
   * @param status - New status to display.
   * @param error - Optional error metadata to surface.
   */
  setStatus(status: PanelStatus, error?: UserFacingError | null): void {
    this.updateSession({
      status,
      statusLabel: this.deriveStatusLabel(status),
      error: error ?? (status === "error" ? this.state.errorBanner : null),
    });
  }

  /**
   * Shows or clears the persistent error banner.
   *
   * @param error - Error details to display; omit to clear the banner.
   */
  setErrorBanner(error?: UserFacingError | null): void {
    const status = error
      ? "error"
      : this.state.status === "error"
        ? "ready"
        : this.state.status;
    const label = error
      ? "Needs Attention"
      : this.state.status === "error"
        ? this.deriveStatusLabel(status)
        : this.state.statusLabel;

    this.updateSession({
      status,
      statusLabel: label,
      error: error ?? null,
    });
  }

  /**
   * Adds a transcript entry to the panel, generating identifiers as needed.
   *
   * @param entry - Transcript entry emitted by the conversation pipeline.
   */
  appendTranscript(entry: TranscriptEntry): void {
    const normalizedEntry: TranscriptEntry = {
      ...entry,
      entryId: ensureEntryId(entry),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };

    const { state, truncated } = withTranscriptAppend(
      this.state,
      normalizedEntry,
    );
    this.state = state;

    this.enqueueMessage({
      type: "transcript.append",
      entry: normalizedEntry,
    });

    if (truncated) {
      this.enqueueMessage({ type: "transcript.truncated" });
    }

    this.flushPendingMessages();
  }

  /**
   * Finalizes a transcript entry so the UI can render committed content.
   *
   * @param entryId - Identifier of the entry to update.
   * @param content - Finalized transcript text.
   * @param confidence - Optional confidence score for the entry.
   */
  commitTranscriptEntry(
    entryId: string,
    content: string,
    confidence?: number,
  ): void {
    this.state = withTranscriptCommit(this.state, entryId, content, confidence);
    this.enqueueMessage({
      type: "transcript.commit",
      entryId,
      content,
      confidence,
    });
    this.flushPendingMessages();
  }

  /**
   * Removes a transcript entry if it exists.
   *
   * @param entryId - Identifier of the entry to remove.
   */
  removeTranscriptEntry(entryId: string): void {
    if (!entryId) {
      return;
    }
    const nextEntries = this.state.transcript.filter(
      (entry) => entry.entryId !== entryId,
    );
    if (nextEntries.length === this.state.transcript.length) {
      return;
    }
    this.state = {
      ...this.state,
      transcript: nextEntries,
    };
    this.enqueueMessage({
      type: "transcript.remove",
      entryId,
    });
    this.flushPendingMessages();
  }

  /**
   * Sets the microphone status and broadcasts the change to the webview.
   *
   * @param status - New microphone status to publish.
   */
  setMicrophoneStatus(status: MicrophoneStatus): void {
    this.state = {
      ...this.state,
      microphoneStatus: status,
    };
    this.sendAudioStatus();
    this.flushPendingMessages();
  }

  /**
   * Flags whether the Copilot backend is reachable.
   *
   * @param available - True when Copilot services are available.
   */
  setCopilotAvailable(available: boolean): void {
    if (this.state.copilotAvailable === available) {
      return;
    }
    this.state = {
      ...this.state,
      copilotAvailable: available,
    };
    this.sendCopilotAvailability();
    this.flushPendingMessages();
  }

  /**
   * Toggles fallback mode visuals for degraded experiences.
   *
   * @param active - Indicates whether fallback mode is active.
   * @param reason - Optional detail explaining the fallback state.
   */
  setFallbackState(active: boolean, reason?: string): void {
    const priorMode = this.state.statusMode;
    const priorDetail = this.state.statusDetail;

    const detail = reason ? `Fallback: ${reason}` : priorDetail;
    const statusMode = active
      ? "Fallback Mode"
      : priorMode === "Fallback Mode"
        ? undefined
        : priorMode;
    const statusDetail = active
      ? detail
      : priorMode === "Fallback Mode"
        ? undefined
        : priorDetail;

    this.state = {
      ...this.state,
      fallbackActive: active,
      statusMode,
      statusDetail,
    };

    this.sendSessionUpdate();
    this.flushPendingMessages();
  }

  /**
   * Updates diagnostic telemetry displayed within the panel.
   *
   * @param diagnostics - Optional diagnostics payload; omit to clear.
   */
  updateDiagnostics(diagnostics?: TurnEventDiagnostics | null): void {
    this.state = {
      ...this.state,
      diagnostics: diagnostics ?? undefined,
    };
    this.sendSessionUpdate();
    this.flushPendingMessages();
  }

  /**
   * Presents a status label describing the current conversational turn.
   *
   * @param label - Human-readable label to show in the panel.
   * @param options - Optional overrides for status metadata.
   */
  updateTurnStatus(label: string, options: TurnStatusUpdateOptions = {}): void {
    const normalizedLabel = label?.trim() ?? this.state.statusLabel;
    const derivedStatus =
      options.status ??
      this.mapLabelToStatus(normalizedLabel) ??
      this.state.status;
    const errorBanner =
      options.error === undefined
        ? this.state.errorBanner
        : (options.error ?? undefined);

    const statusMode =
      options.mode === null
        ? undefined
        : typeof options.mode === "string"
          ? options.mode
          : this.state.statusMode;

    const statusDetail =
      options.detail === null
        ? undefined
        : typeof options.detail === "string"
          ? options.detail
          : this.state.statusDetail;

    const fallbackActive =
      typeof options.fallback === "boolean"
        ? options.fallback
        : this.state.fallbackActive;

    const nextState: VoiceControlPanelState = {
      ...this.state,
      status: derivedStatus,
      statusLabel: normalizedLabel,
      statusMode,
      statusDetail,
      fallbackActive,
      errorBanner,
      pendingAction: null,
    };

    if (nextState.status !== "error" && !nextState.errorBanner) {
      nextState.errorBanner = undefined;
    }

    const previousMic = this.state.microphoneStatus;
    this.state = nextState;
    this.refreshMicrophoneState(previousMic);
    this.sendSessionUpdate();
    this.flushPendingMessages();
  }

  /**
   * Called by VS Code when the webview is created or rehydrated.
   *
   * @param webviewView - The webview host that renders the panel UI.
   */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.currentView = webviewView;
    this.visible = webviewView.visible || this.visible;

    const webview = webviewView.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webview.html = renderVoiceControlPanelHtml({
      webview,
      extensionUri: this.context.extensionUri,
      state: this.state,
      nonce: this.createNonce(),
    });

    const messageSubscription = webview.onDidReceiveMessage((message) => {
      this.handleInboundMessage(message as PanelInboundMessage);
    });

    const visibilitySubscription = webviewView.onDidChangeVisibility(() => {
      this.visible = webviewView.visible;
      if (webviewView.visible) {
        this.flushPendingMessages();
      }
    });

    webviewView.onDidDispose(() => {
      messageSubscription.dispose();
      visibilitySubscription.dispose();
      if (this.currentView === webviewView) {
        this.currentView = undefined;
      }
      this.visible = false;
    });

    this.sendInitializeMessage();
    this.sendSessionUpdate();
    this.sendAudioStatus();
    this.sendCopilotAvailability();
    this.flushPendingMessages();
  }

  private handleInboundMessage(message: PanelInboundMessage): void {
    if (!message || typeof message.type !== "string") {
      return;
    }

    switch (message.type) {
      case "panel.action":
        void this.dispatchAction(message);
        break;
      case "panel.feedback":
        this.feedbackHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (error) {
            console.warn("VoicePilot: Feedback handler failed", error);
          }
        });
        break;
      case "audioFeedback.event":
        this.audioFeedbackHandlers.forEach((handler) => {
          try {
            handler(message);
          } catch (error) {
            console.warn("VoicePilot: Audio feedback handler failed", error);
          }
        });
        break;
      default:
        break;
    }
  }

  private async dispatchAction(message: PanelActionMessage): Promise<void> {
    if (!this.actionHandlers.size) {
      return;
    }

    const { action } = message;
    this.state = {
      ...this.state,
      pendingAction: action,
    };
    this.sendSessionUpdate();
    this.flushPendingMessages();

    const handlers = Array.from(this.actionHandlers);
    try {
      await Promise.all(
        handlers.map((handler) => Promise.resolve(handler(action))),
      );
      this.acknowledgeAction();
    } catch (error: unknown) {
      const messageText =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      this.setErrorBanner({
        code: "panel-action-failed",
        summary: "Action failed to complete",
        remediation: messageText,
      });
    }
  }

  private sendInitializeMessage(): void {
    this.enqueueMessage({
      type: "panel.initialize",
      state: this.state,
    });
  }

  private sendSessionUpdate(): void {
    this.enqueueMessage({
      type: "session.update",
      sessionId: this.state.sessionId,
      status: this.state.status,
      statusLabel: this.state.statusLabel,
      statusMode: this.state.statusMode,
      statusDetail: this.state.statusDetail,
      fallbackActive: this.state.fallbackActive,
      sessionStartedAt: this.state.sessionStartedAt,
      elapsedSeconds: this.state.elapsedSeconds,
      renewalCountdownSeconds: this.state.renewalCountdownSeconds,
      diagnostics: this.state.diagnostics,
      error: this.state.errorBanner ?? undefined,
    });
  }

  private sendAudioStatus(): void {
    this.enqueueMessage({
      type: "audio.status",
      microphoneStatus: this.state.microphoneStatus,
    });
  }

  private sendCopilotAvailability(): void {
    this.enqueueMessage({
      type: "copilot.availability",
      available: this.state.copilotAvailable,
    });
  }

  private enqueueMessage(message: PanelOutboundMessage): void {
    this.pendingMessages.push(message);
    this.flushPendingMessages();
  }

  private flushPendingMessages(): void {
    if (!this.currentView) {
      return;
    }

    const webview = this.currentView.webview;
    while (this.pendingMessages.length > 0) {
      const next = this.pendingMessages.shift()!;
      void webview.postMessage(next);
    }
  }

  private refreshMicrophoneState(previousStatus: MicrophoneStatus): void {
    const derived = deriveMicrophoneStatusFromState(this.state);
    if (derived === this.state.microphoneStatus) {
      return;
    }

    const autoManaged: MicrophoneStatus[] = ["idle", "capturing", "muted"];
    if (!autoManaged.includes(previousStatus)) {
      return;
    }

    this.state = {
      ...this.state,
      microphoneStatus: derived,
    };
    this.sendAudioStatus();
  }

  private deriveStatusLabel(status: PanelStatus): string {
    switch (status) {
      case "listening":
        return "Listening";
      case "thinking":
        return "Thinking";
      case "speaking":
        return "Speaking";
      case "error":
        return "Needs Attention";
      case "copilot-unavailable":
        return "Copilot Unavailable";
      case "ready":
      default:
        return "Ready";
    }
  }

  private mapLabelToStatus(label: string): PanelStatus | undefined {
    const normalized = label.trim().toLowerCase();
    switch (normalized) {
      case "ready":
      case "idle":
      case "standby":
        return "ready";
      case "listening":
      case "capturing":
        return "listening";
      case "thinking":
      case "processing":
      case "waiting for copilot":
      case "preparing":
        return "thinking";
      case "speaking":
      case "responding":
        return "speaking";
      case "copilot unavailable":
      case "copilot offline":
        return "copilot-unavailable";
      case "needs attention":
      case "interrupted":
      case "error":
        return "error";
      default:
        return undefined;
    }
  }

  private createNonce(): string {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i += 1) {
      nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return nonce;
  }
}

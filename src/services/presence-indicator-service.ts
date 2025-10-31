import * as vscode from "vscode";
import ConversationStateMachine, {
    ConversationState,
    StateChangeEvent as ConversationStateChangeEvent,
    TurnEvent as ConversationTurnEvent,
} from "../conversation/conversation-state-machine";
import { Logger } from "../core/logger";
import {
    PRESENCE_BATCH_WINDOW_MS,
    PresenceDetails,
    PresenceStateDescriptor,
    PresenceUpdate,
    AgentVoicePresenceState,
    isPresenceStateEqual,
    normalizePresenceState,
    resolvePresenceDescriptor,
} from "../types/presence";
import {
    SessionDiagnostics,
    SessionError,
    SessionErrorEvent,
    SessionEvent,
    SessionManager,
    SessionRenewalEvent,
    SessionState,
    SessionStateEvent,
} from "../types/session";

/**
 * Configuration for {@link PresenceIndicatorService} controlling logging and batching behavior.
 */
export interface PresenceIndicatorServiceOptions {
  /** Logger used for diagnostic output. */
  logger: Logger;
  /** Optional override for the debounce window used to batch presence updates. */
  batchWindowMs?: number;
  /** Optional threshold for emitting latency warnings when batching takes too long. */
  latencyWarningMs?: number;
}

const DEFAULT_LATENCY_WARNING_MS = 150;

/**
 * Publishes aggregated presence updates reflecting session, conversation, and Copilot availability state.
 */
export class PresenceIndicatorService implements vscode.Disposable {
  public readonly onDidChangePresence: vscode.Event<PresenceUpdate>;

  private readonly emitter = new vscode.EventEmitter<PresenceUpdate>();
  private readonly logger: Logger;
  private readonly batchWindowMs: number;
  private readonly latencyWarningMs: number;

  private sessionManager?: SessionManager;

  private conversationState: ConversationState = "idle";
  private currentTurnId: string | undefined;

  private sessionState: SessionState = SessionState.Idle;
  private sessionId: string | undefined;
  private sessionDiagnostics: SessionDiagnostics | undefined;
  private lastSessionError: SessionError | undefined;
  private renewalInProgress = false;

  private copilotAvailable = true;

  private flushHandle: NodeJS.Timeout | undefined;
  private pendingSince = 0;
  private lastPresence: PresenceUpdate | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;

  /**
   * Creates a new presence indicator service using the provided options.
   *
   * @param options - Logger configuration along with optional batching overrides.
   */
  constructor(options: PresenceIndicatorServiceOptions) {
    this.logger = options.logger;
    this.batchWindowMs = options.batchWindowMs ?? PRESENCE_BATCH_WINDOW_MS;
    this.latencyWarningMs =
      options.latencyWarningMs ?? DEFAULT_LATENCY_WARNING_MS;
    this.onDidChangePresence = this.emitter.event;
  }

  /**
   * Registers listeners on the session manager to track activation, state, and errors.
   *
   * @param manager - Session manager responsible for connection lifecycle.
   * @returns Disposable that removes subscriptions when invoked.
   */
  bindSessionManager(manager: SessionManager): vscode.Disposable {
    this.ensureNotDisposed();
    this.sessionManager = manager;

    const subscriptions: vscode.Disposable[] = [];

    subscriptions.push(
      manager.onSessionStarted(async (event: SessionEvent) => {
        await this.handleSessionEvent(event);
      }),
    );

    subscriptions.push(
      manager.onSessionEnded(async (event: SessionEvent) => {
        await this.handleSessionEvent(event);
      }),
    );

    subscriptions.push(
      manager.onSessionStateChanged(async (event: SessionStateEvent) => {
        await this.handleSessionStateChange(event);
      }),
    );

    subscriptions.push(
      manager.onSessionRenewed(async (event: SessionRenewalEvent) => {
        await this.handleSessionRenewal(event);
      }),
    );

    subscriptions.push(
      manager.onSessionError(async (event: SessionErrorEvent) => {
        await this.handleSessionErrorEvent(event);
      }),
    );

    const disposable = new vscode.Disposable(() => {
      subscriptions.forEach((sub) => sub.dispose());
    });

    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Registers listeners on the conversation state machine for state and turn updates.
   *
   * @param machine - Conversation state machine to observe.
   * @returns Disposable that tears down associated subscriptions.
   */
  bindConversationMachine(
    machine: ConversationStateMachine,
  ): vscode.Disposable {
    this.ensureNotDisposed();


    const stateSub = machine.onStateChanged((event) => {
      this.handleConversationStateChange(event);
    });

    const turnSub = machine.onTurnEvent((event) => {
      this.handleConversationTurnEvent(event);
    });

    const disposable = new vscode.Disposable(() => {
      stateSub.dispose();
      turnSub.dispose();
    });

    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Updates whether GitHub Copilot is available within the environment and triggers re-evaluation.
   *
   * @param available - Indicates Copilot extension availability.
   */
  setCopilotAvailability(available: boolean): void {
    if (this.copilotAvailable === available) {
      return;
    }
    this.copilotAvailable = available;
    this.logger.debug("PresenceIndicator: Copilot availability changed", {
      available,
    });
    this.scheduleEmit();
  }

  /**
   * Forces any pending presence state to emit immediately, bypassing the batching delay.
   */
  requestImmediateEmit(): void {
    this.ensureNotDisposed();
    if (this.flushHandle) {
      clearTimeout(this.flushHandle);
      this.flushHandle = undefined;
    }
    if (!this.pendingSince) {
      this.pendingSince = Date.now();
    }
    this.flushPresenceUpdate();
  }

  /**
   * Handles session lifecycle events to maintain presence state and diagnostics context.
   *
   * @param event - Session event describing start or end changes.
   */
  async handleSessionEvent(event: SessionEvent): Promise<void> {
    if (event.type === "started") {
      this.sessionId = event.sessionId;
      this.sessionState = event.sessionInfo.state;
      this.sessionDiagnostics = this.captureDiagnostics(event.sessionId);
      this.renewalInProgress = false;
      this.lastSessionError = undefined;
      this.logger.debug("PresenceIndicator: session started", {
        sessionId: event.sessionId,
      });
    } else if (event.type === "ended") {
      if (this.sessionId === event.sessionId) {
        this.sessionState = SessionState.Idle;
        this.sessionId = undefined;
        this.sessionDiagnostics = undefined;
        this.renewalInProgress = false;
        this.lastSessionError = undefined;
        this.logger.debug("PresenceIndicator: session ended", {
          sessionId: event.sessionId,
        });
      }
    }
    this.scheduleEmit();
  }

  /**
   * Processes session state transitions to synchronize diagnostics and error recovery flags.
   *
   * @param event - State transition payload from the session manager.
   */
  async handleSessionStateChange(event: SessionStateEvent): Promise<void> {
    this.sessionId = event.sessionId;
    this.sessionState = event.newState;
    this.sessionDiagnostics =
      event.diagnostics ?? this.captureDiagnostics(event.sessionId);

    if (
      event.newState === SessionState.Renewing ||
      event.newState === SessionState.Paused
    ) {
      this.renewalInProgress = true;
    } else if (
      event.newState === SessionState.Active ||
      event.newState === SessionState.Starting
    ) {
      this.renewalInProgress = false;
      this.lastSessionError = undefined;
    } else if (event.newState === SessionState.Failed) {
      if (!this.lastSessionError) {
        this.lastSessionError = {
          code: "SESSION_FAILED",
          message: event.reason,
          isRetryable: false,
          remediation: "Check session diagnostics",
          timestamp: event.timestamp,
        };
      }
    }

    this.logger.debug("PresenceIndicator: session state transition", {
      sessionId: event.sessionId,
      previous: event.previousState,
      next: event.newState,
      reason: event.reason,
    });

    this.scheduleEmit();
  }

  /**
   * Responds to session renewal progress, updating diagnostics and stored errors.
   *
   * @param event - Renewal lifecycle event emitted by the session manager.
   */
  async handleSessionRenewal(event: SessionRenewalEvent): Promise<void> {
    if (event.type === "renewal-started") {
      this.renewalInProgress = true;
    } else {
      this.renewalInProgress = false;
    }

    this.sessionDiagnostics =
      event.diagnostics ??
      (event.sessionId
        ? this.captureDiagnostics(event.sessionId)
        : this.sessionDiagnostics);

    if (event.error) {
      this.lastSessionError = event.error;
    } else if (event.type === "renewal-completed") {
      this.lastSessionError = undefined;
    }

    this.logger.debug("PresenceIndicator: renewal event", {
      sessionId: event.sessionId,
      type: event.type,
      success: event.result?.success,
      latencyMs: event.result?.latencyMs,
    });

    this.scheduleEmit();
  }

  /**
   * Captures session error events and triggers an updated presence notification.
   *
   * @param event - Error payload emitted by the session manager.
   */
  async handleSessionErrorEvent(event: SessionErrorEvent): Promise<void> {
    this.lastSessionError = event.error;
    this.logger.warn("PresenceIndicator: session error received", {
      sessionId: event.sessionId,
      error: event.error.code,
    });
    this.scheduleEmit();
  }

  /**
   * Updates internal state when the conversation state machine transitions between states.
   *
   * @param event - Conversation state change notification.
   */
  handleConversationStateChange(event: ConversationStateChangeEvent): void {
    this.conversationState = event.transition.to;

    this.currentTurnId = event.turnContext?.turnId ?? this.currentTurnId;
    this.logger.debug("PresenceIndicator: conversation state change", {
      from: event.transition.from,
      to: event.transition.to,
      cause: event.transition.cause,
    });
    this.scheduleEmit();
  }

  /**
   * Tracks conversation turn events to maintain the latest turn identifier for diagnostics.
   *
   * @param event - Conversation turn event raised by the state machine.
   */
  handleConversationTurnEvent(event: ConversationTurnEvent): void {
    if (event.turnContext) {
      this.currentTurnId = event.turnContext.turnId;
    }
    this.scheduleEmit();
  }

  /**
   * Disposes all resources owned by the service and prevents further state updates.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.flushHandle) {
      clearTimeout(this.flushHandle);
      this.flushHandle = undefined;
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.emitter.dispose();
  }

  /**
   * Schedules a batched presence emission, respecting the configured debounce window.
   */
  private scheduleEmit(): void {
    if (this.disposed) {
      return;
    }
    if (!this.pendingSince) {
      this.pendingSince = Date.now();
    }
    if (this.flushHandle) {
      return;
    }
    this.flushHandle = setTimeout(() => {
      this.flushHandle = undefined;
      this.flushPresenceUpdate();
    }, this.batchWindowMs);
  }

  /**
   * Emits the current presence snapshot if it differs from the last dispatched state.
   */
  private flushPresenceUpdate(): void {
    const update = this.buildPresenceUpdate();
    if (this.lastPresence && isPresenceStateEqual(this.lastPresence, update)) {
      this.pendingSince = 0;
      return;
    }

    const now = Date.now();
    const latency = this.pendingSince ? now - this.pendingSince : 0;
    update.latencyMs = latency;
    this.pendingSince = 0;

    this.lastPresence = update;
    this.emitter.fire(update);

    if (latency > this.latencyWarningMs) {
      this.logger.warn("PresenceIndicator: latency budget exceeded", {
        state: update.state,
        latencyMs: latency,
      });
    } else {
      this.logger.debug("PresenceIndicator: presence update emitted", {
        state: update.state,
        latencyMs: latency,
      });
    }
  }

  /**
   * Builds a presence record incorporating session status, diagnostics, and Copilot availability.
   *
   * @returns Presence update ready for downstream consumers.
   */
  private buildPresenceUpdate(): PresenceUpdate {
    const state = this.determinePresenceState();
    const descriptor = resolvePresenceDescriptor(state);
    const since =
      this.lastPresence && this.lastPresence.state === state
        ? this.lastPresence.since
        : new Date().toISOString();

    const details = this.buildPresenceDetails(state, descriptor);

    let message = descriptor.message;
    if (state === "waitingForCopilot" && !this.copilotAvailable) {
      message = "⋯ Waiting for Copilot (not installed)";
    }

    return {
      state,
      sessionId: this.sessionId,
      since,
      copilotAvailable: this.copilotAvailable,
      message,
      details,
    };
  }

  /**
   * Derives detailed presence metadata such as diagnostics and retry hints.
   *
   * @param state - Resolved presence state for the user.
   * @param descriptor - Descriptor containing default messaging for the state.
   * @returns Detailed presence descriptor used in UI surfaces.
   */
  private buildPresenceDetails(
    state: AgentVoicePresenceState,
    descriptor: PresenceStateDescriptor,
  ): PresenceDetails {
    const normalized = normalizePresenceState(state);
    const diagnostics = this.sessionDiagnostics;

    const details: PresenceDetails = {
      conversationTurnId: this.currentTurnId,
      retry: descriptor.defaultDetails.retry,
      renewal:
        descriptor.defaultDetails.renewal ||
        this.renewalInProgress ||
        this.sessionState === SessionState.Renewing,
      tooltip: descriptor.tooltip,
      statusMode: this.computeStatusMode(state),
      statusDetail: descriptor.tooltip,
      diagnostics,
    };

    if (normalized === "offline" || normalized === "error") {
      details.retry = true;
    }

    if (normalized === "waitingForCopilot" && !this.copilotAvailable) {
      details.retry = true;
      details.tooltip = "Install GitHub Copilot Chat for full functionality.";
      details.statusDetail = details.tooltip;
    }

    if (
      diagnostics?.connectionStatus === "degraded" &&
      normalized !== "offline"
    ) {
      details.retry = true;
      details.tooltip = "Connection degraded. Attempting to recover.";
      details.statusDetail = details.tooltip;
      if (!details.statusMode) {
        details.statusMode = "Reconnecting…";
      }
    }

    if (this.lastSessionError) {
      details.errorCode = this.lastSessionError.code;
      if (this.lastSessionError.remediation) {
        details.tooltip =
          `${details.tooltip} ${this.lastSessionError.remediation}`.trim();
        details.statusDetail = details.tooltip;
      }
    }

    return details;
  }

  /**
   * Computes a user-facing status mode string based on the presence state.
   *
   * @param state - Current presence state.
   * @returns Status mode string when applicable.
   */
  private computeStatusMode(
    state: AgentVoicePresenceState,
  ): string | undefined {
    const normalized = normalizePresenceState(state);
    if (normalized === "suspended") {
      return "Renewal in progress";
    }
    if (normalized === "waitingForCopilot") {
      return this.copilotAvailable
        ? "Waiting for Copilot"
        : "Copilot unavailable";
    }
    if (normalized === "offline") {
      return "Offline";
    }
    if (normalized === "error") {
      return "Needs attention";
    }
    return undefined;
  }

  /**
   * Determines the aggregate presence state by combining session and conversation inputs.
   *
   * @returns The resolved presence state string.
   */
  private determinePresenceState(): AgentVoicePresenceState {
    if (
      !this.sessionId ||
      this.sessionState === SessionState.Idle ||
      this.sessionState === SessionState.Ending
    ) {
      return "idle";
    }

    if (this.sessionDiagnostics?.connectionStatus === "failed") {
      return "offline";
    }

    if (this.sessionState === SessionState.Failed) {
      return "error";
    }

    if (this.sessionState === SessionState.Paused || this.renewalInProgress) {
      return "suspended";
    }

    const mapped = this.mapConversationState(this.conversationState);

    if (mapped === "idle") {
      return "listening";
    }

    if (mapped === "error") {
      return "error";
    }

    if (mapped === "suspended") {
      return "suspended";
    }

    return mapped;
  }

  /**
   * Maps conversation state machine values to presence states understood by the UI layer.
   *
   * @param state - Conversation state emitted by the state machine.
   * @returns Mapped presence state value.
   */
  private mapConversationState(
    state: ConversationState,
  ): AgentVoicePresenceState {
    switch (state) {
      case "idle":
        return "idle";
      case "preparing":
        return "processing";
      case "listening":
        return "listening";
      case "processing":
        return "processing";
      case "waitingForCopilot":
        return "waitingForCopilot";
      case "speaking":
        return "speaking";
      case "interrupted":
        return "interrupted";
      case "suspended":
        return "suspended";
      case "faulted":
        return "error";
      case "terminating":
        return "idle";
      default:
        return "idle";
    }
  }

  /**
   * Captures diagnostic information from the session manager when available.
   *
   * @param sessionId - Identifier of the active session.
   * @returns Snapshot of session diagnostics or undefined when unavailable.
   */
  private captureDiagnostics(
    sessionId: string,
  ): SessionDiagnostics | undefined {
    if (!this.sessionManager) {
      return undefined;
    }
    try {
      return this.sessionManager.getSessionDiagnostics(sessionId);
    } catch (error: any) {
      this.logger.debug("PresenceIndicator: unable to capture diagnostics", {
        sessionId,
        error: error?.message ?? String(error),
      });
      return undefined;
    }
  }

  /**
   * Ensures the service hasn't been disposed prior to performing stateful operations.
   *
   * @throws Error when the service is already disposed.
   */
  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("PresenceIndicatorService disposed");
    }
  }
}

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
  VoicePilotPresenceState,
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

export interface PresenceIndicatorServiceOptions {
  logger: Logger;
  batchWindowMs?: number;
  latencyWarningMs?: number;
}

const DEFAULT_LATENCY_WARNING_MS = 150;

export class PresenceIndicatorService implements vscode.Disposable {
  public readonly onDidChangePresence: vscode.Event<PresenceUpdate>;

  private readonly emitter = new vscode.EventEmitter<PresenceUpdate>();
  private readonly logger: Logger;
  private readonly batchWindowMs: number;
  private readonly latencyWarningMs: number;

  private sessionManager?: SessionManager;
  private conversationMachine?: ConversationStateMachine;

  private conversationState: ConversationState = "idle";
  private conversationMetadata: Record<string, unknown> | undefined;
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

  constructor(options: PresenceIndicatorServiceOptions) {
    this.logger = options.logger;
    this.batchWindowMs = options.batchWindowMs ?? PRESENCE_BATCH_WINDOW_MS;
    this.latencyWarningMs =
      options.latencyWarningMs ?? DEFAULT_LATENCY_WARNING_MS;
    this.onDidChangePresence = this.emitter.event;
  }

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

  bindConversationMachine(
    machine: ConversationStateMachine,
  ): vscode.Disposable {
    this.ensureNotDisposed();
    this.conversationMachine = machine;

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

  async handleSessionErrorEvent(event: SessionErrorEvent): Promise<void> {
    this.lastSessionError = event.error;
    this.logger.warn("PresenceIndicator: session error received", {
      sessionId: event.sessionId,
      error: event.error.code,
    });
    this.scheduleEmit();
  }

  handleConversationStateChange(event: ConversationStateChangeEvent): void {
    this.conversationState = event.transition.to;
    this.conversationMetadata = event.metadata?.metadata ?? undefined;
    this.currentTurnId = event.turnContext?.turnId ?? this.currentTurnId;
    this.logger.debug("PresenceIndicator: conversation state change", {
      from: event.transition.from,
      to: event.transition.to,
      cause: event.transition.cause,
    });
    this.scheduleEmit();
  }

  handleConversationTurnEvent(event: ConversationTurnEvent): void {
    if (event.turnContext) {
      this.currentTurnId = event.turnContext.turnId;
    }
    this.scheduleEmit();
  }

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

  private buildPresenceDetails(
    state: VoicePilotPresenceState,
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

  private computeStatusMode(
    state: VoicePilotPresenceState,
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

  private determinePresenceState(): VoicePilotPresenceState {
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

  private mapConversationState(
    state: ConversationState,
  ): VoicePilotPresenceState {
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

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error("PresenceIndicatorService disposed");
    }
  }
}

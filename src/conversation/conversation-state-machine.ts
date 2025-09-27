import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import type { TurnEvent as InterruptionTurnEvent } from "../types/conversation";
import { SessionInfo } from "../types/session";
import {
  TranscriptClearedEvent,
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent,
  TranscriptionStatusEvent,
  TranscriptRedoEvent,
} from "../types/speech-to-text";
import { TtsPlaybackEvent } from "../types/tts";

export type ConversationState =
  | "idle"
  | "preparing"
  | "listening"
  | "processing"
  | "waitingForCopilot"
  | "speaking"
  | "interrupted"
  | "suspended"
  | "faulted"
  | "terminating";

export type TurnRole = "user" | "assistant";

export interface ConversationContext {
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export type ConversationTerminationReason =
  | "manual-stop"
  | "session-ended"
  | "fatal-error"
  | "shutdown";
export type InterruptSource = "vad" | "user-command" | "system" | "copilot";
export type SuspensionReason =
  | "session-renewal"
  | "network-recovery"
  | "diagnostics"
  | string;

export type TransitionCause =
  | "user.start"
  | "session.ready"
  | "stt.partial"
  | "stt.final"
  | "vad.end"
  | "copilot.request"
  | "copilot.response"
  | "tts.bufferReady"
  | "tts.complete"
  | "user.interrupt"
  | "session.renewal"
  | "session.timeout"
  | "error"
  | "user.stop"
  | "system.resume"
  | "system.suspend"
  | "timer.expired";

export interface StateMetadata {
  reason?: string;
  sessionId?: string;
  transcriptId?: string;
  copilotRequestId?: string;
  pendingActions?: string[];
  retryCount?: number;
  suspensionReason?: SuspensionReason;
  circuitOpen?: boolean;
  metadata?: Record<string, unknown>;
}

export interface TurnContext {
  turnId: string;
  turnRole: TurnRole;
  since: string;
  transcript?: string;
  confidence?: number;
  interruptions: number;
  metadata: Record<string, unknown>;
}

export interface StateChangeEvent {
  type: "state-changed";
  transition: {
    from: ConversationState;
    to: ConversationState;
    cause: TransitionCause;
    timestamp: string;
  };
  turnContext: TurnContext | undefined;
  metadata: StateMetadata;
}

export interface TurnEvent {
  type: "turn-started" | "turn-completed" | "turn-interrupted";
  turnContext: TurnContext;
  timestamp: string;
}

export interface CopilotResponseEvent {
  requestId: string;
  status: "pending" | "completed" | "failed";
  content?: string;
  error?: { message: string; retryable: boolean };
  timestamp: string;
  context?: Record<string, unknown>;
}

export type StateChangeHandler = (
  event: StateChangeEvent,
) => void | Promise<void>;
export type TurnEventHandler = (event: TurnEvent) => void | Promise<void>;

const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;

interface SuspensionSnapshot {
  state: ConversationState;
  metadata: StateMetadata;
}

export interface ConversationStateMachineOptions {
  logger?: Logger;
}

export class ConversationStateMachine implements ServiceInitializable {
  private readonly logger: Logger;
  private readonly emitter = new EventEmitter();
  private initialized = false;
  private sessionInfo: SessionInfo | undefined;
  private currentState: ConversationState = "idle";
  private previousState: ConversationState = "idle";
  private readonly stateMetadata: StateMetadata = {};
  private currentTurn: TurnContext | undefined;
  private lastAssistantTurnId: string | undefined;
  private suspensionSnapshot: SuspensionSnapshot | undefined;
  private turnSequence = 0;
  private faultTimestamps: number[] = [];
  private circuitOpenUntil = 0;

  constructor(options?: ConversationStateMachineOptions) {
    this.logger = options?.logger ?? new Logger("ConversationStateMachine");
    this.emitter.setMaxListeners(50);
  }

  async initialize(session?: SessionInfo): Promise<void> {
    if (this.initialized) {
      if (session) {
        await this.attachSession(session);
      }
      return;
    }

    this.initialized = true;
    this.logger.debug("Conversation state machine initialized");
    if (session) {
      await this.attachSession(session);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.emitter.removeAllListeners();
    this.initialized = false;
    this.sessionInfo = undefined;
    this.currentTurn = undefined;
    this.resetCircuitBreaker();
  }

  async attachSession(session: SessionInfo): Promise<void> {
    this.ensureInitialized("attachSession");
    this.sessionInfo = session;
    this.turnSequence = 0;
    this.currentTurn = undefined;
    this.transition("idle", "session.ready", { sessionId: session.sessionId });
  }

  async startConversation(context?: ConversationContext): Promise<void> {
    this.ensureInitialized("startConversation");
    if (!this.sessionInfo) {
      throw new Error("Conversation session not attached");
    }

    if (this.currentState !== "idle" && this.currentState !== "terminating") {
      this.logger.warn("Attempted to start conversation while already active", {
        state: this.currentState,
      });
      return;
    }

    const metadata: StateMetadata = {
      sessionId: context?.sessionId ?? this.sessionInfo.sessionId,
      reason: "Conversation start requested",
      metadata: context?.metadata,
    } as StateMetadata;

    this.transition("preparing", "user.start", metadata);
    this.transition("listening", "session.ready", metadata);
  }

  async endConversation(
    reason: ConversationTerminationReason = "manual-stop",
  ): Promise<void> {
    this.ensureInitialized("endConversation");
    const metadata: StateMetadata = {
      sessionId: this.sessionInfo?.sessionId,
      reason,
      pendingActions: [],
    };
    this.transition("terminating", "user.stop", metadata);
    this.currentTurn = undefined;
    this.transition("idle", "user.stop", metadata);
  }

  getState(): {
    state: ConversationState;
    previousState: ConversationState;
    metadata: StateMetadata;
    turnContext?: TurnContext;
  } {
    return {
      state: this.currentState,
      previousState: this.previousState,
      metadata: { ...this.stateMetadata },
      turnContext: this.cloneTurn(this.currentTurn),
    };
  }

  onStateChanged(handler: StateChangeHandler): { dispose(): void } {
    this.emitter.on("state-changed", handler);
    return {
      dispose: () => this.emitter.off("state-changed", handler),
    };
  }

  onTurnEvent(handler: TurnEventHandler): { dispose(): void } {
    this.emitter.on("turn-event", handler);
    return {
      dispose: () => this.emitter.off("turn-event", handler),
    };
  }

  onTranscriptEvent(handler: (event: TranscriptEvent) => void): {
    dispose(): void;
  } {
    this.emitter.on("transcript-event", handler);
    return {
      dispose: () => this.emitter.off("transcript-event", handler),
    };
  }

  async notifyTranscript(event: TranscriptEvent): Promise<void> {
    this.ensureInitialized("notifyTranscript");
    switch (event.type) {
      case "transcript-delta":
        this.handleTranscriptDelta(event);
        break;
      case "transcript-final":
        this.handleTranscriptFinal(event);
        break;
      case "transcript-redo":
        this.handleTranscriptRedo(event);
        break;
      case "transcript-cleared":
        this.handleTranscriptCleared(event);
        break;
      default:
        this.logger.debug("Unhandled transcript event", {
          type: (event as TranscriptEvent).type,
        });
        break;
    }
    this.emitter.emit("transcript-event", { ...event });
  }

  async notifyTranscriptionStatus(
    event: TranscriptionStatusEvent,
  ): Promise<void> {
    this.ensureInitialized("notifyTranscriptionStatus");
    switch (event.status) {
      case "speech-started":
        this.beginUserTurn(event.timestamp);
        this.transition("listening", "stt.partial", {
          sessionId: event.sessionId,
        });
        break;
      case "speech-stopped":
        this.transition("processing", "vad.end", {
          sessionId: event.sessionId,
        });
        break;
      case "thinking":
        this.transition("processing", "stt.partial", {
          sessionId: event.sessionId,
        });
        break;
      case "paused":
        this.transition("suspended", "system.suspend", {
          sessionId: event.sessionId,
          suspensionReason: "stt-paused",
        });
        break;
      case "error":
        this.transition("faulted", "error", {
          sessionId: event.sessionId,
          reason: event.detail,
        });
        break;
      default:
        break;
    }
  }

  async notifyCopilot(event: CopilotResponseEvent): Promise<void> {
    this.ensureInitialized("notifyCopilot");
    const metadata: StateMetadata = {
      sessionId: this.sessionInfo?.sessionId,
      copilotRequestId: event.requestId,
      reason: `Copilot status: ${event.status}`,
      pendingActions: [],
    };

    if (event.status === "pending") {
      this.transition("waitingForCopilot", "copilot.request", metadata);
      return;
    }

    if (event.status === "completed") {
      this.transition("processing", "copilot.response", metadata);
      if (!this.currentTurn || this.currentTurn.turnRole !== "assistant") {
        this.beginAssistantTurn(event.timestamp);
      }
      this.appendAssistantTranscript(event.content ?? "", event);
      return;
    }

    if (event.status === "failed") {
      this.transition("faulted", "error", {
        ...metadata,
        reason: event.error?.message ?? "Copilot request failed",
      });
    }
  }

  async notifyTts(event: TtsPlaybackEvent): Promise<void> {
    this.ensureInitialized("notifyTts");
    switch (event.type) {
      case "speaking-state-changed": {
        const nextState =
          event.data?.state === "speaking" ? "speaking" : "listening";
        const cause: TransitionCause =
          event.data?.state === "speaking" ? "tts.bufferReady" : "tts.complete";
        if (event.data?.state === "speaking") {
          this.beginAssistantTurn(new Date(event.timestamp).toISOString());
        }
        this.transition(nextState, cause, {
          sessionId: this.sessionInfo?.sessionId,
        });
        break;
      }
      case "playback-complete":
        this.completeAssistantTurn(new Date(event.timestamp).toISOString());
        this.transition("listening", "tts.complete", {
          sessionId: this.sessionInfo?.sessionId,
        });
        break;
      case "interrupted":
        this.handleUserInterrupt("system");
        break;
      case "playback-error":
        this.transition("faulted", "error", {
          sessionId: this.sessionInfo?.sessionId,
          reason: event.data?.error?.message,
          pendingActions: event.data?.error
            ? [event.data.error.code]
            : undefined,
        });
        break;
      default:
        break;
    }
  }

  handleUserInterrupt(source: InterruptSource, message?: string): void {
    this.ensureInitialized("handleUserInterrupt");
    const metadata: StateMetadata = {
      sessionId: this.sessionInfo?.sessionId,
      reason: message ?? "User interrupt",
      pendingActions: [source],
    };
    if (
      this.currentState === "speaking" &&
      this.currentTurn &&
      this.currentTurn.turnRole === "assistant"
    ) {
      this.incrementInterruptionCount();
      this.completeAssistantTurn(new Date().toISOString());
      this.emitTurnEvent("turn-interrupted", this.currentTurn);
    }
    this.transition("interrupted", "user.interrupt", metadata);
  }

  suspend(reason: SuspensionReason): void {
    this.ensureInitialized("suspend");
    if (this.currentState === "suspended") {
      return;
    }
    this.suspensionSnapshot = {
      state: this.currentState,
      metadata: { ...this.stateMetadata },
    };
    this.transition("suspended", "system.suspend", {
      sessionId: this.sessionInfo?.sessionId,
      suspensionReason: reason,
    });
  }

  resume(): void {
    this.ensureInitialized("resume");
    if (!this.suspensionSnapshot) {
      return;
    }
    const snapshot = this.suspensionSnapshot;
    this.suspensionSnapshot = undefined;
    const targetState =
      snapshot.state === "suspended" ? "listening" : snapshot.state;
    this.transition(targetState, "system.resume", snapshot.metadata);
  }

  ingestInterruptionEvent(event: InterruptionTurnEvent): void {
    this.ensureInitialized("ingestInterruptionEvent");
    if (!event) {
      return;
    }
    switch (event.type) {
      case "interruption":
        this.handleUserInterrupt(
          "vad",
          "Interruption engine reported barge-in",
        );
        break;
      case "turn-started":
        if (event.turn?.role === "assistant") {
          this.beginAssistantTurn(event.timestamp);
          this.transition("speaking", "tts.bufferReady", {
            sessionId: this.sessionInfo?.sessionId,
          });
        } else if (event.turn?.role === "user") {
          this.beginUserTurn(event.timestamp);
          this.transition("listening", "stt.partial", {
            sessionId: this.sessionInfo?.sessionId,
          });
        }
        break;
      case "turn-ended":
        if (event.turn?.role === "user") {
          this.transition("processing", "stt.final", {
            sessionId: this.sessionInfo?.sessionId,
          });
        } else if (event.turn?.role === "assistant") {
          this.transition("listening", "tts.complete", {
            sessionId: this.sessionInfo?.sessionId,
          });
        }
        break;
      case "state-changed":
        if (event.state === "recovering") {
          this.suspend("interruption-engine-degraded");
        }
        break;
      default:
        break;
    }
  }

  private handleTranscriptDelta(event: TranscriptDeltaEvent): void {
    if (!this.currentTurn || this.currentTurn.turnRole !== "user") {
      this.beginUserTurn(event.timestamp);
    }
    this.transition("listening", "stt.partial", {
      sessionId: event.sessionId,
      transcriptId: event.utteranceId,
    });
    this.appendTranscriptContent(
      event.delta,
      event.confidence,
      event.metadata.serverVad?.state === "start",
    );
  }

  private handleTranscriptFinal(event: TranscriptFinalEvent): void {
    if (!this.currentTurn || this.currentTurn.turnRole !== "user") {
      this.beginUserTurn(event.timestamp);
    }
    this.appendTranscriptContent(event.content, event.confidence, true);
    this.completeCurrentTurn(event.timestamp);
    this.transition("processing", "stt.final", {
      sessionId: event.sessionId,
      transcriptId: event.utteranceId,
    });
  }

  private handleTranscriptRedo(event: TranscriptRedoEvent): void {
    if (!this.currentTurn || this.currentTurn.turnRole !== "user") {
      return;
    }
    this.currentTurn.transcript = event.replacementContent;
    this.currentTurn.metadata.redoReason = event.reason;
    this.transition(this.currentState, "stt.partial", {
      sessionId: event.sessionId,
      transcriptId: event.utteranceId,
      reason: `Redo due to ${event.reason}`,
    });
  }

  private handleTranscriptCleared(event: TranscriptClearedEvent): void {
    if (this.currentTurn?.turnRole === "user") {
      this.currentTurn.transcript = "";
      this.currentTurn.metadata.clearedAt = event.clearedAt;
    }
    this.transition("listening", "stt.partial", {
      sessionId: event.sessionId,
      transcriptId: event.sessionId,
      reason: `Transcript cleared: ${event.reason}`,
    });
  }

  private beginUserTurn(timestamp?: string): void {
    if (this.currentTurn && this.currentTurn.turnRole === "user") {
      return;
    }
    this.currentTurn = this.createTurn("user", timestamp);
    this.emitTurnEvent("turn-started", this.currentTurn);
  }

  private beginAssistantTurn(timestamp?: string): void {
    if (
      this.currentTurn?.turnRole === "assistant" &&
      !this.currentTurnEnded()
    ) {
      return;
    }
    this.currentTurn = this.createTurn("assistant", timestamp);
    this.lastAssistantTurnId = this.currentTurn.turnId;
    this.emitTurnEvent("turn-started", this.currentTurn);
  }

  private appendTranscriptContent(
    content: string,
    confidence?: number,
    markActive = false,
  ): void {
    if (!this.currentTurn) {
      return;
    }
    this.currentTurn.transcript = (this.currentTurn.transcript ?? "") + content;
    if (typeof confidence === "number") {
      this.currentTurn.confidence = confidence;
    }
    if (markActive) {
      this.currentTurn.metadata.lastUpdate = new Date().toISOString();
    }
  }

  private appendAssistantTranscript(
    content: string,
    event: CopilotResponseEvent,
  ): void {
    if (!content) {
      return;
    }
    if (!this.currentTurn || this.currentTurn.turnRole !== "assistant") {
      this.beginAssistantTurn(event.timestamp);
    }
    this.appendTranscriptContent(content, undefined, true);
    if (event.status === "completed") {
      this.completeAssistantTurn(event.timestamp);
    }
  }

  private completeCurrentTurn(timestamp?: string): void {
    if (!this.currentTurn) {
      return;
    }
    this.emitTurnEvent("turn-completed", {
      ...this.currentTurn,
      metadata: {
        ...this.currentTurn.metadata,
        completedAt: timestamp ?? new Date().toISOString(),
      },
    });
  }

  private completeAssistantTurn(timestamp?: string): void {
    if (!this.currentTurn || this.currentTurn.turnRole !== "assistant") {
      return;
    }
    this.emitTurnEvent("turn-completed", {
      ...this.currentTurn,
      metadata: {
        ...this.currentTurn.metadata,
        completedAt: timestamp ?? new Date().toISOString(),
      },
    });
    this.currentTurn = undefined;
  }

  private createTurn(role: TurnRole, timestamp?: string): TurnContext {
    this.turnSequence += 1;
    return {
      turnId: `${role}-${this.turnSequence}-${randomUUID()}`,
      turnRole: role,
      since: timestamp ?? new Date().toISOString(),
      transcript: "",
      interruptions: 0,
      metadata: {
        sessionId: this.sessionInfo?.sessionId,
      },
    };
  }

  private incrementInterruptionCount(): void {
    if (!this.currentTurn) {
      return;
    }
    this.currentTurn.interruptions += 1;
  }

  private currentTurnEnded(): boolean {
    return !this.currentTurn;
  }

  private transition(
    target: ConversationState,
    cause: TransitionCause,
    metadata?: StateMetadata,
  ): void {
    const now = new Date().toISOString();
    const from = this.currentState;
    if (from === target && cause !== "error") {
      return;
    }

    if (target === "faulted") {
      this.registerFault(now);
      if (this.isCircuitOpen()) {
        this.logger.warn(
          "Conversation circuit breaker open; remaining in faulted state",
          { until: new Date(this.circuitOpenUntil).toISOString() },
        );
        metadata = { ...metadata, circuitOpen: true };
      }
    } else {
      this.resetCircuitBreaker();
    }

    this.previousState = from;
    this.currentState = target;
    Object.assign(this.stateMetadata, metadata ?? {}, { lastCause: cause });

    const event: StateChangeEvent = {
      type: "state-changed",
      transition: { from, to: target, cause, timestamp: now },
      turnContext: this.cloneTurn(this.currentTurn),
      metadata: { ...this.stateMetadata },
    };

    this.emitStateEvent(event);
    this.logger.debug("Conversation state transition", {
      from,
      to: target,
      cause,
      metadata: event.metadata,
    });
  }

  private emitStateEvent(event: StateChangeEvent): void {
    const listeners = this.emitter.listeners("state-changed");
    if (listeners.length === 0) {
      return;
    }
    for (const listener of listeners) {
      try {
        const result = (listener as StateChangeHandler)(event);
        if (result instanceof Promise) {
          void result.catch((error) =>
            this.logger.error("State change handler failed", {
              error: error?.message ?? error,
            }),
          );
        }
      } catch (error: any) {
        this.logger.error("State change listener threw", {
          error: error?.message ?? error,
        });
      }
    }
  }

  private emitTurnEvent(type: TurnEvent["type"], context: TurnContext): void {
    const event: TurnEvent = {
      type,
      turnContext: this.cloneTurn(context)!,
      timestamp: new Date().toISOString(),
    };
    const listeners = this.emitter.listeners("turn-event");
    if (listeners.length === 0) {
      return;
    }
    for (const listener of listeners) {
      try {
        const result = (listener as TurnEventHandler)(event);
        if (result instanceof Promise) {
          void result.catch((error) =>
            this.logger.error("Turn event handler failed", {
              error: error?.message ?? error,
            }),
          );
        }
      } catch (error: any) {
        this.logger.error("Turn listener threw", {
          error: error?.message ?? error,
        });
      }
    }
  }

  private registerFault(timestampIso: string): void {
    const timestamp = Date.parse(timestampIso);
    this.faultTimestamps.push(timestamp);
    this.faultTimestamps = this.faultTimestamps.filter(
      (ts) => timestamp - ts <= CIRCUIT_BREAKER_WINDOW_MS,
    );
    if (this.faultTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      this.logger.warn(
        "Conversation fault threshold reached; circuit breaker engaged",
        { until: new Date(this.circuitOpenUntil).toISOString() },
      );
    }
  }

  private resetCircuitBreaker(): void {
    this.faultTimestamps = [];
    this.circuitOpenUntil = 0;
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitOpenUntil) {
      return false;
    }
    if (Date.now() > this.circuitOpenUntil) {
      this.resetCircuitBreaker();
      return false;
    }
    return true;
  }

  private cloneTurn(turn?: TurnContext): TurnContext | undefined {
    if (!turn) {
      return undefined;
    }
    return {
      turnId: turn.turnId,
      turnRole: turn.turnRole,
      since: turn.since,
      transcript: turn.transcript,
      confidence: turn.confidence,
      interruptions: turn.interruptions,
      metadata: { ...turn.metadata },
    };
  }

  private ensureInitialized(operation: string): void {
    if (!this.initialized) {
      throw new Error(
        `ConversationStateMachine must be initialized before ${operation}`,
      );
    }
  }
}

export default ConversationStateMachine;

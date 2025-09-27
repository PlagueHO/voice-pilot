import * as vscode from "vscode";
import { ServiceInitializable } from "../core/service-initializable";

/**
 * Enumerates the high-level phases a conversation session can enter.
 */
export type ConversationState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "recovering";

/**
 * Identifies which interruption policy profile is applied to a turn.
 */
export type PolicyProfileId = "default" | "assertive" | "hands-free" | "custom";

/**
 * Configuration options that tune interruption handling behaviour.
 */
export interface InterruptionPolicyConfig {
  /** Policy profile to apply for the current session. */
  profile: PolicyProfileId;
  /** When true, the user may barge in while the assistant is speaking. */
  allowBargeIn: boolean;
  /** Maximum assistant talk time before automatic yield, in milliseconds. */
  interruptionBudgetMs: number;
  /** Grace period after completion before state transitions, in milliseconds. */
  completionGraceMs: number;
  /** Debounce interval applied to speech-stop detection, in milliseconds. */
  speechStopDebounceMs: number;
  /** Fallback mode the engine should assume when conditions degrade. */
  fallbackMode: "manual" | "hybrid";
}

/**
 * Captures details about why and how a turn was interrupted.
 */
export interface InterruptionInfo {
  /** Type of interruption that occurred. */
  type: "barge-in" | "manual-stop" | "policy-yield";
  /** UTC timestamp indicating when the interruption was detected. */
  detectedAt: string;
  /** Measured latency in milliseconds between trigger and detection. */
  latencyMs: number;
  /** Source responsible for signalling the interruption. */
  source: "azure-vad" | "client-hint" | "ui-command" | "system";
  /** Optional error or policy reason code for diagnostics. */
  reasonCode?: string;
  /** Number of interruptions that have occurred in the current session. */
  interruptionCount?: number;
}

/**
 * Describes a single user or assistant turn in the conversation timeline.
 */
export interface TurnDescriptor {
  /** Globally unique identifier for the turn. */
  turnId: string;
  /** Role associated with the turn. */
  role: "user" | "assistant";
  /** ISO 8601 timestamp for when the turn began. */
  startedAt: string;
  /** When present, marks the completion timestamp for the turn. */
  endedAt?: string;
  /** Interruption metadata if the turn was pre-empted. */
  interruption?: InterruptionInfo;
  /** Policy profile applied when the turn was created. */
  policyProfile: PolicyProfileId;
}

/**
 * Optional diagnostic payload that accompanies turn lifecycle events.
 */
export interface TurnEventDiagnostics {
  /** Latency observed from interruption trigger to handling, in ms. */
  interruptionLatencyMs?: number;
  /** Count of interruptions experienced so far within the session. */
  interruptionCount?: number;
  /** Indicates whether an interruption cooldown is currently active. */
  cooldownActive?: boolean;
  /** Signals that the engine is operating in fallback mode. */
  fallbackActive?: boolean;
}

/**
 * Event emitted by the interruption engine to signal conversation changes.
 */
export interface TurnEvent {
  /** Category of event emitted by the engine. */
  type:
    | "state-changed"
    | "turn-started"
    | "turn-ended"
    | "interruption"
    | "policy-updated"
    | "degraded"
    | "recovered";
  /** Current high-level conversation state. */
  state: ConversationState;
  /** Turn information relevant to the event, when applicable. */
  turn?: TurnDescriptor;
  /** UTC timestamp for when the event was produced. */
  timestamp: string;
  /** Supplemental diagnostic information for monitoring. */
  diagnostics?: TurnEventDiagnostics;
}

/**
 * Event describing inbound or outbound speech activity detections.
 */
export interface SpeechActivityEvent {
  /** Speech activity transition observed by the system. */
  type:
    | "user-speech-start"
    | "user-speech-stop"
    | "assistant-speech-start"
    | "assistant-speech-stop"
    | "vad-degraded";
  /** Origin of the speech detection signal. */
  source: "azure-vad" | "client-hint" | "manual";
  /** UTC timestamp when the speech event was detected. */
  timestamp: string;
  /** Optional processing latency associated with the detection, in ms. */
  latencyMs?: number;
}

/**
 * Event emitted when assistant audio playback state changes.
 */
export interface PlaybackActivityEvent {
  /** Playback activity transition. */
  type:
    | "assistant-playback-started"
    | "assistant-playback-ended"
    | "assistant-playback-cancelled";
  /** Handle identifier for the playback operation, if available. */
  handleId?: string;
  /** UTC timestamp of the playback change. */
  timestamp: string;
  /** Optional latency for the playback transition, in ms. */
  latencyMs?: number;
}

/**
 * Hint values that influence how the assistant generates its next response.
 */
export interface TurnHints {
  /** Whether the assistant should automatically produce a response. */
  expectResponse?: boolean;
  /** Delay before auto-response is triggered, in milliseconds. */
  autoResponseDelayMs?: number;
  /** Identifier linking a turn back to a Copilot request. */
  copilotRequestId?: string;
}

/**
 * Optional hooks that allow the interruption engine to control external
 * services such as playback or response generation.
 */
export interface InterruptionEngineHooks {
  /** Cancels any pending or active assistant playback. */
  cancelAssistantPlayback?: (context: {
    reason: string;
    source: string;
  }) => Promise<void> | void;
  /** Requests that the assistant produce a response using provided hints. */
  requestAssistantResponse?: (context: {
    hints?: TurnHints;
  }) => Promise<void> | void;
  /** Notifies listeners when fallback behaviour toggles. */
  onFallbackChanged?: (active: boolean, reason: string) => void;
}

/**
 * Primary contract for the interruption engine coordinating conversation flow.
 */
export interface InterruptionEngine extends ServiceInitializable {
  /** Applies a new policy configuration to the engine. */
  configure(policy: InterruptionPolicyConfig): Promise<void>;
  /** Handles speech events originating from VAD or user hints. */
  handleSpeechEvent(event: SpeechActivityEvent): Promise<void> | void;
  /** Handles playback transitions surfaced by audio subsystems. */
  handlePlaybackEvent(event: PlaybackActivityEvent): Promise<void> | void;
  /** Forces the assistant to yield control with a provided reason. */
  requestAssistantYield(reason: string): Promise<void>;
  /** Grants the assistant a new turn, optionally with response hints. */
  grantAssistantTurn(hints?: TurnHints): Promise<void>;
  /** Retrieves the engine's current conversation state. */
  getConversationState(): ConversationState;
  /** Returns metadata about the active turn or null if idle. */
  getActiveTurn(): TurnDescriptor | null;
  /** Subscribes to engine events. */
  onEvent(listener: (event: TurnEvent) => void): vscode.Disposable;
  /** Registers hook callbacks used for cross-system coordination. */
  updateHooks(hooks: InterruptionEngineHooks): void;
}

/**
 * Snapshot of diagnostic details describing the engine's current health.
 */
export interface InterruptionEngineDiagnostics {
  /** True when fallback mode is currently active. */
  fallbackActive: boolean;
  /** Total number of interruptions processed during the session. */
  interruptionCount: number;
  /** Timestamp (epoch ms) indicating when cooldown ends, if active. */
  cooldownEndsAt?: number;
}

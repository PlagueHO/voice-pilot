import { Disposable } from "vscode";
import type { TurnDetectionConfig } from "./configuration";

/**
 * Speech roles that can be attributed to a transcript segment.
 */
export type SpeakerRole = "user" | "assistant" | "system";

/**
 * Defines a textual redaction rule applied to transcript slices.
 */
export interface RedactionRule {
  id: string;
  pattern: RegExp | string;
  replacement: string;
  explanation?: string;
}

/**
 * Result describing a single redaction that was applied to content.
 */
export interface RedactionMatch {
  ruleId: string;
  originalText: string;
  replacementText: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Aggregated output of the redaction engine for a given utterance.
 */
export interface RedactionResult {
  content: string;
  matches: RedactionMatch[];
}

/**
 * Voice activity detection signal originating from the realtime service.
 */
export interface ServerVadSignal {
  state: "start" | "stop";
  offset_ms: number;
}

/**
 * Client-side voice activity detection signal derived from local audio.
 */
export interface ClientVadSignal {
  state: "start" | "stop";
  confidence: number;
  offset_ms: number;
}

/**
 * Supplemental metadata captured alongside each utterance in a transcript.
 */
export interface UtteranceMetadata {
  startOffsetMs: number;
  endOffsetMs?: number;
  locale: string;
  serverVad?: ServerVadSignal;
  clientVad?: ClientVadSignal;
  redactionsApplied?: RedactionMatch[];
  chunkCount: number;
}

/**
 * Indicates progress for an utterance as it moves through recognition stages.
 */
export type UtteranceStatus = "pending" | "partial" | "final" | "archived";

/**
 * Snapshot of a single utterance produced during transcription.
 */
export interface UtteranceSnapshot {
  utteranceId: string;
  sessionId: string;
  speaker: SpeakerRole;
  content: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
  status: UtteranceStatus;
  metadata: UtteranceMetadata;
}

/**
 * Transcript-friendly structure that augments an utterance with ordering data.
 */
export interface TranscriptEntry extends UtteranceSnapshot {
  final: boolean;
  sequence: number;
}

/**
 * Options contract accepted when starting a speech-to-text session.
 */
export interface TranscriptionOptions {
  profanityFilter?: "none" | "medium" | "high";
  redactionRules?: RedactionRule[];
  speakerHint?: SpeakerRole;
  locale?: string;
  interimDebounceMs?: number;
  model?: string;
  apiVersion?: string;
  transcriptionModel?: string;
  turnDetection?: TurnDetectionConfig;
  inputAudioFormat?: "pcm16" | "pcm24" | "pcm32";
  turnDetectionCreateResponse?: boolean;
}

/**
 * Minimal session descriptor shared across speech-to-text entry points.
 */
export interface SessionInfoLike {
  sessionId: string;
  correlationId?: string;
  userId?: string;
}

/**
 * High-level service contract implemented by the speech-to-text subsystem.
 */
export interface SpeechToTextService {
  startTranscription(
    session: SessionInfoLike,
    options?: TranscriptionOptions,
  ): Promise<void>;
  stopTranscription(sessionId: string): Promise<void>;
  pauseTranscription(sessionId: string, reason: PauseReason): Promise<void>;
  resumeTranscription(sessionId: string): Promise<void>;

  getActiveUtterances(sessionId: string): UtteranceSnapshot[];
  getTranscriptHistory(sessionId: string, limit?: number): TranscriptEntry[];
  clearTranscriptHistory(sessionId: string): Promise<void>;

  onTranscriptEvent(handler: TranscriptEventHandler): Disposable;
  onStatusEvent(handler: TranscriptionStatusHandler): Disposable;
  onError(handler: TranscriptionErrorHandler): Disposable;
}

/**
 * Reasons why transcription can be temporarily paused.
 */
export type PauseReason =
  | "credential-renewal"
  | "network-loss"
  | "user-requested"
  | "system-overload";

/**
 * Callback invoked when transcript content changes.
 */
export type TranscriptEventHandler = (
  event: TranscriptEvent,
) => void | Promise<void>;

/**
 * Callback invoked when transcription status transitions.
 */
export type TranscriptionStatusHandler = (
  event: TranscriptionStatusEvent,
) => void | Promise<void>;

/**
 * Callback invoked when the service reports an error condition.
 */
export type TranscriptionErrorHandler = (
  event: TranscriptionErrorEvent,
) => void | Promise<void>;

/**
 * Union of transcript-related events emitted by the service.
 */
export type TranscriptEvent =
  | TranscriptDeltaEvent
  | TranscriptFinalEvent
  | TranscriptRedoEvent
  | TranscriptClearedEvent;

/**
 * Event representing incremental transcript updates.
 */
export interface TranscriptDeltaEvent {
  type: "transcript-delta";
  sessionId: string;
  utteranceId: string;
  delta: string;
  content: string;
  confidence?: number;
  timestamp: string;
  sequence: number;
  metadata: UtteranceMetadata;
}

/**
 * Event emitted when a transcript entry reaches its final state.
 */
export interface TranscriptFinalEvent {
  type: "transcript-final";
  sessionId: string;
  utteranceId: string;
  content: string;
  confidence?: number;
  timestamp: string;
  metadata: UtteranceMetadata;
}

/**
 * Event emitted when an earlier transcript entry is replaced with new content.
 */
export interface TranscriptRedoEvent {
  type: "transcript-redo";
  sessionId: string;
  utteranceId: string;
  previousContent: string;
  replacementContent: string;
  reason: "desync" | "confidence-drop" | "redaction";
  timestamp: string;
}

/**
 * Event emitted when the transcript history for a session is purged.
 */
export interface TranscriptClearedEvent {
  type: "transcript-cleared";
  sessionId: string;
  clearedAt: string;
  reason: "user-requested" | "privacy-policy" | "session-end";
}

/**
 * Status notification describing the current state of transcription.
 */
export interface TranscriptionStatusEvent {
  type: "transcription-status";
  sessionId: string;
  status:
    | "connecting"
    | "listening"
    | "thinking"
    | "paused"
    | "error"
    | "speech-started"
    | "speech-stopped";
  detail?: string;
  timestamp: string;
  correlationId?: string;
}

/**
 * Error codes raised by the speech-to-text subsystem.
 */
export enum TranscriptionErrorCode {
  TransportDisconnected = "TRANSPORT_DISCONNECTED",
  AuthenticationFailed = "AUTHENTICATION_FAILED",
  AudioStreamStalled = "AUDIO_STREAM_STALLED",
  ResponseFormatInvalid = "RESPONSE_FORMAT_INVALID",
  RateLimited = "RATE_LIMITED",
  ProfanityFilterFailed = "PROFANITY_FILTER_FAILED",
  RedactionRuleInvalid = "REDACTION_RULE_INVALID",
  Unknown = "UNKNOWN",
}

/**
 * Structured error payload emitted to subscribers.
 */
export interface TranscriptionErrorEvent {
  type: "transcription-error";
  sessionId: string;
  code: TranscriptionErrorCode;
  message: string;
  recoverable: boolean;
  remediation?: string;
  timestamp: string;
  context?: Record<string, unknown>;
  correlationId?: string;
}

/**
 * Free-form annotation container attached to Azure realtime transcripts.
 */
export interface AzureAnnotation {
  type: string;
  [key: string]: unknown;
}

/**
 * Message contract mirroring the Azure realtime transcription protocol.
 */
export interface AzureRealtimeTranscriptMessage {
  type:
    | "response.output_audio_transcript.delta"
    | "response.output_audio_transcription.delta"
    | "response.output_text.delta"
    | "response.done"
    | "session.updated"
    | "conversation.item.audio_transcription.delta"
    | "conversation.item.audio_transcription.completed";
  response_id: string;
  item_id: string;
  delta?:
    | string
    | {
        text?: string;
        transcript?: string;
        confidence?: number;
        annotations?: AzureAnnotation[];
      };
  final?: {
    text: string;
    confidence?: number;
  };
  server_vad?: ServerVadSignal;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

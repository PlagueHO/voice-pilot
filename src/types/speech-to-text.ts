import { Disposable } from "vscode";
import type { TurnDetectionConfig } from "./configuration";

export type SpeakerRole = "user" | "assistant" | "system";

export interface RedactionRule {
  id: string;
  pattern: RegExp | string;
  replacement: string;
  explanation?: string;
}

export interface RedactionMatch {
  ruleId: string;
  originalText: string;
  replacementText: string;
  startIndex: number;
  endIndex: number;
}

export interface RedactionResult {
  content: string;
  matches: RedactionMatch[];
}

export interface ServerVadSignal {
  state: "start" | "stop";
  offset_ms: number;
}

export interface ClientVadSignal {
  state: "start" | "stop";
  confidence: number;
  offset_ms: number;
}

export interface UtteranceMetadata {
  startOffsetMs: number;
  endOffsetMs?: number;
  locale: string;
  serverVad?: ServerVadSignal;
  clientVad?: ClientVadSignal;
  redactionsApplied?: RedactionMatch[];
  chunkCount: number;
}

export type UtteranceStatus = "pending" | "partial" | "final" | "archived";

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

export interface TranscriptEntry extends UtteranceSnapshot {
  final: boolean;
  sequence: number;
}

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

export interface SessionInfoLike {
  sessionId: string;
  correlationId?: string;
  userId?: string;
}

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

export type PauseReason =
  | "credential-renewal"
  | "network-loss"
  | "user-requested"
  | "system-overload";

export type TranscriptEventHandler = (
  event: TranscriptEvent,
) => void | Promise<void>;
export type TranscriptionStatusHandler = (
  event: TranscriptionStatusEvent,
) => void | Promise<void>;
export type TranscriptionErrorHandler = (
  event: TranscriptionErrorEvent,
) => void | Promise<void>;

export type TranscriptEvent =
  | TranscriptDeltaEvent
  | TranscriptFinalEvent
  | TranscriptRedoEvent
  | TranscriptClearedEvent;

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

export interface TranscriptFinalEvent {
  type: "transcript-final";
  sessionId: string;
  utteranceId: string;
  content: string;
  confidence?: number;
  timestamp: string;
  metadata: UtteranceMetadata;
}

export interface TranscriptRedoEvent {
  type: "transcript-redo";
  sessionId: string;
  utteranceId: string;
  previousContent: string;
  replacementContent: string;
  reason: "desync" | "confidence-drop" | "redaction";
  timestamp: string;
}

export interface TranscriptClearedEvent {
  type: "transcript-cleared";
  sessionId: string;
  clearedAt: string;
  reason: "user-requested" | "privacy-policy" | "session-end";
}

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

export interface AzureAnnotation {
  type: string;
  [key: string]: unknown;
}

export interface AzureRealtimeTranscriptMessage {
  type:
    | "response.output_audio_transcript.delta"
    | "response.done"
    | "session.updated"
    | "conversation.item.audio_transcription.delta"
    | "conversation.item.audio_transcription.completed";
  response_id: string;
  item_id: string;
  delta?: {
    text?: string;
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

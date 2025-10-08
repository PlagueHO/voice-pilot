import { ServiceInitializable } from "../core/service-initializable";

/**
 * Transport mechanisms supported by the Text-to-Speech service layer.
 *
 * @remarks
 * WebRTC is preferred for low-latency duplex audio; WebSocket is retained as a
 * compatibility fallback for environments where WebRTC is unavailable.
 */
export type TtsTransport = "webrtc" | "websocket";

/**
 * Fallback behaviors applied when realtime audio cannot be delivered.
 */
export type TtsFallbackMode = "text-only" | "retry";

export interface Disposable {
  dispose(): void;
}

/**
 * Tunable speech characteristics applied to synthesized audio.
 */
export interface ProsodyConfig {
  rate?: number;
  pitch?: number;
  volume?: number;
}

/**
 * Describes a voice profile that can be selected when issuing speak requests.
 */
export interface TtsVoiceProfile {
  name: string;
  locale: string;
  style?: string;
  gender?: "female" | "male" | "unspecified";
  providerVoiceId?: string;
  description?: string;
}

/**
 * Configuration contract used when initializing the Text-to-Speech service.
 */
export interface TtsServiceConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  transport: TtsTransport;
  defaultVoice: TtsVoiceProfile;
  fallbackMode: TtsFallbackMode;
  maxInitialLatencyMs: number;
  defaultProsody?: ProsodyConfig;
}

/**
 * Payload describing the text and optional metadata for a speak request.
 */
export interface TtsSpeakRequest {
  text: string;
  voice?: Partial<TtsVoiceProfile>;
  surfaceHints?: string[];
  prosody?: ProsodyConfig;
  metadata?: {
    conversationId: string;
    copilotRequestId?: string;
  };
}

/**
 * Handle returned from speak requests for tracking lifecycle and state.
 */
export interface TtsSpeakHandle {
  id: string;
  state: "pending" | "speaking" | "paused" | "stopped" | "completed" | "failed";
  enqueuedAt: number;
  startedAt?: number;
  stoppedAt?: number;
  error?: TtsError;
}

/**
 * Aggregated playback metrics emitted during active sessions.
 */
export interface TtsPlaybackMetrics {
  averageChunkLatencyMs: number;
  bufferedDurationMs: number;
  totalChunks: number;
  droppedChunks: number;
  averageAudioLevel: number;
  peakAudioLevel: number;
  lastUpdated: number;
}

/**
 * Discriminated union of playback events raised during audio rendering.
 */
export type TtsPlaybackEventType =
  | "speaking-state-changed"
  | "chunk-received"
  | "chunk-played"
  | "playback-error"
  | "playback-complete"
  | "interrupted"
  | "metrics-updated";

/**
 * Error contract surfaced to callers when synthesis or playback fails.
 */
export interface TtsError {
  code:
    | "AUTH_FAILED"
    | "NETWORK_ERROR"
    | "STREAM_TIMEOUT"
    | "UNSUPPORTED_VOICE"
    | "UNKNOWN";
  message: string;
  recoverable: boolean;
}

/**
 * Event payload emitted to subscribers listening for playback state changes.
 */
export interface TtsPlaybackEvent {
  type: TtsPlaybackEventType;
  handleId: string;
  timestamp: number;
  data?: {
    state?: "idle" | "speaking" | "paused" | "stopping";
    chunkSize?: number;
    chunkBase64?: string;
    transcriptDelta?: string;
    latencyMs?: number;
    audioLevel?: number;
    metrics?: TtsPlaybackMetrics;
    error?: TtsError;
  };
}

/**
 * Summarized playback state provided to UI layers for display and control.
 */
export interface TtsPlaybackState {
  status: "idle" | "buffering" | "speaking" | "paused";
  bufferMs: number;
  activeVoice: string;
  averageLatencyMs: number;
}

/**
 * Metadata describing each synthesized audio chunk in a playback stream.
 */
export interface ChunkMetadata {
  sequence: number;
  durationMs: number;
  transcript?: string;
}

/**
 * Public contract for the audio playback pipeline used by Text-to-Speech.
 */
export interface PlaybackPipeline {
  prime(): Promise<void>;
  enqueue(chunk: ArrayBuffer, metadata: ChunkMetadata): Promise<void>;
  fadeOut(durationMs: number): Promise<void>;
  flush(): Promise<void>;
  getBufferedDuration(): number;
  onStateChange(callback: (state: TtsPlaybackState) => void): Disposable;
}

/**
 * Primary service interface exposed to consumers requiring synthesized speech.
 */
export interface TextToSpeechService extends ServiceInitializable {
  initialize(): Promise<void>;
  initialize(config: TtsServiceConfig): Promise<void>;
  speak(request: TtsSpeakRequest): Promise<TtsSpeakHandle>;
  stop(handleId?: string): Promise<void>;
  pause(handleId: string): Promise<void>;
  resume(handleId: string): Promise<void>;
  updateVoiceProfile(profile: Partial<TtsVoiceProfile>): Promise<void>;
  onPlaybackEvent(listener: (event: TtsPlaybackEvent) => void): Disposable;
  getActiveHandle(): TtsSpeakHandle | null;
  getMetrics(): TtsPlaybackMetrics;
}

export type { ProsodyConfig as TtsProsodyConfig };

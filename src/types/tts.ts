import { ServiceInitializable } from "../core/service-initializable";

export type TtsTransport = "webrtc" | "websocket";
export type TtsFallbackMode = "text-only" | "retry";

export interface Disposable {
  dispose(): void;
}

export interface ProsodyConfig {
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface TtsVoiceProfile {
  name: string;
  locale: string;
  style?: string;
  gender?: "female" | "male" | "unspecified";
  providerVoiceId?: string;
  description?: string;
}

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

export interface TtsSpeakHandle {
  id: string;
  state: "pending" | "speaking" | "paused" | "stopped" | "completed" | "failed";
  enqueuedAt: number;
  startedAt?: number;
  stoppedAt?: number;
  error?: TtsError;
}

export interface TtsPlaybackMetrics {
  averageChunkLatencyMs: number;
  bufferedDurationMs: number;
  totalChunks: number;
  droppedChunks: number;
  averageAudioLevel: number;
  peakAudioLevel: number;
  lastUpdated: number;
}

export type TtsPlaybackEventType =
  | "speaking-state-changed"
  | "chunk-received"
  | "chunk-played"
  | "playback-error"
  | "playback-complete"
  | "interrupted"
  | "metrics-updated";

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

export interface TtsPlaybackState {
  status: "idle" | "buffering" | "speaking" | "paused";
  bufferMs: number;
  activeVoice: string;
  averageLatencyMs: number;
}

export interface ChunkMetadata {
  sequence: number;
  durationMs: number;
  transcript?: string;
}

export interface PlaybackPipeline {
  prime(): Promise<void>;
  enqueue(chunk: ArrayBuffer, metadata: ChunkMetadata): Promise<void>;
  fadeOut(durationMs: number): Promise<void>;
  flush(): Promise<void>;
  getBufferedDuration(): number;
  onStateChange(callback: (state: TtsPlaybackState) => void): Disposable;
}

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

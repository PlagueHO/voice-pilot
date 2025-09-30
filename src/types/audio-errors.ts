import type {
  AudioCaptureConfig,
  AudioCaptureSampleRate,
  AudioProcessingConfig,
} from "./audio-capture";

/**
 * Enumerates known audio pipeline error classifications surfaced to the extension.
 *
 * @remarks
 * These codes mirror failures encountered during capture, processing, and device
 * lifecycle events. Consumers should branch on the enum rather than
 * string-comparing error messages to ensure compatibility with future changes.
 */
export enum AudioErrorCode {
  PermissionDenied = "PERMISSION_DENIED",
  DeviceNotFound = "DEVICE_NOT_FOUND",
  DeviceUnavailable = "DEVICE_UNAVAILABLE",
  StreamEnded = "STREAM_ENDED",
  ContextSuspended = "CONTEXT_SUSPENDED",
  ProcessingGraphFailed = "PROCESSING_GRAPH_FAILED",
  VoiceActivityFailure = "VOICE_ACTIVITY_FAILURE",
  BufferUnderrun = "BUFFER_UNDERRUN",
  UnsupportedConfiguration = "UNSUPPORTED_CONFIGURATION",
  ConfigurationInvalid = "CONFIGURATION_INVALID",
}

/**
 * Supplemental diagnostic information describing the environment in which an
 * audio failure occurred.
 *
 * @property deviceId - Identifier returned by the media device enumeration API.
 * @property trackId - Unique track identifier for the captured audio stream.
 * @property streamId - Identifier for the underlying `MediaStream` instance.
 * @property captureConfig - Snapshot of the capture configuration active during the failure.
 * @property processingConfig - Snapshot of the processing pipeline configuration when the error occurred.
 * @property mediaDevicesSupported - Indicates whether `navigator.mediaDevices` is available in the runtime.
 * @property getUserMediaSupported - Indicates whether `navigator.mediaDevices.getUserMedia` is exposed.
 */
export interface AudioErrorContext {
  deviceId?: string;
  trackId?: string;
  streamId?: string;
  captureConfig?: Partial<AudioCaptureConfig>;
  processingConfig?: Partial<AudioProcessingConfig>;
  sampleRate?: AudioCaptureSampleRate;
  channelCount?: number;
  bufferSize?: number;
  userAgent?: string;
  webAudioSupported?: boolean;
  mediaDevicesSupported: boolean;
  getUserMediaSupported: boolean;
  permissionsStatus?: PermissionState | "unknown";
}

/**
 * Indicates the severity level associated with an audio processing error.
 */
export enum AudioErrorSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Fatal = "fatal",
}

/**
 * Provides structured guidance on how a recoverable error should be handled.
 */
export interface AudioErrorRecoveryMetadata {
  /** Whether the scenario is expected to succeed after retrying. */
  recoverable: boolean;
  /** Next action the pipeline should take when recovery is possible. */
  recommendedAction?: "retry" | "fallback" | "prompt";
  /** Optional delay before initiating the next recovery attempt. */
  retryAfterMs?: number;
  /** Optional human-readable hint that can be surfaced to the UI. */
  guidance?: string;
  /** Current attempt count when retries are orchestrated by the caller. */
  attempt?: number;
  /** Maximum number of recommended attempts for automated recovery. */
  attemptLimit?: number;
}

/**
 * Standardized audio pipeline error surface returned by capture and processing services.
 *
 * @remarks
 * Errors are intended to be logged, surfaced to telemetry, and, when
 * `recoverable` is `true`, retried automatically by orchestration logic.
 */
export interface AudioProcessingError {
  code: AudioErrorCode;
  message: string;
  severity: AudioErrorSeverity;
  recoverable: boolean;
  recovery?: AudioErrorRecoveryMetadata;
  context?: AudioErrorContext;
  cause?: unknown;
  timestamp: number;
}

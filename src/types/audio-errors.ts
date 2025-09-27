import type {
  AudioCaptureConfig,
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
  mediaDevicesSupported: boolean;
  getUserMediaSupported: boolean;
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
  recoverable: boolean;
  context?: AudioErrorContext;
  cause?: unknown;
  timestamp: number;
}

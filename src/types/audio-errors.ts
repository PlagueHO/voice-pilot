import type { AudioCaptureConfig, AudioProcessingConfig } from './audio-capture';

export enum AudioErrorCode {
    PermissionDenied = 'PERMISSION_DENIED',
    DeviceNotFound = 'DEVICE_NOT_FOUND',
    DeviceUnavailable = 'DEVICE_UNAVAILABLE',
    StreamEnded = 'STREAM_ENDED',
    ContextSuspended = 'CONTEXT_SUSPENDED',
    ProcessingGraphFailed = 'PROCESSING_GRAPH_FAILED',
    VoiceActivityFailure = 'VOICE_ACTIVITY_FAILURE',
    BufferUnderrun = 'BUFFER_UNDERRUN',
    UnsupportedConfiguration = 'UNSUPPORTED_CONFIGURATION',
    ConfigurationInvalid = 'CONFIGURATION_INVALID'
}

export interface AudioErrorContext {
    deviceId?: string;
    trackId?: string;
    streamId?: string;
    captureConfig?: Partial<AudioCaptureConfig>;
    processingConfig?: Partial<AudioProcessingConfig>;
    mediaDevicesSupported: boolean;
    getUserMediaSupported: boolean;
}

export interface AudioProcessingError {
    code: AudioErrorCode;
    message: string;
    recoverable: boolean;
    context?: AudioErrorContext;
    cause?: unknown;
    timestamp: number;
}

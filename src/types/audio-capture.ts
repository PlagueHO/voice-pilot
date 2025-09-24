import { ServiceInitializable } from '../core/service-initializable';
import type { AudioProcessingError } from './audio-errors';

export type NoiseSuppressionLevel = 'low' | 'medium' | 'high';
export type EchoCancellationLevel = 'low' | 'medium' | 'high';
export type AutoGainControlLevel = 'off' | 'low' | 'medium' | 'high';

declare type AudioContextLatencyHint = AudioContextLatencyCategory | number;

export interface AudioCaptureConfig {
    deviceId?: string;
    sampleRate: number;
    channelCount: number;
    bufferSize: number;
    latencyHint?: AudioContextLatencyHint;
    enableNoiseSuppression: boolean;
    enableEchoCancellation: boolean;
    enableAutoGainControl: boolean;
}

export interface AudioProcessingConfig {
    noiseSuppressionLevel: NoiseSuppressionLevel;
    echoCancellationLevel: EchoCancellationLevel;
    autoGainControlLevel: AutoGainControlLevel;
    voiceActivitySensitivity: number;
    analysisIntervalMs: number;
}

export interface VoiceActivityResult {
    isVoiceDetected: boolean;
    confidence: number;
    threshold: number;
    timestamp: number;
}

export interface AudioMetrics {
    inputLevel: number;
    peakLevel: number;
    rmsLevel: number;
    signalToNoiseRatio: number;
    latencyEstimate: number;
    bufferHealth: number;
    droppedFrameCount: number;
    totalFrameCount: number;
    analysisWindowMs: number;
    updatedAt: number;
}

export type AudioCaptureEventType =
    | 'captureStarted'
    | 'captureStopped'
    | 'audioLevelChanged'
    | 'deviceChanged'
    | 'voiceActivity'
    | 'processingError'
    | 'qualityChanged'
    | 'metricsUpdated';

export interface AudioCaptureEvent<TType extends AudioCaptureEventType = AudioCaptureEventType, TData = unknown> {
    type: TType;
    timestamp: number;
    data?: TData;
}

export type AudioCaptureEventHandler<TEvent extends AudioCaptureEvent = AudioCaptureEvent> = (event: TEvent) => void | Promise<void>;

export interface CaptureStartedEvent extends AudioCaptureEvent<'captureStarted'> {
    data: {
        streamId: string;
        trackId: string;
        settings: MediaTrackSettings;
    };
}

export interface CaptureStoppedEvent extends AudioCaptureEvent<'captureStopped'> {
    data: {
        streamId?: string;
        trackId?: string;
        reason?: string;
    };
}

export interface AudioLevelChangedEvent extends AudioCaptureEvent<'audioLevelChanged'> {
    data: {
        level: number;
        peak: number;
        rms: number;
    };
}

export interface DeviceChangedEvent extends AudioCaptureEvent<'deviceChanged'> {
    data: {
        deviceId: string;
        label?: string;
    };
}

export interface VoiceActivityEvent extends AudioCaptureEvent<'voiceActivity'> {
    data: VoiceActivityResult;
}

export interface ProcessingErrorEvent extends AudioCaptureEvent<'processingError'> {
    data: AudioProcessingError;
}

export interface QualityChangedEvent extends AudioCaptureEvent<'qualityChanged'> {
    data: {
        quality: 'excellent' | 'good' | 'fair' | 'poor';
        reason?: string;
    };
}

export interface MetricsUpdatedEvent extends AudioCaptureEvent<'metricsUpdated'> {
    data: AudioMetrics;
}

export type AudioCapturePipelineEvent =
    | CaptureStartedEvent
    | CaptureStoppedEvent
    | AudioLevelChangedEvent
    | DeviceChangedEvent
    | VoiceActivityEvent
    | ProcessingErrorEvent
    | QualityChangedEvent
    | MetricsUpdatedEvent;

export interface DeviceValidationResult {
    isValid: boolean;
    deviceId: string;
    label?: string;
    capabilities?: MediaTrackCapabilities;
    settings?: MediaTrackSettings;
    error?: AudioProcessingError;
}

export interface AudioProcessingGraph {
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    gainNode: GainNode;
    analyserNode: AnalyserNode;
    destination?: AudioNode;
    workletNode?: AudioWorkletNode;
}

export interface AudioProcessingChain {
    createProcessingGraph(stream: MediaStream, config: AudioProcessingConfig): Promise<AudioProcessingGraph>;
    updateProcessingParameters(graph: AudioProcessingGraph, config: Partial<AudioProcessingConfig>): Promise<void>;
    analyzeAudioLevel(graph: AudioProcessingGraph): AudioMetrics;
    measureLatency(context: AudioContext): Promise<number>;
    disposeGraph(graph: AudioProcessingGraph): void;
}

export interface AudioCapturePipeline extends ServiceInitializable {
    initialize(config?: Partial<AudioCaptureConfig>, processingConfig?: Partial<AudioProcessingConfig>): Promise<void>;
    startCapture(): Promise<void>;
    stopCapture(): Promise<void>;
    getCaptureStream(): MediaStream | null;
    getCaptureTrack(): MediaStreamTrack | null;
    replaceCaptureTrack(deviceId: string): Promise<MediaStreamTrack>;
    updateCaptureConfig(config: Partial<AudioCaptureConfig>): Promise<void>;
    updateProcessingConfig(config: Partial<AudioProcessingConfig>): Promise<void>;
    validateAudioDevice(deviceId: string): Promise<DeviceValidationResult>;
    getAudioMetrics(): AudioMetrics;
    getAudioLevel(): number;
    detectVoiceActivity(): Promise<VoiceActivityResult>;
    addEventListener<TEvent extends AudioCapturePipelineEvent>(type: TEvent['type'], handler: AudioCaptureEventHandler<TEvent>): void;
    removeEventListener<TEvent extends AudioCapturePipelineEvent>(type: TEvent['type'], handler: AudioCaptureEventHandler<TEvent>): void;
}

export interface AudioCaptureSnapshot {
    streamId?: string;
    trackId?: string;
    config: AudioCaptureConfig;
    processingConfig: AudioProcessingConfig;
    metrics: AudioMetrics;
}

export interface AudioTrackStatistics {
    trackId: string;
    label: string;
    kind: string;
    enabled: boolean;
    muted: boolean;
    state: MediaStreamTrackState;
    sampleRate?: number;
    channelCount?: number;
    bitrate?: number;
    jitter?: number;
    packetsLost?: number;
    audioLevel?: number;
    framesPerSecond?: number;
    settings: MediaTrackSettings;
    capabilities?: MediaTrackCapabilities;
}

export interface AudioTrackState {
    trackId: string;
    state: MediaStreamTrackState;
    muted: boolean;
    enabled: boolean;
    ready: boolean;
    ended: boolean;
}

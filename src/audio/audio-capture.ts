import { Logger } from '../core/logger';
import {
    AudioCaptureConfig,
    AudioCaptureEventHandler,
    AudioCaptureEventType,
    AudioCapturePipeline,
    AudioCapturePipelineEvent,
    AudioMetrics,
    AudioProcessingConfig,
    AudioProcessingGraph,
    DeviceValidationResult,
    VoiceActivityResult
} from '../types/audio-capture';
import { AudioErrorCode, AudioProcessingError } from '../types/audio-errors';
import { createEmptyMetrics, mergeMetrics } from './audio-metrics';
import { WebAudioProcessingChain } from './audio-processing-chain';
import { AudioDeviceValidator } from './device-validator';

const DEFAULT_CAPTURE_CONFIG: AudioCaptureConfig = {
    deviceId: undefined,
    sampleRate: 24000,
    channelCount: 1,
    bufferSize: 4096,
    latencyHint: 'interactive',
    enableNoiseSuppression: true,
    enableEchoCancellation: true,
    enableAutoGainControl: true
};

const DEFAULT_PROCESSING_CONFIG: AudioProcessingConfig = {
    noiseSuppressionLevel: 'medium',
    echoCancellationLevel: 'medium',
    autoGainControlLevel: 'medium',
    voiceActivitySensitivity: 0.65,
    analysisIntervalMs: 100
};

const PCM_SCALE = 0x7fff;

type EventHandlerSet = Set<AudioCaptureEventHandler>;

/**
 * Audio capture service implementing the audio capture pipeline contract.
 * Provides microphone capture with noise suppression, audio metrics, and PCM output suitable for Azure OpenAI Realtime API.
 */
export class AudioCapture implements AudioCapturePipeline {
    private readonly logger: Logger;
    private readonly processingChain: WebAudioProcessingChain;
    private readonly deviceValidator: AudioDeviceValidator;
    private readonly listeners = new Map<AudioCaptureEventType, EventHandlerSet>();
    private readonly audioDataCallbacks = new Set<(audioData: Buffer) => void>();

    private initialized = false;
    private isCapturing = false;

    private captureConfig: AudioCaptureConfig;
    private processingConfig: AudioProcessingConfig;

    private stream: MediaStream | null = null;
    private track: MediaStreamTrack | null = null;
    private processingGraph: AudioProcessingGraph | null = null;

    private metrics: AudioMetrics = createEmptyMetrics();
    private metricsTimerId?: ReturnType<typeof setInterval>;

    private onErrorCallback?: (error: Error) => void;

    constructor(config: Partial<AudioCaptureConfig> = {}, logger?: Logger) {
        this.logger = logger || new Logger('AudioCapture');
    this.processingChain = new WebAudioProcessingChain(this.logger);
    this.deviceValidator = new AudioDeviceValidator(this.logger);
        this.captureConfig = { ...DEFAULT_CAPTURE_CONFIG, ...config };
        this.processingConfig = { ...DEFAULT_PROCESSING_CONFIG };
    }

    async initialize(config?: Partial<AudioCaptureConfig>, processingConfig?: Partial<AudioProcessingConfig>): Promise<void> {
        if (config) {
            this.captureConfig = { ...this.captureConfig, ...config };
        }

        if (processingConfig) {
            this.processingConfig = { ...this.processingConfig, ...processingConfig };
        }

        if (!navigator?.mediaDevices?.getUserMedia) {
            throw new Error('MediaDevices.getUserMedia is not available in this environment');
        }

        await navigator.mediaDevices.enumerateDevices();
        this.initialized = true;
        this.logger.info('Audio capture initialized', { config: this.captureConfig, processingConfig: this.processingConfig });
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    async startCapture(): Promise<void> {
        if (!this.initialized) {
            throw new Error('Audio capture not initialized');
        }

        if (this.isCapturing) {
            this.logger.warn('Audio capture already active');
            return;
        }

        try {
            const validation = await this.deviceValidator.validateDevice(this.captureConfig.deviceId);
            if (!validation.isValid) {
                const processingError = validation.error ?? this.createProcessingError(
                    AudioErrorCode.DeviceUnavailable,
                    'Audio device validation failed',
                    false
                );
                throw processingError;
            }

            this.captureConfig.deviceId = validation.deviceId;

            const stream = await this.acquireStream(validation.deviceId);
            const graph = await this.processingChain.createProcessingGraph(stream, this.processingConfig);
            await this.ensureContextIsRunning(graph.context);
            this.registerContextStateHandler(graph.context);

            this.stream = stream;
            this.track = stream.getAudioTracks()[0] ?? null;
            this.processingGraph = graph;

            this.registerProcessorCallback();
            await this.updateLatencyMetric();
            this.startMetricsMonitor();

            this.isCapturing = true;
            this.logger.info('Audio capture started', {
                trackId: this.track?.id,
                deviceId: this.captureConfig.deviceId
            });

            this.emitEvent('captureStarted', {
                streamId: this.stream?.id ?? '',
                trackId: this.track?.id ?? '',
                settings: this.track?.getSettings() ?? {}
            });

            if (this.track) {
                this.emitEvent('deviceChanged', {
                    deviceId: this.track.getSettings().deviceId ?? this.captureConfig.deviceId ?? 'default',
                    label: this.track.label
                });
            }
        } catch (error: any) {
            this.handleError('Failed to start audio capture', error);
            const thrownError = error instanceof Error
                ? error
                : new Error((error as AudioProcessingError)?.message ?? 'Failed to start audio capture');
            throw thrownError;
        }
    }

    async stopCapture(): Promise<void> {
        if (!this.isCapturing) {
            return;
        }

        const streamId = this.stream?.id;
        const trackId = this.track?.id;

        this.stopMetricsMonitor();

        if (this.processingGraph) {
            this.processingGraph.context.onstatechange = null;
            this.processingChain.disposeGraph(this.processingGraph);
        }
        this.processingGraph = null;

        this.stopStream();

        this.isCapturing = false;
        this.emitEvent('captureStopped', {
            streamId,
            trackId,
            reason: 'user-request'
        });

        this.logger.info('Audio capture stopped');
    }

    getCaptureStream(): MediaStream | null {
        return this.stream;
    }

    getCaptureTrack(): MediaStreamTrack | null {
        return this.track;
    }

    async replaceCaptureTrack(deviceId: string): Promise<MediaStreamTrack> {
        let candidateStream: MediaStream | null = null;
        let candidateTrack: MediaStreamTrack | null = null;
        let candidateGraph: AudioProcessingGraph | null = null;

        try {
            const validation = await this.deviceValidator.validateDevice(deviceId);
            if (!validation.isValid) {
                const processingError = validation.error ?? this.createProcessingError(
                    AudioErrorCode.DeviceUnavailable,
                    'Audio device validation failed',
                    false
                );
                throw processingError;
            }

            candidateStream = await this.acquireStream(validation.deviceId);
            candidateTrack = candidateStream.getAudioTracks()[0] ?? null;

            if (!candidateTrack) {
                throw new Error('Unable to obtain audio track from new device');
            }

            if (!this.isCapturing) {
                throw new Error('Cannot replace capture track when audio capture is inactive');
            }

            this.stopMetricsMonitor();
            if (this.processingGraph) {
                this.processingGraph.context.onstatechange = null;
                this.processingChain.disposeGraph(this.processingGraph);
                this.processingGraph = null;
            }
            this.stopStream();

            candidateGraph = await this.processingChain.createProcessingGraph(candidateStream, this.processingConfig);
            await this.ensureContextIsRunning(candidateGraph.context);
            this.registerContextStateHandler(candidateGraph.context);

            this.stream = candidateStream;
            this.track = candidateTrack;
            this.processingGraph = candidateGraph;

            this.registerProcessorCallback();
            await this.updateLatencyMetric();
            this.startMetricsMonitor();

            this.captureConfig.deviceId = validation.deviceId;
            this.emitEvent('deviceChanged', {
                deviceId: validation.deviceId,
                label: this.track?.label
            });

            // Ownership transferred to class properties; prevent cleanup in finally block.
            candidateStream = null;
            candidateGraph = null;

            return this.track!;
        } catch (error: any) {
            if (candidateStream) {
                candidateStream.getTracks().forEach(track => track.stop());
            }

            if (candidateGraph) {
                this.processingChain.disposeGraph(candidateGraph);
            }

            this.handleError('Failed to replace capture track', error);
            const thrownError = error instanceof Error
                ? error
                : new Error((error as AudioProcessingError)?.message ?? 'Failed to replace capture track');
            throw thrownError;
        }
    }

    async updateCaptureConfig(config: Partial<AudioCaptureConfig>): Promise<void> {
        this.captureConfig = { ...this.captureConfig, ...config };

        if (this.isCapturing) {
            await this.restartCapture();
        }
    }

    async updateProcessingConfig(config: Partial<AudioProcessingConfig>): Promise<void> {
        this.processingConfig = { ...this.processingConfig, ...config };

        if (this.processingGraph) {
            await this.processingChain.updateProcessingParameters(this.processingGraph, config);
        }
    }

    async validateAudioDevice(deviceId: string): Promise<DeviceValidationResult> {
        return this.deviceValidator.validateDevice(deviceId);
    }

    getAudioMetrics(): AudioMetrics {
        return this.metrics;
    }

    getAudioLevel(): number {
        return this.metrics.inputLevel;
    }

    async detectVoiceActivity(): Promise<VoiceActivityResult> {
        const threshold = Math.min(Math.max(this.processingConfig.voiceActivitySensitivity, 0.05), 0.95);
        const isVoiceDetected = this.metrics.rmsLevel >= threshold;

        return {
            isVoiceDetected,
            confidence: Math.min(Math.max(this.metrics.rmsLevel, 0), 1),
            threshold,
            timestamp: Date.now()
        };
    }

    addEventListener<TEvent extends AudioCapturePipelineEvent>(type: TEvent['type'], handler: AudioCaptureEventHandler<TEvent>): void {
        const handlers = this.listeners.get(type) ?? new Set();
        handlers.add(handler as AudioCaptureEventHandler);
        this.listeners.set(type, handlers);
    }

    removeEventListener<TEvent extends AudioCapturePipelineEvent>(type: TEvent['type'], handler: AudioCaptureEventHandler<TEvent>): void {
        const handlers = this.listeners.get(type);
        handlers?.delete(handler as AudioCaptureEventHandler);
        if (handlers && handlers.size === 0) {
            this.listeners.delete(type);
        }
    }

    onAudioData(callback: (audioData: Buffer) => void): void {
        this.audioDataCallbacks.add(callback);
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    isCaptureActive(): boolean {
        return this.isCapturing;
    }

    dispose(): void {
        void this.stopCapture();
        this.listeners.clear();
        this.audioDataCallbacks.clear();
        this.onErrorCallback = undefined;
        this.initialized = false;
    }

    private async acquireStream(deviceId?: string): Promise<MediaStream> {
        const constraints: MediaStreamConstraints = {
            audio: {
                channelCount: this.captureConfig.channelCount,
                sampleRate: this.captureConfig.sampleRate,
                echoCancellation: this.captureConfig.enableEchoCancellation,
                noiseSuppression: this.captureConfig.enableNoiseSuppression,
                autoGainControl: this.captureConfig.enableAutoGainControl,
                deviceId: deviceId ? { exact: deviceId } : undefined
            }
        };

        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error: any) {
            const processingError = this.mapGetUserMediaError(error, deviceId);
            throw processingError;
        }
    }

    private registerProcessorCallback(): void {
        if (!this.processingGraph) {
            return;
        }

        const processorNode = this.processingGraph.destination as ScriptProcessorNode | undefined;
        if (!processorNode) {
            this.logger.warn('Audio processing graph does not include a processor node');
            return;
        }

        processorNode.onaudioprocess = (event) => {
            if (!this.isCapturing) {
                return;
            }

            const inputBuffer = event.inputBuffer;
            const channelData = inputBuffer.getChannelData(0);
            const pcm = this.float32ToPCM16(channelData);
            this.notifyAudioCallbacks(pcm);
        };
    }

    private notifyAudioCallbacks(audioData: Buffer): void {
        for (const callback of this.audioDataCallbacks) {
            try {
                callback(audioData);
            } catch (error: any) {
                this.logger.error('Audio data callback failed', { error: error?.message });
            }
        }
    }

    private startMetricsMonitor(): void {
        const interval = this.processingConfig.analysisIntervalMs ?? DEFAULT_PROCESSING_CONFIG.analysisIntervalMs;
        this.metricsTimerId = setInterval(() => {
            void this.updateMetrics();
        }, interval);
    }

    private stopMetricsMonitor(): void {
        if (typeof this.metricsTimerId !== 'undefined') {
            clearInterval(this.metricsTimerId);
            this.metricsTimerId = undefined;
        }
    }

    private async updateMetrics(): Promise<void> {
        if (!this.processingGraph) {
            return;
        }

        const metrics = this.processingChain.analyzeAudioLevel(this.processingGraph);
        const latency = await this.processingChain.measureLatency(this.processingGraph.context);

        this.metrics = mergeMetrics(metrics, { latencyEstimate: latency });

        this.emitEvent('metricsUpdated', this.metrics);
        this.emitEvent('audioLevelChanged', {
            level: this.metrics.inputLevel,
            peak: this.metrics.peakLevel,
            rms: this.metrics.rmsLevel
        });

        const vad = await this.detectVoiceActivity();
        if (vad.isVoiceDetected) {
            this.emitEvent('voiceActivity', vad);
        }
    }

    private async updateLatencyMetric(): Promise<void> {
        if (!this.processingGraph) {
            return;
        }

        const latency = await this.processingChain.measureLatency(this.processingGraph.context);
        this.metrics = mergeMetrics(this.metrics, { latencyEstimate: latency });
    }

    private stopStream(): void {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        this.stream = null;
        this.track = null;
    }

    private async restartCapture(): Promise<void> {
        const wasCapturing = this.isCapturing;
        await this.stopCapture();
        if (wasCapturing) {
            await this.startCapture();
        }
    }

    private float32ToPCM16(data: Float32Array): Buffer {
        const buffer = Buffer.allocUnsafe(data.length * 2);
        for (let i = 0; i < data.length; i++) {
            const clipped = Math.max(-1, Math.min(1, data[i]));
            buffer.writeInt16LE(clipped * PCM_SCALE, i * 2);
        }
        return buffer;
    }

    private emitEvent<TType extends AudioCapturePipelineEvent['type']>(type: TType, data?: Extract<AudioCapturePipelineEvent, { type: TType }>['data']): void {
        const handlers = this.listeners.get(type);
        if (!handlers || handlers.size === 0) {
            return;
        }

        const event = {
            type,
            data,
            timestamp: Date.now()
        } as AudioCapturePipelineEvent;

        handlers.forEach(handler => {
            Promise.resolve(handler(event)).catch(error => {
                this.logger.error('Audio capture event handler failed', { type, error: (error as Error)?.message });
            });
        });
    }

    private mapGetUserMediaError(error: any, deviceId?: string): AudioProcessingError {
        const name = error?.name;
        let code = AudioErrorCode.DeviceUnavailable;
        let recoverable = true;
        let message = error?.message ?? 'Failed to access audio device';

        switch (name) {
            case 'NotAllowedError':
            case 'SecurityError':
                code = AudioErrorCode.PermissionDenied;
                recoverable = false;
                message = 'Microphone access was denied by the user or browser settings';
                break;
            case 'NotFoundError':
            case 'OverconstrainedError':
                code = AudioErrorCode.DeviceNotFound;
                recoverable = false;
                message = deviceId
                    ? `The requested audio device (${deviceId}) is not available`
                    : 'No suitable audio input device found';
                break;
            case 'NotReadableError':
            case 'DeviceInUseError':
            case 'AbortError':
                code = AudioErrorCode.DeviceUnavailable;
                recoverable = true;
                message = 'The selected audio device is currently in use or unavailable';
                break;
            case 'NotSupportedError':
            case 'TypeError':
                code = AudioErrorCode.ConfigurationInvalid;
                recoverable = false;
                message = 'The current audio configuration is not supported';
                break;
            default:
                code = AudioErrorCode.ProcessingGraphFailed;
                recoverable = true;
        }

        return this.createProcessingError(code, message, recoverable, error);
    }

    private async ensureContextIsRunning(context: AudioContext): Promise<void> {
        if (context.state === 'suspended') {
            try {
                await context.resume();
                this.logger.warn('Audio context resumed after suspension');
            } catch (error: any) {
                const processingError = this.createProcessingError(
                    AudioErrorCode.ProcessingGraphFailed,
                    'Failed to resume audio context',
                    true,
                    error
                );
                this.emitEvent('processingError', processingError);
            }
        }
    }

    private registerContextStateHandler(context: AudioContext): void {
        context.onstatechange = () => {
            if (context.state === 'suspended') {
                void context.resume().catch(error => {
                    const processingError = this.createProcessingError(
                        AudioErrorCode.ProcessingGraphFailed,
                        'Audio context suspended and failed to resume',
                        true,
                        error
                    );
                    this.emitEvent('processingError', processingError);
                    this.logger.error('Audio context suspension detected', { error: (error as Error)?.message });
                });
            }
        };
    }

    private createProcessingError(code: AudioErrorCode, message: string, recoverable: boolean, cause?: unknown): AudioProcessingError {
        return {
            code,
            message,
            recoverable,
            timestamp: Date.now(),
            context: {
                deviceId: this.captureConfig.deviceId,
                trackId: this.track?.id,
                streamId: this.stream?.id,
                captureConfig: this.captureConfig,
                processingConfig: this.processingConfig,
                mediaDevicesSupported: !!navigator?.mediaDevices,
                getUserMediaSupported: !!navigator?.mediaDevices?.getUserMedia
            },
            cause
        };
    }

    private handleError(message: string, cause: any): void {
        if (this.isProcessingError(cause)) {
            this.emitEvent('processingError', cause);
            this.logger.error(message, { error: cause.message, code: cause.code });
            this.onErrorCallback?.(new Error(cause.message));
            return;
        }

        const error = cause instanceof Error ? cause : new Error(message);
        const processingError = this.createProcessingError(AudioErrorCode.ProcessingGraphFailed, message, true, cause);
        this.emitEvent('processingError', processingError);
        this.logger.error(message, { error: error.message });
        this.onErrorCallback?.(error);
    }

    private isProcessingError(value: unknown): value is AudioProcessingError {
        return Boolean(value && typeof value === 'object' && 'code' in (value as Record<string, unknown>) && 'message' in (value as Record<string, unknown>));
    }
}

import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import type {
    AudioCaptureConfig,
    AudioLevelChangedEvent,
    AudioMetrics,
    AudioProcessingConfig,
    CaptureStartedEvent,
    CaptureStoppedEvent,
    MetricsUpdatedEvent,
    ProcessingErrorEvent,
    VoiceActivityEvent
} from '../types/audio-capture';
import { TurnDetectionConfig } from '../types/configuration';
import { AudioCapture } from './audio-capture';
import { AudioChunk, AudioTranscript, RealtimeAudioConfig, RealtimeAudioService } from './realtime-audio-service';
import { AzureTurnDetectionCoordinator, RealtimeTurnEvent } from './turn-detection-coordinator';
import { createDefaultTurnDetectionConfig } from './turn-detection-defaults';

export interface AudioPipelineConfig {
    realtime: RealtimeAudioConfig;
    capture?: Partial<AudioCaptureConfig>;
    captureProcessing?: Partial<AudioProcessingConfig>;
    autoStartSession?: boolean;
    enableEchoCancellation?: boolean;
}

export interface VoiceSessionState {
    isConnected: boolean;
    isRecording: boolean;
    isSpeaking: boolean;
    isUserSpeaking: boolean;
    audioLevel: number;
    latencyEstimate?: number;
    deviceId?: string;
    metrics?: AudioMetrics;
    lastTranscript?: string;
    lastError?: string;
}

/**
 * Integrated audio pipeline service that coordinates all audio components
 * for full duplex voice interaction using Azure OpenAI Realtime API
 */
export class AudioPipelineService implements ServiceInitializable {
    private initialized = false;
    private realtimeService: RealtimeAudioService;
    private audioCapture: AudioCapture;
    private logger: Logger;
    private config: AudioPipelineConfig;
    private turnDetectionCoordinator: AzureTurnDetectionCoordinator;
    private turnDetectionConfig: TurnDetectionConfig;

    // State
    private sessionState: VoiceSessionState = {
        isConnected: false,
        isRecording: false,
        isSpeaking: false,
        isUserSpeaking: false,
        audioLevel: 0
    };

    // Event callbacks
    private onTranscriptCallback?: (transcript: string, isFinal: boolean) => void;
    private onAudioPlaybackCallback?: (audioData: Buffer) => void;
    private onErrorCallback?: (error: Error) => void;
    private sessionStateListeners = new Set<(state: VoiceSessionState) => void>();

    constructor(config: AudioPipelineConfig, logger?: Logger) {
        this.config = {
            ...config,
            realtime: { ...config.realtime }
        };
        this.logger = logger || new Logger('AudioPipelineService');
        this.turnDetectionConfig = this.config.realtime.turnDetection ? { ...this.config.realtime.turnDetection } : createDefaultTurnDetectionConfig();
        this.turnDetectionCoordinator = new AzureTurnDetectionCoordinator(this.turnDetectionConfig, this.logger);

        // Initialize components
        this.realtimeService = new RealtimeAudioService({ ...this.config.realtime, turnDetection: this.turnDetectionConfig }, this.logger);
        this.audioCapture = new AudioCapture(this.config.capture, this.logger);

        this.setupEventHandlers();
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.turnDetectionCoordinator.initialize();
            await this.turnDetectionCoordinator.configure(this.turnDetectionConfig);
            this.realtimeService.setTurnDetectionConfig(this.turnDetectionConfig);
            // Initialize realtime service
            await this.realtimeService.initialize();

            // Initialize audio capture
            await this.audioCapture.initialize(this.config.capture, this.config.captureProcessing);

            // Auto-start session if configured
            if (this.config.autoStartSession) {
                await this.startSession();
            }

            this.initialized = true;
            this.logger.info('Audio pipeline initialized successfully');
        } catch (error: any) {
            this.logger.error('Failed to initialize audio pipeline', { error: error.message });
            throw error;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    dispose(): void {
        void this.stopSession();
        this.realtimeService.dispose();
        this.audioCapture.dispose();
        this.turnDetectionCoordinator.dispose();
        this.initialized = false;
        this.logger.info('Audio pipeline disposed');
    }

    /**
     * Set up event handlers between components
     */
    private setupEventHandlers(): void {
        // Realtime service events
        this.realtimeService.onTranscript((transcript: AudioTranscript) => {
            this.sessionState.lastTranscript = transcript.text;
            this.onTranscriptCallback?.(transcript.text, transcript.isFinal);
            this.emitStateChange();
        });

        this.realtimeService.onAudioChunk((chunk: AudioChunk) => {
            this.sessionState.isSpeaking = true;
            this.onAudioPlaybackCallback?.(chunk.data);
            // Reset speaking state after a delay (could be more sophisticated)
            setTimeout(() => {
                this.sessionState.isSpeaking = false;
                this.emitStateChange();
            }, 100);
        });

        this.realtimeService.onSessionState((state) => {
            this.sessionState.isConnected = (state === 'connected');
            if (state === 'error') {
                this.sessionState.lastError = 'Realtime connection error';
            }
            this.emitStateChange();
        });

        this.realtimeService.onError((error: Error) => {
            this.sessionState.lastError = error.message;
            this.onErrorCallback?.(error);
            this.emitStateChange();
        });

        this.realtimeService.onTurnEvent((event) => {
            this.handleTurnDetectionEvent(event);
        });

        // Audio capture events
        this.audioCapture.addEventListener('captureStarted', (event: CaptureStartedEvent) => {
            this.sessionState.deviceId = event.data.settings.deviceId ?? event.data.trackId;
            this.emitStateChange();
        });

        this.audioCapture.addEventListener('captureStopped', (_event: CaptureStoppedEvent) => {
            this.sessionState.deviceId = undefined;
            this.sessionState.audioLevel = 0;
            this.sessionState.isUserSpeaking = false;
            this.emitStateChange();
        });

        this.audioCapture.addEventListener('audioLevelChanged', (event: AudioLevelChangedEvent) => {
            this.sessionState.audioLevel = event.data.level;
            this.emitStateChange();
        });

        this.audioCapture.addEventListener('metricsUpdated', (event: MetricsUpdatedEvent) => {
            const metrics = event.data;
            this.sessionState.latencyEstimate = metrics.latencyEstimate;
            this.sessionState.metrics = metrics;
            this.emitStateChange();
        });

        this.audioCapture.addEventListener('voiceActivity', (event: VoiceActivityEvent) => {
            this.sessionState.isUserSpeaking = event.data.isVoiceDetected;
            this.emitStateChange();
        });

        this.audioCapture.addEventListener('processingError', (event: ProcessingErrorEvent) => {
            this.sessionState.lastError = event.data.message;
            const error = new Error(event.data.message);
            this.onErrorCallback?.(error);
            this.emitStateChange();
        });

        this.audioCapture.onAudioData(async (audioData: Buffer) => {
            try {
                if (this.sessionState.isConnected && this.sessionState.isRecording) {
                    await this.realtimeService.sendAudioData(audioData);
                }
            } catch (error: any) {
                this.logger.error('Failed to send audio data', { error: error.message });
            }
        });

        this.audioCapture.onError((error: Error) => {
            this.sessionState.lastError = error.message;
            this.onErrorCallback?.(error);
            this.emitStateChange();
        });
    }

    private handleTurnDetectionEvent(event: RealtimeTurnEvent): void {
        try {
            this.turnDetectionCoordinator.handleServerEvent(event);
        } catch (error: any) {
            this.logger.error('Turn detection coordinator failed to process event', { error: error?.message || error, type: event.type });
        }

        let stateChanged = false;
        if (event.type === 'speech-start') {
            if (!this.sessionState.isUserSpeaking) {
                this.sessionState.isUserSpeaking = true;
                stateChanged = true;
            }
        } else if (event.type === 'speech-stop') {
            if (this.sessionState.isUserSpeaking) {
                this.sessionState.isUserSpeaking = false;
                stateChanged = true;
            }
        }

        if (stateChanged) {
            this.emitStateChange();
        }
    }

    /**
     * Start a voice session
     */
    async startSession(): Promise<void> {
        if (!this.initialized) {
            throw new Error('Audio pipeline not initialized');
        }

        try {
            await this.realtimeService.startSession();
            this.logger.info('Voice session started');
        } catch (error: any) {
            this.logger.error('Failed to start voice session', { error: error.message });
            throw error;
        }
    }

    /**
     * Stop the current voice session
     */
    async stopSession(): Promise<void> {
        if (this.sessionState.isRecording) {
            await this.stopRecording();
        } else {
            await this.audioCapture.stopCapture();
        }

        this.realtimeService.stopSession();
        this.sessionState.isConnected = false;
        this.emitStateChange();
        this.logger.info('Voice session stopped');
    }

    /**
     * Start recording microphone input
     */
    async startRecording(): Promise<void> {
        if (!this.sessionState.isConnected) {
            throw new Error('No active voice session');
        }

        await this.audioCapture.startCapture();
        this.realtimeService.startRecording();
        this.sessionState.isRecording = true;
        this.emitStateChange();
        this.logger.info('Started recording audio input');
    }

    /**
     * Stop recording microphone input
     */
    async stopRecording(): Promise<void> {
        await this.audioCapture.stopCapture();
        this.realtimeService.stopRecording();
        this.sessionState.isRecording = false;
        this.emitStateChange();
        this.logger.info('Stopped recording audio input');
    }

    /**
     * Send a text message and get audio response
     */
    async sendTextMessage(text: string): Promise<void> {
        if (!this.sessionState.isConnected) {
            throw new Error('No active voice session');
        }

        try {
            await this.realtimeService.sendTextMessage(text);
            this.logger.debug('Text message sent', { text });
        } catch (error: any) {
            this.logger.error('Failed to send text message', { error: error.message });
            throw error;
        }
    }

    /**
     * Update session configuration
     */
    async updateSessionConfig(config: { instructions?: string; voice?: string; temperature?: number }): Promise<void> {
        await this.realtimeService.updateSessionConfig(config);
        this.logger.debug('Session config updated', config);
    }

    async updateTurnDetection(config: TurnDetectionConfig): Promise<void> {
        this.turnDetectionConfig = { ...config };
        this.config.realtime.turnDetection = this.turnDetectionConfig;
        this.realtimeService.setTurnDetectionConfig(this.turnDetectionConfig);
        if (!this.turnDetectionCoordinator.isInitialized()) {
            await this.turnDetectionCoordinator.initialize();
        }
        await this.turnDetectionCoordinator.configure(this.turnDetectionConfig);
    }

    getTurnDetectionCoordinator(): AzureTurnDetectionCoordinator {
        return this.turnDetectionCoordinator;
    }

    /**
     * Get current session state
     */
    getSessionState(): VoiceSessionState {
        return { ...this.sessionState };
    }

    /**
     * Toggle recording state
     */
    async toggleRecording(): Promise<void> {
        if (this.sessionState.isRecording) {
            await this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    /**
     * Check if the pipeline is ready for voice interaction
     */
    isReady(): boolean {
        return this.initialized && this.sessionState.isConnected;
    }

    // Event callback setters
    onTranscript(callback: (transcript: string, isFinal: boolean) => void): void {
        this.onTranscriptCallback = callback;
    }

    onAudioPlayback(callback: (audioData: Buffer) => void): void {
        this.onAudioPlaybackCallback = callback;
    }

    onSessionState(callback: (state: VoiceSessionState) => void): vscode.Disposable {
        this.sessionStateListeners.add(callback);
        return {
            dispose: () => {
                this.sessionStateListeners.delete(callback);
            }
        };
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Emit session state change to listeners
     */
    private emitStateChange(): void {
        const snapshot = this.getSessionState();
        for (const listener of Array.from(this.sessionStateListeners)) {
            try {
                listener(snapshot);
            } catch (error: any) {
                this.logger.error('Session state listener failed', { error: error?.message || error });
            }
        }
    }
}

import { Logger } from '../core/logger';
import { AudioChunk, RealtimeAudioConfig, RealtimeAudioService } from './RealtimeAudioService';

/**
 * Text-to-Speech service using Azure OpenAI Realtime API
 * This service uses the gpt-realtime model for natural voice synthesis
 */
export class TTSService {
    private realtimeService: RealtimeAudioService;
    private logger: Logger;
    private audioCallback?: (audioData: Buffer) => void;
    private isInitialized = false;

    constructor(
        endpoint: string,
        deploymentName: string,
        apiVersion: string,
        logger?: Logger
    ) {
        this.logger = logger || new Logger('TTSService');

        const config: RealtimeAudioConfig = {
            endpoint,
            deploymentName,
            apiVersion
        };

        this.realtimeService = new RealtimeAudioService(config, this.logger);
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        // Handle audio output from the realtime service
        this.realtimeService.onAudioChunk((chunk: AudioChunk) => {
            this.logger.debug('TTS audio chunk received', { size: chunk.data.length });
            this.audioCallback?.(chunk.data);
        });

        this.realtimeService.onError((error: Error) => {
            this.logger.error('TTS service error', { error: error.message });
        });

        this.realtimeService.onSessionState((state) => {
            this.logger.debug('TTS session state changed', { state });
        });
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        await this.realtimeService.initialize();
        this.isInitialized = true;
        this.logger.info('TTS service initialized');
    }

    /**
     * Synthesize text to speech using Azure OpenAI Realtime
     */
    public async speak(text: string): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Start session if not already connected
            if (!this.realtimeService.getIsConnected()) {
                await this.realtimeService.startSession();
            }

            // Send text message to get audio response
            await this.realtimeService.sendTextMessage(text);
            this.logger.info('TTS speech synthesis requested', { text });
        } catch (error: any) {
            this.logger.error('Failed to synthesize speech', { error: error.message, text });
            throw error;
        }
    }

    /**
     * Stop current speech synthesis and close session
     */
    public stop(): void {
        this.realtimeService.stopSession();
        this.logger.info('TTS synthesis stopped');
    }

    /**
     * Check if TTS service is currently connected
     */
    public isConnected(): boolean {
        return this.realtimeService.getIsConnected();
    }

    /**
     * Set callback for receiving synthesized audio data
     */
    public onAudioData(callback: (audioData: Buffer) => void): void {
        this.audioCallback = callback;
    }

    /**
     * Update voice settings for synthesis
     */
    public async updateVoiceSettings(voice?: string, temperature?: number): Promise<void> {
        const config: any = {};
        if (voice) {
            config.voice = voice;
        }
        if (temperature !== undefined) {
            config.temperature = temperature;
        }

        await this.realtimeService.updateSessionConfig(config);
        this.logger.debug('TTS voice settings updated', config);
    }

    public dispose(): void {
        this.realtimeService.dispose();
        this.isInitialized = false;
        this.logger.info('TTS service disposed');
    }
}

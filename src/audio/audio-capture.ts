import { Logger } from '../core/logger';

export interface AudioCaptureConfig {
    sampleRate?: number;
    channels?: number;
    bufferSize?: number;
}

/**
 * Audio capture service for real-time microphone input
 * Provides PCM audio data compatible with Azure OpenAI Realtime API
 */
export class AudioCapture {
    private mediaRecorder: MediaRecorder | null = null;
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private processorNode: ScriptProcessorNode | null = null;
    private stream: MediaStream | null = null;
    private isRecording = false;
    private logger: Logger;
    private config: AudioCaptureConfig;

    // Callbacks
    private onAudioDataCallback?: (audioData: Buffer) => void;
    private onErrorCallback?: (error: Error) => void;

    constructor(config: AudioCaptureConfig = {}, logger?: Logger) {
        this.config = {
            sampleRate: 24000,
            channels: 1,
            bufferSize: 4096,
            ...config
        };
        this.logger = logger || new Logger('AudioCapture');
    }

    /**
     * Initialize audio capture with real-time processing
     */
    public async initialize(): Promise<void> {
        try {
            // Request microphone access
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.config.sampleRate,
                    channelCount: this.config.channels,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            // Create audio context for real-time processing
            this.audioContext = new AudioContext({
                sampleRate: this.config.sampleRate
            });

            // Create source node from microphone stream
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

            // Create processor node for real-time audio data
            this.processorNode = this.audioContext.createScriptProcessor(
                this.config.bufferSize,
                this.config.channels,
                this.config.channels
            );

            // Set up audio processing
            this.processorNode.onaudioprocess = (event) => {
                if (this.isRecording && this.onAudioDataCallback) {
                    const inputBuffer = event.inputBuffer;
                    const channelData = inputBuffer.getChannelData(0);

                    // Convert Float32Array to PCM16 Buffer
                    const pcmData = this.float32ToPCM16(channelData);
                    this.onAudioDataCallback(pcmData);
                }
            };

            this.logger.info('Audio capture initialized', {
                sampleRate: this.config.sampleRate,
                channels: this.config.channels,
                bufferSize: this.config.bufferSize
            });
        } catch (error: any) {
            this.logger.error('Failed to initialize audio capture', { error: error.message });
            this.onErrorCallback?.(error);
            throw error;
        }
    }

    /**
     * Start recording audio and streaming to callback
     */
    public startRecording(): void {
        if (!this.audioContext || !this.sourceNode || !this.processorNode) {
            throw new Error('Audio capture not initialized');
        }

        if (this.isRecording) {
            this.logger.warn('Already recording');
            return;
        }

        try {
            // Connect audio nodes
            this.sourceNode.connect(this.processorNode);
            this.processorNode.connect(this.audioContext.destination);

            this.isRecording = true;
            this.logger.info('Started recording audio');
        } catch (error: any) {
            this.logger.error('Failed to start recording', { error: error.message });
            this.onErrorCallback?.(error);
            throw error;
        }
    }

    /**
     * Stop recording audio
     */
    public stopRecording(): void {
        if (!this.isRecording) {
            this.logger.warn('Not currently recording');
            return;
        }

        try {
            // Disconnect audio nodes
            if (this.sourceNode && this.processorNode) {
                this.sourceNode.disconnect();
                this.processorNode.disconnect();
            }

            this.isRecording = false;
            this.logger.info('Stopped recording audio');
        } catch (error: any) {
            this.logger.error('Failed to stop recording', { error: error.message });
            this.onErrorCallback?.(error);
        }
    }

    /**
     * Check if currently recording
     */
    public getIsRecording(): boolean {
        return this.isRecording;
    }

    /**
     * Set callback for receiving real-time audio data
     */
    public onAudioData(callback: (audioData: Buffer) => void): void {
        this.onAudioDataCallback = callback;
    }

    /**
     * Set callback for handling errors
     */
    public onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Convert Float32Array audio data to PCM16 Buffer
     */
    private float32ToPCM16(float32Array: Float32Array): Buffer {
        const buffer = Buffer.allocUnsafe(float32Array.length * 2);
        let offset = 0;

        for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            buffer.writeInt16LE(pcm, offset);
            offset += 2;
        }

        return buffer;
    }

    /**
     * Get audio input levels for visualization
     */
    public getAudioLevel(): number {
        if (!this.audioContext || !this.isRecording) {
            return 0;
        }

        // This is a simplified level meter
        // In a real implementation, you might want to use AnalyserNode
        return 0.5; // Placeholder
    }

    /**
     * Dispose of audio resources
     */
    public dispose(): void {
        this.stopRecording();

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.sourceNode = null;
        this.processorNode = null;
        this.logger.info('Audio capture disposed');
    }
}

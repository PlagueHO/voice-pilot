import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";
import { OpenAIRealtimeWS } from "openai/beta/realtime/ws";
import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import { TurnDetectionConfig } from '../types/configuration';
import { RealtimeTurnEvent } from './turn-detection-coordinator';
import { createDefaultTurnDetectionConfig } from './turn-detection-defaults';

export interface RealtimeAudioConfig {
  endpoint: string;
  deploymentName: string;
  apiVersion: string;
  turnDetection?: TurnDetectionConfig;
}

export interface AudioTranscript {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
}

/**
 * Azure OpenAI Realtime audio service implementing WebSocket-based communication
 * following Microsoft's official quickstart patterns for gpt-realtime model.
 *
 * Features:
 * - Keyless authentication via DefaultAzureCredential + getBearerTokenProvider
 * - Bidirectional audio streaming (microphone input + synthesized output)
 * - Real-time transcription with delta events
 * - Session management and reconnection handling
 * - Full duplex communication for conversational AI
 */
export class RealtimeAudioService implements ServiceInitializable {
  private initialized = false;
  private realtimeClient: OpenAIRealtimeWS | null = null;
  private isConnected = false;
  private isRecording = false;
  private logger: Logger;
  private config: RealtimeAudioConfig;
  private turnDetectionConfig: TurnDetectionConfig;

  // Event callbacks
  private onTranscriptCallback?: (transcript: AudioTranscript) => void;
  private onAudioChunkCallback?: (chunk: AudioChunk) => void;
  private onErrorCallback?: (error: Error) => void;
  private onSessionStateCallback?: (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  private onTurnEventCallback?: (event: RealtimeTurnEvent) => void;

  constructor(config: RealtimeAudioConfig, logger?: Logger) {
    this.config = { ...config };
    this.logger = logger || new Logger('RealtimeAudioService');
    this.turnDetectionConfig = config.turnDetection ? { ...config.turnDetection } : createDefaultTurnDetectionConfig();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.initializeRealtimeClient();
      this.initialized = true;
      this.logger.info('RealtimeAudioService initialized successfully');
    } catch (error: any) {
      this.logger.error('Failed to initialize RealtimeAudioService', { error: error.message });
      throw new Error(`RealtimeAudioService initialization failed: ${error.message}`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.stopSession();
    this.initialized = false;
    this.logger.info('RealtimeAudioService disposed');
  }

  /**
   * Initialize the Azure OpenAI Realtime client with keyless authentication
   * Following the official Microsoft quickstart pattern
   */
  private async initializeRealtimeClient(): Promise<void> {
    try {
      // Keyless authentication using DefaultAzureCredential + getBearerTokenProvider
      // as per Microsoft's recommended approach
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);

      const azureOpenAIClient = new AzureOpenAI({
        azureADTokenProvider,
        apiVersion: this.config.apiVersion,
        deployment: this.config.deploymentName,
        endpoint: this.config.endpoint,
      });

      // Create WebSocket-based realtime client
      this.realtimeClient = await OpenAIRealtimeWS.azure(azureOpenAIClient);

      this.setupEventHandlers();
      this.logger.debug('Realtime client initialized with keyless authentication');
    } catch (error: any) {
      this.logger.error('Failed to initialize realtime client', { error: error.message });
      throw error;
    }
  }

  /**
   * Set up event handlers for the realtime client following Microsoft's patterns
   */
  private setupEventHandlers(): void {
    if (!this.realtimeClient) {
      throw new Error('Realtime client not initialized');
    }

    // WebSocket connection events
    this.realtimeClient.socket.on("open", () => {
      this.logger.info("Realtime connection opened");
      this.isConnected = true;
      this.onSessionStateCallback?.('connected');
      this.sendSessionUpdate('connection_open');
    });

    this.realtimeClient.socket.on("close", () => {
      this.logger.info("Realtime connection closed");
      this.isConnected = false;
      this.isRecording = false;
      this.onSessionStateCallback?.('disconnected');
    });

    this.realtimeClient.socket.on("error", (error) => {
      this.logger.error("WebSocket error", { error });
      this.onSessionStateCallback?.('error');
      this.onErrorCallback?.(new Error(`WebSocket error: ${error}`));
    });

    // Realtime API events
    this.realtimeClient.on("error", (err) => {
      this.logger.error("Realtime API error", { error: err.message });
      this.onErrorCallback?.(err);
    });

    this.realtimeClient.on("session.created", (event) => {
      this.logger.debug("Session created", { session: event.session });
    });

    // Handle text output deltas (real-time transcription)
    this.realtimeClient.on("response.text.delta", (event: any) => {
      const transcript: AudioTranscript = {
        text: event.delta,
        timestamp: Date.now(),
        isFinal: false
      };
      this.onTranscriptCallback?.(transcript);
    });

    // Handle final text output
    this.realtimeClient.on("response.text.done", () => {
      this.logger.debug("Text output completed");
      // Could emit a final transcript marker here if needed
    });

    // Handle audio output deltas (synthesized speech)
    this.realtimeClient.on("response.audio.delta", (event: any) => {
      try {
        const buffer = Buffer.from(event.delta, "base64");
        const audioChunk: AudioChunk = {
          data: buffer,
          timestamp: Date.now()
        };
        this.onAudioChunkCallback?.(audioChunk);
        this.logger.debug(`Received ${buffer.length} bytes of audio data`);
      } catch (error: any) {
        this.logger.error('Failed to process audio delta', { error: error.message });
      }
    });

    // Handle audio transcript deltas (what the AI is saying)
    this.realtimeClient.on("response.audio_transcript.delta", (event: any) => {
      const transcript: AudioTranscript = {
        text: event.delta,
        timestamp: Date.now(),
        isFinal: false
      };
      this.onTranscriptCallback?.(transcript);
      this.logger.debug(`AI transcript delta: ${event.delta}`);
    });

    // Handle response completion
    this.realtimeClient.on("response.done", () => {
      this.logger.debug("Response completed");
    });

    this.realtimeClient.on("input_audio_buffer.speech_started", (event: any) => {
      this.dispatchTurnEvent({
        type: 'speech-start',
        timestamp: Date.now(),
        serverEvent: event
      });
    });

    this.realtimeClient.on("input_audio_buffer.speech_stopped", (event: any) => {
      this.dispatchTurnEvent({
        type: 'speech-stop',
        timestamp: Date.now(),
        serverEvent: event
      });
    });
  }

  setTurnDetectionConfig(config: TurnDetectionConfig): void {
    this.turnDetectionConfig = { ...config };
    if (this.isConnected && this.realtimeClient) {
      try {
        this.sendSessionUpdate('turn_detection_config_changed');
      } catch (error: any) {
        this.logger.error('Failed to push turn detection update', { error: error?.message ?? String(error) });
      }
    }
  }

  getTurnDetectionConfig(): TurnDetectionConfig {
    return { ...this.turnDetectionConfig };
  }

  private sendSessionUpdate(reason: string, overrides: Record<string, unknown> = {}): void {
    if (!this.realtimeClient) {
      throw new Error('Realtime client not initialized');
    }
    const sessionPayload = this.composeSessionPayload(overrides);
    this.realtimeClient.send({
      type: "session.update",
      session: sessionPayload
    });
    this.logger.debug('Session update sent', { reason, mode: this.turnDetectionConfig.mode });
  }

  private composeSessionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      modalities: ["text", "audio"],
      model: this.config.deploymentName || "gpt-4o-realtime-preview"
    };
    const turnDetection = this.buildTurnDetectionPayload();
    if (turnDetection) {
      payload.turn_detection = turnDetection;
    }
    return { ...payload, ...overrides };
  }

  private buildTurnDetectionPayload(): Record<string, unknown> | undefined {
    const cfg = this.turnDetectionConfig;
    switch (cfg.mode) {
      case 'manual':
        return {
          type: 'none',
          create_response: false,
          interrupt_response: false
        };
      case 'semantic_vad':
        return {
          type: 'semantic_vad',
          prefix_padding_ms: cfg.prefixPaddingMs,
          silence_duration_ms: cfg.silenceDurationMs,
          create_response: cfg.createResponse,
          interrupt_response: cfg.interruptResponse,
          eagerness: cfg.eagerness
        };
      case 'server_vad':
      default:
        return {
          type: 'server_vad',
          threshold: cfg.threshold,
          prefix_padding_ms: cfg.prefixPaddingMs,
          silence_duration_ms: cfg.silenceDurationMs,
          create_response: cfg.createResponse,
          interrupt_response: cfg.interruptResponse
        };
    }
  }

  private dispatchTurnEvent(event: RealtimeTurnEvent): void {
    if (!this.onTurnEventCallback) {
      return;
    }
    try {
      this.onTurnEventCallback({ ...event });
    } catch (error: any) {
      this.logger.error('Turn detection event handler failed', { error: error?.message || error, type: event.type });
    }
  }

  /**
   * Start a voice session - connects and begins audio processing
   */
  async startSession(): Promise<void> {
    if (!this.initialized) {
      throw new Error('RealtimeAudioService not initialized');
    }

    if (this.isConnected) {
      this.logger.warn('Session already active');
      return;
    }

    try {
      this.onSessionStateCallback?.('connecting');

      // The connection is established when the WebSocket opens
      // Event handlers will manage the session lifecycle

      this.logger.info('Voice session started');
    } catch (error: any) {
      this.logger.error('Failed to start session', { error: error.message });
      this.onSessionStateCallback?.('error');
      throw error;
    }
  }

  /**
   * Stop the current voice session
   */
  stopSession(): void {
    if (this.realtimeClient && this.isConnected) {
      this.realtimeClient.close();
      this.logger.info('Voice session stopped');
    }
    this.isRecording = false;
  }

  /**
   * Send text message to the AI (will get audio response)
   */
  async sendTextMessage(text: string): Promise<void> {
    if (!this.isConnected || !this.realtimeClient) {
      throw new Error('No active session');
    }

    try {
      // Create conversation item with user text
      this.realtimeClient.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });

      // Request response generation
      this.realtimeClient.send({ type: "response.create" });

      this.logger.debug('Text message sent', { text });
    } catch (error: any) {
      this.logger.error('Failed to send text message', { error: error.message });
      throw error;
    }
  }

  /**
   * Send audio data to the AI for processing
   */
  async sendAudioData(audioData: Buffer): Promise<void> {
    if (!this.isConnected || !this.realtimeClient) {
      throw new Error('No active session');
    }

    try {
      const base64Audio = audioData.toString('base64');

      // Send audio as conversation item
      this.realtimeClient.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_audio", audio: base64Audio }],
        },
      });

      // Request response generation
      this.realtimeClient.send({ type: "response.create" });

      this.logger.debug('Audio data sent', { size: audioData.length });
    } catch (error: any) {
      this.logger.error('Failed to send audio data', { error: error.message });
      throw error;
    }
  }

  /**
   * Start recording audio input
   */
  startRecording(): void {
    if (!this.isConnected) {
      throw new Error('No active session');
    }

    this.isRecording = true;
    this.logger.debug('Started recording audio input');
  }

  /**
   * Stop recording audio input
   */
  stopRecording(): void {
    this.isRecording = false;
    this.logger.debug('Stopped recording audio input');
  }

  /**
   * Check if currently recording audio
   */
  getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Check if session is active
   */
  getIsConnected(): boolean {
    return this.isConnected;
  }

  // Event callback setters
  onTranscript(callback: (transcript: AudioTranscript) => void): void {
    this.onTranscriptCallback = callback;
  }

  onAudioChunk(callback: (chunk: AudioChunk) => void): void {
    this.onAudioChunkCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  onSessionState(callback: (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void): void {
    this.onSessionStateCallback = callback;
  }

  onTurnEvent(callback: (event: RealtimeTurnEvent) => void): void {
    this.onTurnEventCallback = callback;
  }

  /**
   * Update session configuration
   */
  async updateSessionConfig(config: Partial<{ instructions: string; voice: string; temperature: number }>): Promise<void> {
    if (!this.isConnected || !this.realtimeClient) {
      throw new Error('No active session');
    }

    try {
      this.sendSessionUpdate('manual_update', config);
      this.logger.debug('Session config updated', config);
    } catch (error: any) {
      this.logger.error('Failed to update session config', { error: error.message });
      throw error;
    }
  }
}

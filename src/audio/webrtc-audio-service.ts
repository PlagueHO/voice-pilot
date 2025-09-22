import { EphemeralKeyServiceImpl } from '../auth/ephemeral-key-service';
import { ConfigurationManager } from '../config/configuration-manager';
import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import { SessionManager } from '../session/session-manager';
import type { RealtimeEvent } from '../types/realtime-events';
import {
    ConnectionQuality,
    WebRTCConnectionState,
    WebRTCErrorImpl
} from '../types/webrtc';
import { AudioTrackManager } from './audio-track-manager';
import { WebRTCConfigFactory } from './webrtc-config-factory';
import { WebRTCErrorHandler } from './webrtc-error-handler';
import { WebRTCTransportImpl } from './webrtc-transport';

/**
 * High-level audio service that orchestrates WebRTC transport with existing extension services
 * Provides a clean interface for voice session management while integrating with:
 * - EphemeralKeyService for authentication
 * - SessionManager for lifecycle coordination
 * - ConfigurationManager for settings
 * - Logging for diagnostics
 */
export class WebRTCAudioService implements ServiceInitializable {
  private initialized = false;
  private logger: Logger;

  // Core components
  private transport: WebRTCTransportImpl;
  private configFactory: WebRTCConfigFactory;
  private audioManager: AudioTrackManager;
  private errorHandler: WebRTCErrorHandler;

  // Service dependencies
  private ephemeralKeyService?: EphemeralKeyServiceImpl;
  private configurationManager?: ConfigurationManager;
  private sessionManager?: SessionManager;

  // Audio session state
  private isSessionActive = false;
  private currentMicrophoneTrack?: MediaStreamTrack;

  // Event callbacks
  private onSessionStateChangedCallback?: (state: string) => Promise<void>;
  private onTranscriptReceivedCallback?: (transcript: string) => Promise<void>;
  private onAudioReceivedCallback?: (audioData: Buffer) => Promise<void>;
  private onErrorCallback?: (error: Error) => Promise<void>;

  constructor(
    ephemeralKeyService?: EphemeralKeyServiceImpl,
    configurationManager?: ConfigurationManager,
    sessionManager?: SessionManager,
    logger?: Logger
  ) {
    this.logger = logger || new Logger('WebRTCAudioService');
    this.ephemeralKeyService = ephemeralKeyService;
    this.configurationManager = configurationManager;
    this.sessionManager = sessionManager;

    // Initialize components
    this.transport = new WebRTCTransportImpl(this.logger);
    this.configFactory = new WebRTCConfigFactory(this.logger);
    this.audioManager = new AudioTrackManager(this.logger);
    this.errorHandler = new WebRTCErrorHandler(this.logger);

    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing WebRTC Audio Service');

    try {
      // Validate dependencies
      this.validateDependencies();

      // Initialize components
      await this.transport.initialize();
      await this.audioManager.initialize();

      // Set up error handling
      this.configureErrorHandling();

      this.initialized = true;
      this.logger.info('WebRTC Audio Service initialized successfully');

    } catch (error: any) {
      this.logger.error('Failed to initialize WebRTC Audio Service', { error: error.message });
      throw new Error(`WebRTC Audio Service initialization failed: ${error.message}`);
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info('Disposing WebRTC Audio Service');

    // Stop any active session
    if (this.isSessionActive) {
      this.stopSession();
    }

    // Dispose components
    this.transport.dispose();
    this.audioManager.dispose();

    this.initialized = false;
    this.logger.info('WebRTC Audio Service disposed');
  }

  /**
   * Start a WebRTC voice session
   */
  async startSession(): Promise<void> {
    this.ensureInitialized();

    if (this.isSessionActive) {
      this.logger.warn('Session already active');
      return;
    }

    try {
      this.logger.info('Starting WebRTC voice session');

      // Validate services are available
      if (!this.ephemeralKeyService || !this.configurationManager) {
        throw new Error('Required services not available for session start');
      }

      // Create WebRTC configuration
      const config = await this.configFactory.createConfig(
        this.configurationManager,
        this.ephemeralKeyService
      );

      // Establish WebRTC connection
      const connectionResult = await this.transport.establishConnection(config);
      if (!connectionResult.success) {
        throw new Error(`Failed to establish WebRTC connection: ${connectionResult.error?.message}`);
      }

      // Capture microphone
      this.currentMicrophoneTrack = await this.audioManager.captureMicrophone();

      // Add audio track to transport
      await this.audioManager.addTrackToTransport(this.transport, this.currentMicrophoneTrack);

      // Handle remote audio stream
      const remoteStream = this.transport.getRemoteAudioStream();
      if (remoteStream) {
        this.audioManager.handleRemoteStream(remoteStream);
      }

      this.isSessionActive = true;
      this.onSessionStateChangedCallback?.('active');

      this.logger.info('WebRTC voice session started successfully');

    } catch (error: any) {
      this.logger.error('Failed to start WebRTC session', { error: error.message });
      this.onErrorCallback?.(error);
      throw error;
    }
  }

  /**
   * Stop the current voice session
   */
  async stopSession(): Promise<void> {
    if (!this.isSessionActive) {
      this.logger.warn('No active session to stop');
      return;
    }

    try {
      this.logger.info('Stopping WebRTC voice session');

      // Stop audio capture
      if (this.currentMicrophoneTrack) {
        this.audioManager.stopTrack(this.currentMicrophoneTrack.id);
        this.currentMicrophoneTrack = undefined;
      }

      // Close WebRTC connection
      await this.transport.closeConnection();

      this.isSessionActive = false;
      this.onSessionStateChangedCallback?.('inactive');

      this.logger.info('WebRTC voice session stopped');

    } catch (error: any) {
      this.logger.error('Error stopping session', { error: error.message });
      this.onErrorCallback?.(error);
    }
  }

  /**
   * Send text message through data channel
   */
  async sendTextMessage(text: string): Promise<void> {
    this.ensureActiveSession();

    try {
      const conversationItem: RealtimeEvent = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }]
        }
      };

      await this.transport.sendDataChannelMessage(conversationItem);

      // Request response
      await this.transport.sendDataChannelMessage({ type: 'response.create' });

      this.logger.debug('Text message sent', { text });

    } catch (error: any) {
      this.logger.error('Failed to send text message', { error: error.message });
      throw error;
    }
  }

  /**
   * Get session status information
   */
  getSessionStatus(): {
    isActive: boolean;
    connectionState: WebRTCConnectionState;
    connectionQuality: ConnectionQuality;
    hasAudio: boolean;
    statistics: any;
  } {
    return {
      isActive: this.isSessionActive,
      connectionState: this.transport.getConnectionState(),
      connectionQuality: this.transport.getConnectionStatistics().connectionQuality,
      hasAudio: !!this.currentMicrophoneTrack,
      statistics: this.transport.getConnectionStatistics()
    };
  }

  /**
   * Mute/unmute microphone
   */
  setMicrophoneMuted(muted: boolean): void {
    if (this.currentMicrophoneTrack) {
      this.audioManager.setTrackMuted(this.currentMicrophoneTrack.id, muted);
      this.logger.debug('Microphone mute state changed', { muted });
    }
  }

  /**
   * Switch audio input device
   */
  async switchAudioDevice(deviceId: string): Promise<void> {
    this.ensureActiveSession();

    try {
      // Remove current track
      if (this.currentMicrophoneTrack) {
        await this.audioManager.removeTrackFromTransport(this.transport, this.currentMicrophoneTrack);
      }

      // Capture new device
      this.currentMicrophoneTrack = await this.audioManager.switchAudioDevice(deviceId);

      // Add new track
      await this.audioManager.addTrackToTransport(this.transport, this.currentMicrophoneTrack);

      this.logger.info('Audio device switched', { deviceId });

    } catch (error: any) {
      this.logger.error('Failed to switch audio device', { error: error.message });
      throw error;
    }
  }

  /**
   * Get available audio devices
   */
  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    return this.audioManager.getAudioInputDevices();
  }

  // Event handler setters
  onSessionStateChanged(callback: (state: string) => Promise<void>): void {
    this.onSessionStateChangedCallback = callback;
  }

  onTranscriptReceived(callback: (transcript: string) => Promise<void>): void {
    this.onTranscriptReceivedCallback = callback;
  }

  onAudioReceived(callback: (audioData: Buffer) => Promise<void>): void {
    this.onAudioReceivedCallback = callback;
  }

  onError(callback: (error: Error) => Promise<void>): void {
    this.onErrorCallback = callback;
  }

  // Private implementation methods
  private setupEventHandlers(): void {
    // Transport connection state changes
    this.transport.addEventListener('connectionStateChanged', async (event) => {
      this.logger.debug('Transport connection state changed', {
        state: event.data.currentState
      });

      // Handle connection failures
      if (event.data.currentState === WebRTCConnectionState.Failed) {
        await this.handleConnectionFailure();
      }
    });

    // Data channel messages
    this.transport.addEventListener('dataChannelMessage', async (event) => {
      await this.handleDataChannelMessage(event.data.message);
    });

    // Connection quality changes
    this.transport.addEventListener('connectionQualityChanged', async (event) => {
      this.audioManager.adjustAudioQuality(event.data.currentQuality);
    });

    // Transport errors
    this.transport.addEventListener('error', async (event) => {
      await this.handleTransportError(event.data);
    });
  }

  private configureErrorHandling(): void {
    // Configure error callbacks
    this.errorHandler.onAuthenticationError(async (error) => {
      this.logger.warn('Authentication error, requesting key renewal', { error: error.code });

      if (this.ephemeralKeyService) {
        try {
          await this.ephemeralKeyService.renewKey();
          // Attempt to restart session with new key
          await this.restartSessionWithNewKey();
        } catch (renewError: any) {
          this.logger.error('Failed to renew key', { error: renewError.message });
          this.onErrorCallback?.(renewError);
        }
      }
    });

    this.errorHandler.onConnectionError(async (error) => {
      this.logger.warn('Connection error detected', { error: error.code });
      await this.handleConnectionFailure();
    });

    this.errorHandler.onFatalError(async (error) => {
      this.logger.error('Fatal error, stopping session', { error: error.code });
      await this.stopSession();
      this.onErrorCallback?.(error);
    });
  }

  private async handleDataChannelMessage(message: RealtimeEvent): Promise<void> {
    this.logger.debug('Received data channel message', { type: message.type });

    try {
      switch (message.type) {
        case 'response.text.delta':
          if (this.onTranscriptReceivedCallback && 'delta' in message) {
            await this.onTranscriptReceivedCallback(message.delta as string);
          }
          break;

        case 'response.audio.delta':
          if (this.onAudioReceivedCallback && 'delta' in message) {
            const audioBuffer = Buffer.from(message.delta as string, 'base64');
            await this.onAudioReceivedCallback(audioBuffer);
          }
          break;

        case 'response.audio_transcript.delta':
          if (this.onTranscriptReceivedCallback && 'delta' in message) {
            await this.onTranscriptReceivedCallback(message.delta as string);
          }
          break;

        case 'error':
          this.logger.error('Received error from data channel', { message });
          if ('error' in message) {
            this.onErrorCallback?.(new Error(message.error as string));
          }
          break;

        default:
          this.logger.debug('Unhandled message type', { type: message.type });
          break;
      }
    } catch (error: any) {
      this.logger.error('Error handling data channel message', { error: error.message });
    }
  }

  private async handleTransportError(error: WebRTCErrorImpl): Promise<void> {
    this.logger.warn('Transport error occurred', { error: error.code });

    if (!this.configurationManager) {
      this.logger.error('Cannot handle transport error - no configuration manager');
      return;
    }

    try {
      const config = await this.configFactory.createConfig(
        this.configurationManager,
        this.ephemeralKeyService!
      );

      await this.errorHandler.handleError(error, this.transport, config);
    } catch (handlingError: any) {
      this.logger.error('Failed to handle transport error', { error: handlingError.message });
      this.onErrorCallback?.(handlingError);
    }
  }

  private async handleConnectionFailure(): Promise<void> {
    this.logger.warn('Handling connection failure');

    if (this.isSessionActive) {
      try {
        // Attempt to restart the session
        await this.restartSession();
      } catch (error: any) {
        this.logger.error('Failed to restart session after connection failure', { error: error.message });
        await this.stopSession();
        this.onErrorCallback?.(error);
      }
    }
  }

  private async restartSession(): Promise<void> {
    this.logger.info('Restarting WebRTC session');

    const wasActive = this.isSessionActive;
    await this.stopSession();

    if (wasActive) {
      await this.startSession();
    }
  }

  private async restartSessionWithNewKey(): Promise<void> {
    this.logger.info('Restarting session with new ephemeral key');

    if (!this.configurationManager || !this.ephemeralKeyService) {
      throw new Error('Required services not available for session restart');
    }

    // Create new configuration with renewed key
    const config = await this.configFactory.updateConfigWithNewKey(
      await this.configFactory.createConfig(this.configurationManager, this.ephemeralKeyService),
      this.ephemeralKeyService
    );

    // Re-establish connection
    const result = await this.transport.establishConnection(config);
    if (!result.success) {
      throw new Error(`Failed to restart session: ${result.error?.message}`);
    }

    this.logger.info('Session restarted with new key');
  }

  private validateDependencies(): void {
    if (!this.ephemeralKeyService?.isInitialized()) {
      throw new Error('EphemeralKeyService must be initialized');
    }

    if (!this.configurationManager?.isInitialized()) {
      throw new Error('ConfigurationManager must be initialized');
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WebRTC Audio Service not initialized. Call initialize() first.');
    }
  }

  private ensureActiveSession(): void {
    this.ensureInitialized();

    if (!this.isSessionActive) {
      throw new Error('No active voice session. Call startSession() first.');
    }
  }
}

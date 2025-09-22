import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import type { RealtimeEvent, SessionUpdateEvent } from '../types/realtime-events';
import {
    ConnectionQuality,
    ConnectionResult,
    ConnectionStatistics,
    WebRTCConfig,
    WebRTCConnectionState,
    WebRTCErrorCode,
    WebRTCErrorImpl,
    WebRTCEvent,
    WebRTCEventHandler,
    WebRTCEventType,
    WebRTCTransport
} from '../types/webrtc';

/**
 * WebRTC transport implementation for Azure OpenAI Realtime API
 * Provides low-latency, full-duplex audio communication with Azure endpoints
 *
 * Based on Azure OpenAI Realtime Audio Quickstart patterns with WebRTC transport
 */
export class WebRTCTransportImpl implements WebRTCTransport, ServiceInitializable {
  private initialized = false;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private connectionState: WebRTCConnectionState = WebRTCConnectionState.Disconnected;
  private connectionId: string = '';
  private logger: Logger;

  // Event handling
  private eventHandlers = new Map<WebRTCEventType, Set<WebRTCEventHandler>>();

  // Audio tracks
  private localTracks = new Set<MediaStreamTrack>();
  private remoteStream: MediaStream | null = null;

  // Connection statistics
  private connectionStartTime: number = 0;
  private statsInterval: NodeJS.Timeout | null = null;

  // Current configuration
  private config: WebRTCConfig | null = null;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('WebRTCTransport');
    this.connectionId = this.generateConnectionId();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing WebRTC transport');
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info('Disposing WebRTC transport');
    this.closeConnection();
    this.eventHandlers.clear();
    this.initialized = false;
  }

  // Connection lifecycle
  async establishConnection(config: WebRTCConfig): Promise<ConnectionResult> {
    this.ensureInitialized();

    if (this.connectionState === WebRTCConnectionState.Connected) {
      this.logger.warn('Connection already established');
      return this.createConnectionResult(true);
    }

    try {
      this.config = config;
      this.setConnectionState(WebRTCConnectionState.Connecting);
      this.connectionStartTime = Date.now();

      // Create peer connection with ICE servers
      this.peerConnection = new RTCPeerConnection({
        iceServers: config.connectionConfig?.iceServers || [
          { urls: 'stun:stun.l.google.com:19302' }
        ]
      });

      // Set up event handlers
      this.setupPeerConnectionHandlers();

      // Create data channel for realtime events
      this.dataChannel = this.peerConnection.createDataChannel(
        config.dataChannelConfig?.channelName || 'realtime-channel',
        {
          ordered: config.dataChannelConfig?.ordered ?? true,
          maxRetransmits: config.dataChannelConfig?.maxRetransmits
        }
      );

      this.setupDataChannelHandlers();

      // Create SDP offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      });

      await this.peerConnection.setLocalDescription(offer);

      // Send SDP offer to Azure endpoint with authentication
      const response = await this.negotiateWithAzure(config, offer);

      // Set remote description from Azure response
      const answer = new RTCSessionDescription({
        type: 'answer',
        sdp: response.sdp
      });

      await this.peerConnection.setRemoteDescription(answer);

      // Wait for connection to be established
      await this.waitForConnection(config.connectionConfig?.connectionTimeoutMs || 5000);

      this.setConnectionState(WebRTCConnectionState.Connected);

      // Start statistics monitoring
      this.startStatisticsMonitoring();

      this.logger.info('WebRTC connection established successfully', {
        connectionId: this.connectionId,
        endpoint: config.endpoint.url
      });

      return this.createConnectionResult(true);

    } catch (error: any) {
      this.logger.error('Failed to establish WebRTC connection', { error: error.message });
      this.setConnectionState(WebRTCConnectionState.Failed);

      const webrtcError = new WebRTCErrorImpl({
        code: this.classifyError(error),
        message: error.message,
        details: error,
        recoverable: this.isRecoverableError(error),
        timestamp: new Date()
      });

      return this.createConnectionResult(false, webrtcError);
    }
  }

  async closeConnection(): Promise<void> {
    this.logger.info('Closing WebRTC connection');

    // Stop statistics monitoring
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    // Stop all local tracks
    for (const track of this.localTracks) {
      track.stop();
    }
    this.localTracks.clear();

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.setConnectionState(WebRTCConnectionState.Closed);
  }

  // Connection state
  getConnectionState(): WebRTCConnectionState {
    return this.connectionState;
  }

  getConnectionStatistics(): ConnectionStatistics {
    const stats: ConnectionStatistics = {
      connectionId: this.connectionId,
      connectionDurationMs: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
      audioPacketsSent: 0,
      audioPacketsReceived: 0,
      audioBytesSent: 0,
      audioBytesReceived: 0,
      packetsLost: 0,
      jitter: 0,
      dataChannelState: this.dataChannel?.readyState || 'closed' as RTCDataChannelState,
      iceConnectionState: this.peerConnection?.iceConnectionState || 'closed' as RTCIceConnectionState,
      connectionQuality: this.calculateConnectionQuality()
    };

    return stats;
  }

  // Audio stream management
  async addAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('No active peer connection');
    }

    try {
      this.peerConnection.addTrack(track);
      this.localTracks.add(track);

      this.logger.debug('Audio track added', { trackId: track.id });

      this.emitEvent({
        type: 'audioTrackAdded',
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: {
          track,
          stream: new MediaStream([track]),
          isRemote: false
        }
      });

    } catch (error: any) {
      this.logger.error('Failed to add audio track', { error: error.message });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to add audio track: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date()
      });
    }
  }

  async removeAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('No active peer connection');
    }

    try {
      const sender = this.peerConnection.getSenders().find(s => s.track === track);
      if (sender) {
        this.peerConnection.removeTrack(sender);
      }

      this.localTracks.delete(track);
      track.stop();

      this.logger.debug('Audio track removed', { trackId: track.id });

      this.emitEvent({
        type: 'audioTrackRemoved',
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: {
          track,
          stream: new MediaStream([track]),
          isRemote: false
        }
      });

    } catch (error: any) {
      this.logger.error('Failed to remove audio track', { error: error.message });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to remove audio track: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date()
      });
    }
  }

  getRemoteAudioStream(): MediaStream | null {
    return this.remoteStream;
  }

  // Data channel operations
  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.DataChannelFailed,
        message: 'Data channel not available for sending messages',
        details: { readyState: this.dataChannel?.readyState },
        recoverable: true,
        timestamp: new Date()
      });
    }

    try {
      const messageJson = JSON.stringify(message);
      this.dataChannel.send(messageJson);

      this.logger.debug('Data channel message sent', { type: message.type });

    } catch (error: any) {
      this.logger.error('Failed to send data channel message', { error: error.message });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.DataChannelFailed,
        message: `Failed to send message: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date()
      });
    }
  }

  // Event handling
  addEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);
  }

  removeEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void {
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  // Private implementation methods
  private async negotiateWithAzure(config: WebRTCConfig, offer: RTCSessionDescriptionInit): Promise<{ sdp: string }> {
    const endpoint = `${config.endpoint.url}?model=${config.endpoint.deployment}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.authentication.ephemeralKey}`,
        'Content-Type': 'application/sdp'
      },
      body: offer.sdp
    });

    if (!response.ok) {
      throw new Error(`SDP negotiation failed: ${response.status} ${response.statusText}`);
    }

    const sdp = await response.text();
    return { sdp };
  }

  private setupPeerConnectionHandlers(): void {
    if (!this.peerConnection) {
      return;
    }

    this.peerConnection.oniceconnectionstatechange = () => {
      this.handleIceConnectionStateChange();
    };

    this.peerConnection.ontrack = (event) => {
      this.handleRemoteTrack(event);
    };

    this.peerConnection.ondatachannel = (event) => {
      this.handleDataChannelReceived(event.channel);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.logger.debug('ICE candidate received', { candidate: event.candidate.candidate });
      }
    };
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) {
      return;
    }

    this.dataChannel.onopen = () => {
      this.logger.debug('Data channel opened');
      this.sendInitialSessionUpdate();
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event);
    };

    this.dataChannel.onclose = () => {
      this.logger.debug('Data channel closed');
    };

    this.dataChannel.onerror = (error) => {
      this.logger.error('Data channel error', { error });
      this.emitEvent({
        type: 'error',
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: new WebRTCErrorImpl({
          code: WebRTCErrorCode.DataChannelFailed,
          message: 'Data channel error occurred',
          details: error,
          recoverable: true,
          timestamp: new Date()
        })
      });
    };
  }

  private handleIceConnectionStateChange(): void {
    if (!this.peerConnection) {
      return;
    }

    const iceState = this.peerConnection.iceConnectionState;
    this.logger.debug('ICE connection state changed', { state: iceState });

    switch (iceState) {
      case 'connected':
      case 'completed':
        if (this.connectionState === WebRTCConnectionState.Connecting) {
          this.setConnectionState(WebRTCConnectionState.Connected);
        }
        break;
      case 'disconnected':
        this.setConnectionState(WebRTCConnectionState.Reconnecting);
        break;
      case 'failed':
        this.setConnectionState(WebRTCConnectionState.Failed);
        break;
      case 'closed':
        this.setConnectionState(WebRTCConnectionState.Closed);
        break;
    }
  }

  private handleRemoteTrack(event: RTCTrackEvent): void {
    const [stream] = event.streams;
    this.remoteStream = stream;

    this.logger.debug('Remote track received', { trackId: event.track.id });

    this.emitEvent({
      type: 'audioTrackAdded',
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        track: event.track,
        stream,
        isRemote: true
      }
    });
  }

  private handleDataChannelReceived(channel: RTCDataChannel): void {
    this.logger.debug('Data channel received from remote', { label: channel.label });
    // Additional data channel setup if needed
  }

  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as RealtimeEvent;

      this.logger.debug('Data channel message received', { type: message.type });

      this.emitEvent({
        type: 'dataChannelMessage',
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: {
          message,
          channel: this.dataChannel!
        }
      });

    } catch (error: any) {
      this.logger.error('Failed to parse data channel message', { error: error.message });
    }
  }

  private async sendInitialSessionUpdate(): Promise<void> {
    if (!this.config) {
      return;
    }

    const sessionUpdate: SessionUpdateEvent = {
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 200
        }
      }
    };

    try {
      await this.sendDataChannelMessage(sessionUpdate);
      this.logger.debug('Initial session update sent');
    } catch (error: any) {
      this.logger.error('Failed to send initial session update', { error: error.message });
    }
  }

  private async waitForConnection(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, timeoutMs);

      const checkConnection = () => {
        if (this.peerConnection?.iceConnectionState === 'connected' ||
            this.peerConnection?.iceConnectionState === 'completed') {
          clearTimeout(timeout);
          resolve();
        } else if (this.peerConnection?.iceConnectionState === 'failed') {
          clearTimeout(timeout);
          reject(new Error('ICE connection failed'));
        } else {
          setTimeout(checkConnection, 100);
        }
      };

      checkConnection();
    });
  }

  private setConnectionState(newState: WebRTCConnectionState): void {
    const previousState = this.connectionState;
    this.connectionState = newState;

    this.logger.debug('Connection state changed', {
      from: previousState,
      to: newState
    });

    this.emitEvent({
      type: 'connectionStateChanged',
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        previousState,
        currentState: newState
      }
    });
  }

  private emitEvent(event: WebRTCEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error: any) {
          this.logger.error('Event handler failed', {
            eventType: event.type,
            error: error.message
          });
        }
      }
    }
  }

  private createConnectionResult(success: boolean, error?: WebRTCErrorImpl): ConnectionResult {
    return {
      success,
      connectionId: this.connectionId,
      connectionState: this.connectionState,
      audioTracks: Array.from(this.localTracks),
      remoteStream: this.remoteStream || undefined,
      dataChannel: this.dataChannel || undefined,
      error
    };
  }

  private generateConnectionId(): string {
    return `webrtc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private classifyError(error: any): WebRTCErrorCode {
    if (error.name === 'NotAllowedError') {
      return WebRTCErrorCode.AuthenticationFailed;
    }

    if (error.message?.includes('SDP')) {
      return WebRTCErrorCode.SdpNegotiationFailed;
    }

    if (error.message?.includes('ICE') || error.message?.includes('connection')) {
      return WebRTCErrorCode.IceConnectionFailed;
    }

    if (error.message?.includes('timeout')) {
      return WebRTCErrorCode.NetworkTimeout;
    }

    return WebRTCErrorCode.ConfigurationInvalid;
  }

  private isRecoverableError(error: any): boolean {
    const code = this.classifyError(error);

    switch (code) {
      case WebRTCErrorCode.NetworkTimeout:
      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.DataChannelFailed:
        return true;

      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
        return false;

      default:
        return false;
    }
  }

  private startStatisticsMonitoring(): void {
    this.statsInterval = setInterval(async () => {
      if (this.peerConnection) {
        try {
          const stats = await this.peerConnection.getStats();
          this.processStatistics(stats);
        } catch (error: any) {
          this.logger.warn('Failed to get connection statistics', { error: error.message });
        }
      }
    }, 5000); // Update every 5 seconds
  }

  private processStatistics(stats: RTCStatsReport): void {
    // Process WebRTC statistics and emit quality events if needed
    const quality = this.calculateConnectionQuality();

    this.emitEvent({
      type: 'connectionQualityChanged',
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        previousQuality: quality, // This would be tracked separately in real implementation
        currentQuality: quality,
        statistics: this.getConnectionStatistics()
      }
    });
  }

  private calculateConnectionQuality(): ConnectionQuality {
    if (!this.peerConnection) {
      return ConnectionQuality.Failed;
    }

    const iceState = this.peerConnection.iceConnectionState;

    switch (iceState) {
      case 'connected':
      case 'completed':
        return ConnectionQuality.Excellent;
      case 'checking':
        return ConnectionQuality.Good;
      case 'disconnected':
        return ConnectionQuality.Poor;
      case 'failed':
      case 'closed':
        return ConnectionQuality.Failed;
      default:
        return ConnectionQuality.Fair;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('WebRTCTransport not initialized. Call initialize() first.');
    }
  }
}

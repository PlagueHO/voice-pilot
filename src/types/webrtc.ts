import { EphemeralKeyInfo } from './ephemeral';
import type { RealtimeEvent } from './realtime-events';

/**
 * WebRTC transport interface for Azure OpenAI Realtime API
 * Provides low-latency, full-duplex audio communication with WebRTC peer connections
 */
export interface WebRTCTransport {
  // Connection lifecycle
  establishConnection(config: WebRTCConfig): Promise<ConnectionResult>;
  closeConnection(): Promise<void>;

  // Connection state
  getConnectionState(): WebRTCConnectionState;
  getConnectionStatistics(): ConnectionStatistics;

  // Audio stream management
  addAudioTrack(track: MediaStreamTrack): Promise<void>;
  removeAudioTrack(track: MediaStreamTrack): Promise<void>;
  getRemoteAudioStream(): MediaStream | null;

  // Data channel operations
  sendDataChannelMessage(message: RealtimeEvent): Promise<void>;

  // Event handling
  addEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void;
  removeEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void;
}

export interface WebRTCConfig {
  endpoint: WebRTCEndpoint;
  authentication: EphemeralAuthentication;
  audioConfig: AudioConfiguration;
  dataChannelConfig?: DataChannelConfiguration;
  connectionConfig?: ConnectionConfiguration;
}

export interface WebRTCEndpoint {
  region: 'eastus2' | 'swedencentral';
  url: string; // e.g., https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc
  deployment: string; // e.g., gpt-4o-realtime-preview
}

export interface EphemeralAuthentication {
  ephemeralKey: string;
  expiresAt: Date;
  keyInfo: EphemeralKeyInfo;
}

export interface AudioConfiguration {
  sampleRate: 24000;
  format: 'pcm16';
  channels: 1; // Mono audio for voice
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface DataChannelConfiguration {
  channelName: string; // Default: 'realtime-channel'
  ordered: boolean; // Default: true for reliable event delivery
  maxRetransmits?: number;
}

export interface ConnectionConfiguration {
  iceServers?: RTCIceServer[];
  reconnectAttempts: number; // Default: 3
  reconnectDelayMs: number; // Default: 1000
  connectionTimeoutMs: number; // Default: 5000
}

export enum WebRTCConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Failed = 'failed',
  Closed = 'closed'
}

export interface ConnectionResult {
  success: boolean;
  connectionId: string;
  connectionState: WebRTCConnectionState;
  audioTracks: MediaStreamTrack[];
  remoteStream?: MediaStream;
  dataChannel?: RTCDataChannel;
  error?: WebRTCError;
}

export interface ConnectionStatistics {
  connectionId: string;
  connectionDurationMs: number;
  audioPacketsSent: number;
  audioPacketsReceived: number;
  audioBytesSent: number;
  audioBytesReceived: number;
  currentRoundTripTime?: number;
  packetsLost: number;
  jitter: number;
  dataChannelState: RTCDataChannelState;
  iceConnectionState: RTCIceConnectionState;
  connectionQuality: ConnectionQuality;
}

export enum ConnectionQuality {
  Excellent = 'excellent',
  Good = 'good',
  Fair = 'fair',
  Poor = 'poor',
  Failed = 'failed'
}

export interface WebRTCError {
  code: WebRTCErrorCode;
  message: string;
  details?: any;
  recoverable: boolean;
  timestamp: Date;
}

export class WebRTCErrorImpl extends Error implements WebRTCError {
  public readonly code: WebRTCErrorCode;
  public readonly details?: any;
  public readonly recoverable: boolean;
  public readonly timestamp: Date;

  constructor(error: WebRTCError) {
    super(error.message);
    this.name = 'WebRTCError';
    this.code = error.code;
    this.details = error.details;
    this.recoverable = error.recoverable;
    this.timestamp = error.timestamp;
  }
}

export enum WebRTCErrorCode {
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  SdpNegotiationFailed = 'SDP_NEGOTIATION_FAILED',
  IceConnectionFailed = 'ICE_CONNECTION_FAILED',
  DataChannelFailed = 'DATA_CHANNEL_FAILED',
  AudioTrackFailed = 'AUDIO_TRACK_FAILED',
  NetworkTimeout = 'NETWORK_TIMEOUT',
  RegionNotSupported = 'REGION_NOT_SUPPORTED',
  ConfigurationInvalid = 'CONFIGURATION_INVALID'
}

export type WebRTCEventType =
  | 'connectionStateChanged'
  | 'audioTrackAdded'
  | 'audioTrackRemoved'
  | 'dataChannelMessage'
  | 'dataChannelStateChanged'
  | 'connectionQualityChanged'
  | 'reconnectAttempt'
  | 'error';

export interface WebRTCEventHandler {
  (event: WebRTCEvent): Promise<void> | void;
}

export interface WebRTCEvent {
  type: WebRTCEventType;
  connectionId: string;
  timestamp: Date;
  data?: any;
}

export interface ConnectionStateChangedEvent extends WebRTCEvent {
  type: 'connectionStateChanged';
  data: {
    previousState: WebRTCConnectionState;
    currentState: WebRTCConnectionState;
    reason?: string;
  };
}

export interface AudioTrackEvent extends WebRTCEvent {
  type: 'audioTrackAdded' | 'audioTrackRemoved';
  data: {
    track: MediaStreamTrack;
    stream: MediaStream;
    isRemote: boolean;
  };
}

export interface DataChannelMessageEvent extends WebRTCEvent {
  type: 'dataChannelMessage';
  data: {
    message: RealtimeEvent;
    channel: RTCDataChannel;
  };
}

export interface ConnectionQualityChangedEvent extends WebRTCEvent {
  type: 'connectionQualityChanged';
  data: {
    previousQuality: ConnectionQuality;
    currentQuality: ConnectionQuality;
    statistics: ConnectionStatistics;
  };
}


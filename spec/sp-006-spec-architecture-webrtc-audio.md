---
title: WebRTC Audio Transport Layer
version: 1.0
date_created: 2025-09-22
last_updated: 2025-09-22
owner: Agent Voice Project
tags: [architecture, webrtc, audio, transport, realtime]
---

# Introduction

This specification defines the WebRTC Audio Transport Layer for Agent Voice's real-time voice interaction system, enabling low-latency, full-duplex audio communication with Azure OpenAI's GPT Realtime API. The WebRTC transport layer establishes peer connections, manages SDP negotiation, handles connection recovery, and provides a robust foundation for bidirectional audio streaming in VS Code webview contexts. The transport works in tandem with a Web Audio API 1.1 graph to orchestrate microphone capture, in-browser processing, and playback within the webview sandbox.

## 1. Purpose & Scope

This specification defines the WebRTC transport layer requirements for Agent Voice's voice interaction system, covering:

- WebRTC peer connection establishment and management with Azure OpenAI Realtime API
- SDP (Session Description Protocol) offer/answer negotiation for audio-only sessions
- Ephemeral key authentication integration for secure WebRTC session establishment
- Connection state management, monitoring, and automatic reconnection strategies
- Data channel integration for real-time event messaging alongside audio transport
- Audio stream configuration (PCM16, 24kHz) and codec negotiation with Azure endpoints
- Audio graph orchestration using Web Audio API 1.1 (AudioContext + MediaStream nodes) to normalize capture, processing, and playback
- Network resilience patterns including connection recovery and quality adaptation

**Intended Audience**: Extension developers, audio transport architects, and WebRTC integration specialists.

**Assumptions**:

- EphemeralKeyService provides valid authentication tokens (SP-004 dependency)
- Session management coordinates transport lifecycle (SP-005 dependency)
- VS Code webview context with Web API access for WebRTC functionality
- Web Audio API 1.1 is available in the webview context for audio graph management (AudioContext, AudioWorklet, MediaStream nodes)
- Understanding of WebRTC fundamentals and Azure OpenAI Realtime API patterns
- Knowledge of audio processing requirements and real-time constraints

## 2. Definitions

- **WebRTC Peer Connection**: Direct browser-to-Azure real-time communication channel using WebRTC standards
- **SDP Negotiation**: Session Description Protocol offer/answer exchange for connection establishment
- **Data Channel**: WebRTC data channel for real-time event messaging separate from audio streams
- **ICE Candidate**: Interactive Connectivity Establishment for NAT traversal and connectivity
- **Audio Track**: WebRTC media track carrying microphone input to Azure OpenAI endpoint
- **Remote Audio Stream**: Incoming audio stream from Azure OpenAI GPT Realtime API
- **Connection State**: Current status of WebRTC peer connection (connecting, connected, disconnected, failed)
- **Ephemeral Authentication**: Short-lived bearer token authentication for WebRTC session security
- **Audio Codec**: PCM16 audio encoding format for Azure OpenAI Realtime API compatibility
- **Connection Recovery**: Automatic reconnection logic for handling network disruptions
- **Web Audio Graph**: AudioContext-managed network of AudioNode objects defined by Web Audio API 1.1 for capture, processing, and playback in the webview

## 3. Requirements, Constraints & Guidelines

### WebRTC Connection Requirements

- **REQ-001**: WebRTC transport SHALL establish peer connections to Azure OpenAI Realtime API endpoints
- **REQ-002**: Connection establishment SHALL use ephemeral keys for bearer token authentication
- **REQ-003**: Audio sessions SHALL be configured for PCM16 format at 24kHz sample rate
- **REQ-004**: Data channels SHALL be established for real-time event messaging alongside audio
- **REQ-005**: SDP negotiation SHALL complete within 5 seconds under normal network conditions
- **REQ-006**: Connection state SHALL be monitored and reported to session management layer

### Authentication Integration Requirements

- **AUTH-001**: WebRTC authentication SHALL use ephemeral keys from EphemeralKeyService
- **AUTH-002**: Bearer token authentication SHALL be applied during SDP negotiation
- **AUTH-003**: Authentication failures SHALL trigger immediate session termination
- **AUTH-004**: Key expiration SHALL be handled gracefully with session renewal coordination

### Audio Transport Requirements

- **AUD-001**: Audio transport SHALL support full-duplex communication (simultaneous send/receive)
- **AUD-002**: Microphone input SHALL be captured and transmitted via WebRTC audio tracks
- **AUD-003**: Remote audio streams SHALL be received and made available for playback
- **AUD-004**: Audio quality SHALL adapt to network conditions while maintaining real-time constraints
- **AUD-005**: Audio interruption SHALL be supported for turn-taking and response cancellation
- **AUD-006**: Audio capture and playback SHALL be routed through a Web Audio API 1.1 AudioContext using MediaStreamAudioSourceNode, MediaStreamAudioDestinationNode, and related nodes to ensure consistent processing prior to WebRTC transmission

### Connection Management Requirements

- **CONN-001**: Connection state changes SHALL be reported via event system
- **CONN-002**: Failed connections SHALL trigger automatic reconnection with exponential backoff
- **CONN-003**: Connection health SHALL be monitored via ICE connection state and data channel status
- **CONN-004**: Graceful disconnection SHALL properly close all WebRTC resources

### Data Channel Requirements

- **DATA-001**: Data channels SHALL support JSON message exchange for real-time events
- **DATA-002**: Session configuration SHALL be transmitted via data channel after connection
- **DATA-003**: Real-time events SHALL flow bidirectionally through data channel
- **DATA-004**: Data channel failures SHALL not immediately terminate audio connection if recoverable

### Error Handling Requirements

- **ERR-001**: SDP negotiation failures SHALL provide detailed error diagnostics
- **ERR-002**: ICE connection failures SHALL trigger alternative connection strategies
- **ERR-003**: Network interruptions SHALL be detected and handled with reconnection logic
- **ERR-004**: Authentication errors SHALL be reported with clear remediation guidance

### Performance Requirements

- **PERF-001**: Audio latency SHALL be optimized for sub-200ms round-trip times
- **PERF-002**: Connection establishment SHALL complete within 5 seconds
- **PERF-003**: Memory usage SHALL be managed with proper resource cleanup
- **PERF-004**: CPU usage SHALL be optimized for continuous audio processing

### Security Requirements

- **SEC-001**: WebRTC connections SHALL use DTLS encryption for all transport
- **SEC-002**: Authentication SHALL never expose permanent API keys in webview context
- **SEC-003**: Connection endpoints SHALL be validated against allowed Azure regions
- **SEC-004**: Data integrity SHALL be maintained through WebRTC security mechanisms

### Regional Constraints

- **REG-001**: WebRTC endpoints SHALL support East US 2 and Sweden Central regions
- **REG-002**: Endpoint selection SHALL match Azure OpenAI resource region
- **REG-003**: Regional failover SHALL be supported for high availability

### Implementation Guidelines

- **GUD-001**: Use modern WebRTC APIs with appropriate polyfills for browser compatibility
- **GUD-002**: Implement state machine pattern for clear connection lifecycle management
- **GUD-003**: Provide comprehensive event system for transport state notifications
- **GUD-004**: Support diagnostic operations for connection troubleshooting
- **GUD-005**: Construct the audio pipeline on a Web Audio API 1.1 graph (AudioContext, AudioWorkletNode, MediaStream nodes) for normalization, effects processing, and bridging to WebRTC tracks

### Design Patterns

- **PAT-001**: Use Observer pattern for connection state change notifications
- **PAT-002**: Implement Factory pattern for WebRTC configuration management
- **PAT-003**: Use Strategy pattern for different connection recovery approaches
- **PAT-004**: Provide Promise-based interfaces for asynchronous operations

## 4. Interfaces & Data Contracts

### WebRTC Transport Interface

Implementations MUST create or reuse a Web Audio API 1.1 `AudioContext` to host microphone capture, processing, and playback nodes. The context SHOULD own any `AudioWorkletNode` processors, `MediaStreamAudioSourceNode` instances that feed WebRTC tracks, and `MediaStreamAudioDestinationNode` instances that render remote audio.

```typescript
import { EphemeralKeyInfo } from '../types/ephemeral';

interface WebRTCTransport {
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

interface WebRTCConfig {
  endpoint: WebRTCEndpoint;
  authentication: EphemeralAuthentication;
  audioConfig: AudioConfiguration;
  dataChannelConfig?: DataChannelConfiguration;
  connectionConfig?: ConnectionConfiguration;
}

interface WebRTCEndpoint {
  region: 'eastus2' | 'swedencentral';
  url: string; // e.g., https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc
  deployment: string; // e.g., gpt-4o-realtime-preview
}

interface EphemeralAuthentication {
  ephemeralKey: string;
  expiresAt: Date;
  keyInfo: EphemeralKeyInfo;
}

interface AudioConfiguration {
  sampleRate: 24000;
  format: 'pcm16';
  channels: 1; // Mono audio for voice
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  audioContextProvider: () => Promise<AudioContext>; // Provides Web Audio API 1.1 context for graph management
  workletModuleUrls?: string[]; // Optional AudioWorklet modules for preprocessing (e.g., VAD, normalization)
}

interface DataChannelConfiguration {
  channelName: string; // Default: 'realtime-channel'
  ordered: boolean; // Default: true for reliable event delivery
  maxRetransmits?: number;
}

interface ConnectionConfiguration {
  iceServers?: RTCIceServer[];
  reconnectAttempts: number; // Default: 3
  reconnectDelayMs: number; // Default: 1000
  connectionTimeoutMs: number; // Default: 5000
}
```

### Connection State and Events

```typescript
enum WebRTCConnectionState {
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Reconnecting = 'reconnecting',
  Failed = 'failed',
  Closed = 'closed'
}

interface ConnectionResult {
  success: boolean;
  connectionId: string;
  connectionState: WebRTCConnectionState;
  audioTracks: MediaStreamTrack[];
  remoteStream?: MediaStream;
  dataChannel?: RTCDataChannel;
  error?: WebRTCError;
}

interface ConnectionStatistics {
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

enum ConnectionQuality {
  Excellent = 'excellent',
  Good = 'good',
  Fair = 'fair',
  Poor = 'poor',
  Failed = 'failed'
}

interface WebRTCError {
  code: WebRTCErrorCode;
  message: string;
  details?: any;
  recoverable: boolean;
  timestamp: Date;
}

enum WebRTCErrorCode {
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  SdpNegotiationFailed = 'SDP_NEGOTIATION_FAILED',
  IceConnectionFailed = 'ICE_CONNECTION_FAILED',
  DataChannelFailed = 'DATA_CHANNEL_FAILED',
  AudioTrackFailed = 'AUDIO_TRACK_FAILED',
  NetworkTimeout = 'NETWORK_TIMEOUT',
  RegionNotSupported = 'REGION_NOT_SUPPORTED',
  ConfigurationInvalid = 'CONFIGURATION_INVALID'
}
```

### Event System

```typescript
type WebRTCEventType =
  | 'connectionStateChanged'
  | 'audioTrackAdded'
  | 'audioTrackRemoved'
  | 'dataChannelMessage'
  | 'dataChannelStateChanged'
  | 'connectionQualityChanged'
  | 'reconnectAttempt'
  | 'error';

interface WebRTCEventHandler {
  (event: WebRTCEvent): Promise<void> | void;
}

interface WebRTCEvent {
  type: WebRTCEventType;
  connectionId: string;
  timestamp: Date;
  data?: any;
}

interface ConnectionStateChangedEvent extends WebRTCEvent {
  type: 'connectionStateChanged';
  data: {
    previousState: WebRTCConnectionState;
    currentState: WebRTCConnectionState;
    reason?: string;
  };
}

interface AudioTrackEvent extends WebRTCEvent {
  type: 'audioTrackAdded' | 'audioTrackRemoved';
  data: {
    track: MediaStreamTrack;
    stream: MediaStream;
    isRemote: boolean;
  };
}

interface DataChannelMessageEvent extends WebRTCEvent {
  type: 'dataChannelMessage';
  data: {
    message: RealtimeEvent;
    channel: RTCDataChannel;
  };
}

interface ConnectionQualityChangedEvent extends WebRTCEvent {
  type: 'connectionQualityChanged';
  data: {
    previousQuality: ConnectionQuality;
    currentQuality: ConnectionQuality;
    statistics: ConnectionStatistics;
  };
}
```

### Azure Realtime API Integration

```typescript
interface RealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

interface SessionUpdateEvent extends RealtimeEvent {
  type: 'session.update';
  session: {
    modalities: ['audio', 'text'];
    voice: string; // e.g., 'alloy'
    input_audio_format: 'pcm16';
    output_audio_format: 'pcm16';
    input_audio_transcription?: {
      model: 'whisper-1';
    };
    turn_detection?: {
      type: 'server_vad' | 'none';
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };
    tools?: any[];
    instructions?: string;
  };
}

interface AudioBufferAppendEvent extends RealtimeEvent {
  type: 'input_audio_buffer.append';
  audio: string; // Base64 encoded PCM16 audio data
}

interface AudioBufferClearEvent extends RealtimeEvent {
  type: 'input_audio_buffer.clear';
}

interface ResponseCreateEvent extends RealtimeEvent {
  type: 'response.create';
  response?: {
    modalities: ['audio', 'text'];
    instructions?: string;
  };
}
```

### Service Integration Interfaces

```typescript
// Integration with EphemeralKeyService (SP-004)
interface EphemeralKeyIntegration {
  keyService: EphemeralKeyService;
  onKeyRenewal: (newKey: EphemeralKeyInfo) => Promise<void>;
  onKeyExpiration: () => Promise<void>;
  onAuthenticationError: (error: WebRTCError) => Promise<void>;
}

// Integration with SessionManager (SP-005)
interface SessionIntegration {
  sessionManager: SessionManager;
  onSessionStateChanged: (state: WebRTCConnectionState) => Promise<void>;
  onConnectionRecovery: () => Promise<void>;
  onConnectionFailure: (error: WebRTCError) => Promise<void>;
}

// Integration with Audio Pipeline (SP-007 future dependency)
interface AudioPipelineIntegration {
  audioContext: AudioContext; // Shared Web Audio API 1.1 context used for capture/playback graph
  onAudioInputRequired: () => Promise<MediaStreamTrack>;
  onAudioOutputReceived: (stream: MediaStream) => Promise<void>;
  onAudioQualityChanged: (quality: ConnectionQuality) => Promise<void>;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given valid ephemeral key and endpoint, When establishConnection() is called, Then WebRTC connection is established within 5 seconds
- **AC-002**: Given established connection, When audio track is added, Then audio transmission begins immediately with PCM16 format
- **AC-003**: Given active connection, When data channel message is sent, Then message is delivered and acknowledged within 100ms
- **AC-004**: Given connection failure, When automatic reconnection triggers, Then connection is re-established within 3 attempts
- **AC-005**: Given expired ephemeral key, When authentication fails, Then connection terminates gracefully with clear error
- **AC-006**: Given network interruption, When connection recovery occurs, Then audio session resumes without data loss
- **AC-007**: Given connection quality degradation, When quality monitoring detects issues, Then appropriate event is fired
- **AC-008**: Given graceful shutdown, When closeConnection() is called, Then all resources are properly cleaned up
- **AC-009**: Given SDP negotiation failure, When connection cannot be established, Then detailed diagnostics are provided
- **AC-010**: Given data channel failure, When audio connection remains active, Then session continues with audio-only operation
- **AC-011**: Given active audio graph, When microphone capture and remote playback flows are initiated, Then the Web Audio API 1.1 AudioContext routes both paths through the configured processing nodes without underruns

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for connection logic, Integration tests with mock Azure endpoints, End-to-End tests with real Azure services
- **Frameworks**: Jest with WebRTC mocks, @testing-library for component testing, Puppeteer for browser automation
- **Test Data Management**: Mock WebRTC APIs, controlled network conditions, ephemeral key simulation
- **CI/CD Integration**: Automated WebRTC testing in GitHub Actions with headless browser support
- **Coverage Requirements**: 95% coverage for connection state machine, 100% coverage for error handling paths
- **Performance Testing**: Connection latency measurement, audio quality validation, reconnection timing verification
- **Network Testing**: Simulated network failures, bandwidth limitations, packet loss scenarios
- **Security Testing**: Authentication validation, DTLS encryption verification, endpoint validation

## 7. Rationale & Context

The WebRTC transport layer design addresses critical requirements for real-time voice interaction:

1. **Low Latency**: WebRTC provides the lowest latency option for real-time audio streaming compared to WebSocket alternatives.

2. **Azure Integration**: Direct integration with Azure OpenAI Realtime API using ephemeral authentication provides secure, scalable access.

3. **Connection Resilience**: Automatic reconnection and quality monitoring ensure reliable voice sessions despite network variability.

4. **Dual Channel Design**: Separate audio and data channels enable simultaneous voice transport and event messaging for comprehensive interaction.

5. **Browser Compatibility**: WebRTC APIs provide consistent behavior across modern browsers within VS Code webview contexts.

6. **Security Model**: Ephemeral key authentication ensures secure connections without exposing permanent credentials to client contexts.

The architecture prioritizes real-time performance while maintaining security and reliability for production voice interaction scenarios.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Webview Context - Required for Web API access and WebRTC functionality
- **PLT-002**: Browser WebRTC APIs - Required for peer connection establishment and media handling
- **PLT-003**: Web Audio API 1.1 - Required for AudioContext graph management, AudioWorklet execution, and MediaStream node integration

### Extension Internal Dependencies

- **INT-001**: EphemeralKeyService (SP-004) - Required for authentication token management
- **INT-002**: SessionManager (SP-005) - Required for session lifecycle coordination
- **INT-003**: ConfigurationManager (SP-002) - Required for endpoint and audio configuration
- **INT-004**: Logger - Required for connection diagnostics and debugging

### Azure Service Dependencies

- **AZR-001**: Azure OpenAI Realtime API - Required for WebRTC endpoint and SDP negotiation
- **AZR-002**: Azure Regional Endpoints - Required for East US 2 and Sweden Central connectivity
- **AZR-003**: Azure Authentication Services - Required for ephemeral key validation

### Future Integration Dependencies

- **FUT-001**: Audio Capture Pipeline (SP-007) - Will provide microphone input streams
- **FUT-002**: Audio Playback Service - Will handle remote audio stream playback
- **FUT-003**: Voice Activity Detection (SP-008) - Will optimize connection usage based on speech detection

### Network Dependencies

- **NET-001**: STUN/TURN Services - Required for NAT traversal and connectivity establishment
- **NET-002**: DTLS Encryption - Required for secure WebRTC transport
- **NET-003**: ICE Candidate Exchange - Required for optimal connection path discovery

### Performance Dependencies

- **PERF-001**: Browser Media APIs - Required for audio stream capture and playback
- **PERF-002**: WebRTC Statistics API - Required for connection quality monitoring
- **PERF-003**: High-Resolution Timers - Required for latency measurement and optimization
- **PERF-004**: Web Audio API 1.1 AudioWorklet threads - Required for low-latency preprocessing such as VAD and gain normalization

### Testing Dependencies

- **TEST-001**: WebRTC Mock APIs - Required for unit testing without network dependencies
- **TEST-002**: Network Simulation - Required for connection resilience testing
- **TEST-003**: Azure Test Environments - Required for integration testing with real endpoints

## 9. Examples & Edge Cases

### Basic WebRTC Connection Establishment

```typescript
class WebRTCTransportImpl implements WebRTCTransport {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private connectionState: WebRTCConnectionState = WebRTCConnectionState.Disconnected;
  private eventHandlers = new Map<WebRTCEventType, WebRTCEventHandler[]>();

  async establishConnection(config: WebRTCConfig): Promise<ConnectionResult> {
    try {
      this.setConnectionState(WebRTCConnectionState.Connecting);

      // Create peer connection with Azure-optimized configuration
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
          ordered: config.dataChannelConfig?.ordered ?? true
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

      return {
        success: true,
        connectionId: this.generateConnectionId(),
        connectionState: this.connectionState,
        audioTracks: [],
        remoteStream: await this.getRemoteAudioStream(),
        dataChannel: this.dataChannel
      };

    } catch (error) {
      this.setConnectionState(WebRTCConnectionState.Failed);
      throw new WebRTCError({
        code: this.classifyError(error),
        message: error.message,
        details: error,
        recoverable: this.isRecoverableError(error),
        timestamp: new Date()
      });
    }
  }

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
    if (!this.peerConnection) return;

    this.peerConnection.oniceconnectionstatechange = () => {
      this.handleIceConnectionStateChange();
    };

    this.peerConnection.ontrack = (event) => {
      this.handleRemoteTrack(event);
    };

    this.peerConnection.ondatachannel = (event) => {
      this.handleDataChannelReceived(event.channel);
    };
  }

  private setupDataChannelHandlers(): void {
    if (!this.dataChannel) return;

    this.dataChannel.onopen = () => {
      this.sendInitialSessionUpdate();
    };

    this.dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(event);
    };

    this.dataChannel.onclose = () => {
      this.handleDataChannelClosed();
    };

    this.dataChannel.onerror = (error) => {
      this.handleDataChannelError(error);
    };
  }

  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not available for sending messages');
    }

    const messageJson = JSON.stringify(message);
    this.dataChannel.send(messageJson);
  }
}
```

### Connection Recovery and Reconnection

```typescript
interface ReconnectionStrategy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

class ConnectionRecoveryManager {
  private reconnectionStrategy: ReconnectionStrategy = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2
  };

  private currentAttempt = 0;
  private isRecovering = false;

  async handleConnectionFailure(transport: WebRTCTransport, config: WebRTCConfig): Promise<boolean> {
    if (this.isRecovering || this.currentAttempt >= this.reconnectionStrategy.maxAttempts) {
      return false;
    }

    this.isRecovering = true;

    try {
      while (this.currentAttempt < this.reconnectionStrategy.maxAttempts) {
        this.currentAttempt++;

        const delay = Math.min(
          this.reconnectionStrategy.initialDelayMs *
          Math.pow(this.reconnectionStrategy.backoffMultiplier, this.currentAttempt - 1),
          this.reconnectionStrategy.maxDelayMs
        );

        await this.delay(delay);

        try {
          const result = await transport.establishConnection(config);
          if (result.success) {
            this.currentAttempt = 0;
            this.isRecovering = false;
            return true;
          }
        } catch (error) {
          console.warn(`Reconnection attempt ${this.currentAttempt} failed:`, error);
        }
      }

      this.isRecovering = false;
      return false;

    } catch (error) {
      this.isRecovering = false;
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  reset(): void {
    this.currentAttempt = 0;
    this.isRecovering = false;
  }
}
```

### Audio Track Management

```typescript
class AudioTrackManager {
  private localTracks = new Set<MediaStreamTrack>();
  private remoteStreams = new Map<string, MediaStream>();
  private audioContext: AudioContext | null = null;
  private remoteGainNode: GainNode | null = null;
  private workletLoaded = false;

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      this.remoteGainNode = this.audioContext.createGain();
      this.remoteGainNode.gain.value = 1.0;
      this.remoteGainNode.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }

    return this.audioContext;
  }

  async addMicrophoneTrack(transport: WebRTCTransport, constraints?: MediaTrackConstraints): Promise<MediaStreamTrack> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 24000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...constraints
      }
    });

    const originalTrack = stream.getAudioTracks()[0];

    if (!originalTrack) {
      throw new Error('Failed to obtain audio track from microphone');
    }

    const context = this.ensureAudioContext();
    const sourceNode = context.createMediaStreamSource(stream);

    if (!this.workletLoaded) {
      try {
        await context.audioWorklet.addModule('/worklets/voice-normalizer.js');
        this.workletLoaded = true;
      } catch (workletError) {
        console.warn('AudioWorklet module optional load failure', workletError);
      }
    }

    const destinationNode = context.createMediaStreamDestination();
    sourceNode.connect(destinationNode);

    const processedTrack = destinationNode.stream.getAudioTracks()[0] ?? originalTrack;

    await transport.addAudioTrack(processedTrack);

    this.localTracks.add(processedTrack);
    this.localTracks.add(originalTrack);

    return processedTrack;
  }

  handleRemoteStream(stream: MediaStream): void {
    const streamId = stream.id;
    this.remoteStreams.set(streamId, stream);

    const context = this.ensureAudioContext();
    const sourceNode = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();

    sourceNode.connect(analyser);
    analyser.connect(this.remoteGainNode ?? context.destination);
  }

  async stopAllTracks(): Promise<void> {
    // Stop local tracks
    for (const track of this.localTracks) {
      track.stop();
    }
    this.localTracks.clear();

    // Clean up remote streams
    for (const [, stream] of this.remoteStreams) {
      stream.getTracks().forEach(track => track.stop());
    }
    this.remoteStreams.clear();

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
      this.remoteGainNode = null;
      this.workletLoaded = false;
    }
  }
}
```

### Web Audio Graph Integration with WebRTC

```typescript
async function bridgeWebrtcWithWebAudio(
  transport: WebRTCTransport,
  context: AudioContext,
  remoteStream: MediaStream
): Promise<void> {
  const inputSource = context.createMediaStreamSource(await navigator.mediaDevices.getUserMedia({ audio: true }));
  const normalizer = context.createGain();
  normalizer.gain.value = 0.9;

  const outboundDestination = context.createMediaStreamDestination();
  inputSource.connect(normalizer).connect(outboundDestination);

  await transport.addAudioTrack(outboundDestination.stream.getAudioTracks()[0]);

  const inboundSource = context.createMediaStreamSource(remoteStream);
  const spatializer = new PannerNode(context, { panningModel: 'HRTF' });
  inboundSource.connect(spatializer).connect(context.destination);
}
```

### Error Classification and Recovery

```typescript
class WebRTCErrorHandler {
  classifyError(error: any): WebRTCErrorCode {
    if (error.name === 'NotAllowedError') {
      return WebRTCErrorCode.AuthenticationFailed;
    }

    if (error.message?.includes('SDP')) {
      return WebRTCErrorCode.SdpNegotiationFailed;
    }

    if (error.message?.includes('ICE')) {
      return WebRTCErrorCode.IceConnectionFailed;
    }

    if (error.message?.includes('timeout')) {
      return WebRTCErrorCode.NetworkTimeout;
    }

    return WebRTCErrorCode.ConfigurationInvalid;
  }

  isRecoverableError(error: any): boolean {
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

  async handleError(error: WebRTCError, transport: WebRTCTransport, config: WebRTCConfig): Promise<void> {
    switch (error.code) {
      case WebRTCErrorCode.AuthenticationFailed:
        // Request new ephemeral key
        await this.handleAuthenticationError(config);
        break;

      case WebRTCErrorCode.IceConnectionFailed:
        // Attempt connection recovery
        await this.handleConnectionRecovery(transport, config);
        break;

      case WebRTCErrorCode.DataChannelFailed:
        // Continue with audio-only if possible
        await this.handleDataChannelFailure(transport);
        break;

      default:
        // Log error and terminate session
        await this.handleFatalError(error);
        break;
    }
  }

  private async handleAuthenticationError(config: WebRTCConfig): Promise<void> {
    // Coordinate with EphemeralKeyService for key renewal
    // This will be handled by session management layer
    throw new Error('Authentication error requires session renewal');
  }

  private async handleConnectionRecovery(transport: WebRTCTransport, config: WebRTCConfig): Promise<void> {
    const recovery = new ConnectionRecoveryManager();
    const success = await recovery.handleConnectionFailure(transport, config);

    if (!success) {
      throw new Error('Connection recovery failed after maximum attempts');
    }
  }
}
```

## 10. Validation Criteria

- WebRTC transport establishes connections to Azure OpenAI endpoints within 5-second timeout
- SDP negotiation completes successfully with ephemeral key authentication
- Audio tracks are properly added and transmitted in PCM16 format at 24kHz
- Data channels deliver real-time events with sub-100ms latency
- Connection failures trigger automatic reconnection with exponential backoff
- Web Audio API 1.1 AudioContext graph handles microphone capture, optional AudioWorklet processing, and remote playback consistently across sessions
- Authentication errors are properly classified and handled with session renewal
- Connection state changes are accurately reported to session management layer
- Resource cleanup is performed completely during graceful disconnection
- Network interruptions are detected and recovered without audio data loss
- Connection quality monitoring provides accurate real-time feedback

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-004: Ephemeral Key Service (Azure Realtime)](sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-005: Session Management & Renewal](sp-005-spec-design-session-management.md)
- [SP-007: Microphone Capture & Audio Pipeline](sp-007-spec-design-audio-capture-pipeline.md) (Future dependency)
- [SP-035: Audio Format & Codec Standards](sp-035-spec-design-audio-codec-standards.md) (Future dependency)
- [Azure OpenAI Realtime API via WebRTC](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)
- [WebRTC Specification](https://www.w3.org/TR/webrtc/)
- [Azure OpenAI Realtime Audio Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript)
- [Web Audio API 1.1 Specification](https://webaudio.github.io/web-audio-api/)

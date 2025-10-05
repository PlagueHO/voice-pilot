import type { AudioCaptureSampleRate } from "./audio-capture";
import { EphemeralKeyInfo } from "./ephemeral";
import type { RealtimeEvent } from "./realtime-events";

export type AudioCodecProfileId =
  | "pcm16-24k-mono"
  | "pcm16-16k-mono"
  | "opus-48k-fallback";

/**
 * Contract for a realtime WebRTC transport that communicates with the Azure OpenAI Realtime API.
 *
 * @remarks
 * Implementations must remain resilient to transient network failures, support audio-first
 * operation during data-channel outages, and emit telemetry describing recovery attempts.
 */
export interface WebRTCTransport {
  // Connection lifecycle
  /**
   * Establishes the underlying peer connection and negotiates audio/data channels.
   *
   * @param config - Complete transport configuration including endpoint and session details.
   * @returns Resolves with the negotiated connection result when successful.
   */
  establishConnection(config: WebRTCConfig): Promise<ConnectionResult>;
  /**
   * Closes the active peer connection and disposes any associated resources.
   */
  closeConnection(): Promise<void>;
  /**
   * Attempts to restart ICE using the supplied configuration.
   *
   * @param config - Connection configuration containing ICE server options.
   * @returns Resolves with `true` when the restart completed successfully.
   */
  restartIce(config: WebRTCConfig): Promise<boolean>;
  /**
   * Recreates the realtime data channel after a failure.
   *
   * @param config - Connection configuration containing channel options.
   * @returns The newly created RTC data channel or `null` when creation fails.
   */
  recreateDataChannel(config: WebRTCConfig): Promise<RTCDataChannel | null>;

  // Connection state
  /**
   * Retrieves the current aggregate connection state.
   */
  getConnectionState(): WebRTCConnectionState;
  /**
   * Returns the latest observed connection statistics snapshot.
   */
  getConnectionStatistics(): ConnectionStatistics;
  /**
   * Provides the current data channel state or "unavailable" when no channel is present.
   */
  getDataChannelState(): RTCDataChannelState | "unavailable";
  /**
   * Indicates whether the transport is currently operating in audio-only fallback mode.
   */
  isDataChannelFallbackActive(): boolean;
  /**
   * Publishes a recovery telemetry event to interested observers.
   *
   * @param event - Telemetry payload describing the recovery outcome.
   */
  publishRecoveryEvent(event: RecoveryEventPayload): void;

  // Audio stream management
  /**
   * Registers a new outbound microphone track with the peer connection.
   *
   * @param track - The audio track to attach.
   * @param options - Optional metadata describing the track.
   */
  addAudioTrack(
    track: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void>;
  /**
   * Swaps an existing audio track with a new track while maintaining processing metadata.
   *
   * @param oldTrack - Track currently attached to the peer connection.
   * @param newTrack - Replacement track that should be attached.
   * @param options - Optional metadata describing the track replacement.
   */
  replaceAudioTrack?(
    oldTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void>;
  /**
   * Removes an outbound audio track from the peer connection.
   *
   * @param track - Track to detach.
   */
  removeAudioTrack(track: MediaStreamTrack): Promise<void>;
  /**
   * Obtains the remote media stream that contains synthesized audio from the service.
   */
  getRemoteAudioStream(): MediaStream | null;
  /**
   * Returns the active `AudioContext`, when available, used for playback or processing.
   */
  getAudioContext(): AudioContext | null;

  // Data channel operations
  /**
   * Sends a realtime event over the data channel, applying queueing behaviour when needed.
   *
   * @param message - Event payload to send to the remote peer.
   */
  sendDataChannelMessage(message: RealtimeEvent): Promise<void>;

  // Event handling
  /**
   * Registers a handler for changes emitted by the transport.
   *
   * @param type - Event type of interest.
   * @param handler - Callback to invoke when the event fires.
   */
  addEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void;
  /**
   * Removes an existing event handler.
   *
   * @param type - Event type originally registered.
   * @param handler - Callback to remove.
   */
  removeEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void;
}

/**
 * Aggregate configuration necessary to start a realtime WebRTC session with Azure OpenAI.
 */
export interface WebRTCConfig {
  /** Endpoint metadata describing the Azure regional deployment. */
  endpoint: WebRTCEndpoint;
  /** Ephemeral credential bundle required to authenticate the session. */
  authentication: EphemeralAuthentication;
  /** Audio capture and playback configuration. */
  audioConfig: AudioConfiguration;
  /** Session-specific options such as locale, voice, and turn detection. */
  sessionConfig: WebRTCSessionConfiguration;
  /** Optional configuration for the signalling data channel. */
  dataChannelConfig?: DataChannelConfiguration;
  /** Optional connection retry and timeout configuration. */
  connectionConfig?: ConnectionConfiguration;
}

/**
 * Identifies the Azure OpenAI realtime endpoint that should service the WebRTC session.
 */
export interface WebRTCEndpoint {
  region: "eastus2" | "swedencentral";
  url: string; // e.g., https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc
  deployment: string; // e.g., gpt-4o-realtime-preview
  apiVersion: string;
}

/**
 * Ephemeral authentication material returned by the Azure OpenAI session service.
 */
export interface EphemeralAuthentication {
  ephemeralKey: string;
  expiresAt: Date;
  keyInfo: EphemeralKeyInfo;
}

/**
 * Configuration describing how the shared `AudioContext` should be provisioned and resumed.
 */
export interface AudioContextProviderConfiguration {
  /**
   * Strategy identifier for downstream services. Currently only a shared provider is supported.
   */
  strategy: "shared";
  /**
   * Desired latency category for the shared AudioContext. Defaults to "interactive".
   */
  latencyHint: AudioContextLatencyCategory | number;
  /**
   * Whether the AudioContext should resume automatically when voice sessions start.
   */
  resumeOnActivation: boolean;
  /**
   * Whether resuming the AudioContext requires an explicit user gesture before activation.
   */
  requiresUserGesture: boolean;
}

/**
 * Audio capture settings required by the realtime transport layer.
 */
export const SUPPORTED_AUDIO_SAMPLE_RATES: ReadonlyArray<AudioCaptureSampleRate> =
  [16000, 24000, 48000];

export const MINIMUM_AUDIO_SAMPLE_RATE: AudioCaptureSampleRate = 16000;

export interface AudioConfiguration {
  /** Negotiated capture sample rate. Must remain within {@link SUPPORTED_AUDIO_SAMPLE_RATES}. */
  sampleRate: AudioCaptureSampleRate;
  /** Codec profile identifier aligned with SP-035 audio codec standards. */
  codecProfileId: AudioCodecProfileId;
  format: "pcm16";
  channels: 1; // Mono audio for voice
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  audioContextProvider: AudioContextProviderConfiguration;
  workletModuleUrls: ReadonlyArray<string>;
}

/**
 * Options that tailor the behaviour of the GPT Realtime session, including locale and VAD.
 */
export interface WebRTCSessionConfiguration {
  voice?: string;
  locale?: string;
  instructions?: string;
  inputAudioFormat: "pcm16" | "pcm24" | "pcm32";
  outputAudioFormat: "pcm16" | "pcm24" | "pcm32";
  transcriptionModel?: string;
  turnDetection?: {
    type: "server_vad" | "semantic_vad" | "none";
    threshold?: number;
    prefixPaddingMs?: number;
    silenceDurationMs?: number;
    createResponse?: boolean;
    interruptResponse?: boolean;
    eagerness?: "low" | "auto" | "high";
  };
}

/**
 * Metadata associated with locally produced audio tracks registered with the transport.
 */
export interface AudioTrackRegistrationOptions {
  processedStream?: MediaStream;
  sourceStream?: MediaStream;
  audioContext?: AudioContext;
  metadata?: Record<string, unknown>;
}

/**
 * Validates an `AudioConfiguration` and returns a list of problems if the configuration is invalid.
 *
 * @param configuration - Audio configuration to validate.
 * @returns An array of error messages; empty when the configuration is valid.
 */
export function validateAudioConfiguration(
  configuration: AudioConfiguration,
): ReadonlyArray<string> {
  const errors: string[] = [];

  switch (configuration.codecProfileId) {
    case "pcm16-24k-mono":
      if (configuration.sampleRate !== 24000) {
        errors.push(
          "pcm16-24k-mono codec profile requires a 24 kHz sample rate.",
        );
      }
      break;
    case "pcm16-16k-mono":
      if (configuration.sampleRate !== 16000) {
        errors.push(
          "pcm16-16k-mono codec profile requires a 16 kHz sample rate.",
        );
      }
      break;
    case "opus-48k-fallback":
      if (configuration.sampleRate !== 48000) {
        errors.push(
          "opus-48k-fallback codec profile requires a 48 kHz sample rate.",
        );
      }
      break;
    default:
      errors.push("Unsupported codec profile identifier supplied.");
  }

  if (!SUPPORTED_AUDIO_SAMPLE_RATES.includes(configuration.sampleRate)) {
    errors.push(
      `Audio sample rate must be one of ${SUPPORTED_AUDIO_SAMPLE_RATES.join(
        ", ",
      )} Hz for realtime transport compliance.`,
    );
  } else if (configuration.sampleRate < MINIMUM_AUDIO_SAMPLE_RATE) {
    errors.push(
      `Audio sample rate must be at least ${MINIMUM_AUDIO_SAMPLE_RATE} Hz to satisfy realtime transport guardrails.`,
    );
  }

  if (configuration.format !== "pcm16") {
    errors.push(
      "Audio format must be pcm16 for realtime transport compliance.",
    );
  }

  if (configuration.channels !== 1) {
    errors.push("Audio channel count must remain mono (1 channel).");
  }

  if (!configuration.audioContextProvider) {
    errors.push("audioContextProvider configuration is required.");
  } else {
    if (configuration.audioContextProvider.strategy !== "shared") {
      errors.push(
        "Only the shared audio context provider strategy is currently supported.",
      );
    }

    if (
      configuration.audioContextProvider.latencyHint !== "interactive" &&
      typeof configuration.audioContextProvider.latencyHint !== "number"
    ) {
      errors.push(
        'AudioContext latency hint must be either "interactive" or a numeric value in seconds.',
      );
    }
  }

  if (!Array.isArray(configuration.workletModuleUrls)) {
    errors.push("workletModuleUrls must be an array of module URLs.");
  }

  return errors;
}

/**
 * Controls how the realtime signalling data channel should be created.
 */
export interface DataChannelConfiguration {
  channelName: string; // Default: 'realtime-channel'
  ordered: boolean; // Default: true for reliable event delivery
  maxRetransmits?: number;
}

/**
 * Defines retry and timeout behaviour for the peer connection.
 */
export interface ConnectionConfiguration {
  iceServers?: RTCIceServer[];
  reconnectAttempts: number; // Default: 3
  reconnectDelayMs: number; // Default: 1000
  connectionTimeoutMs: number; // Default: 5000
}

/**
 * Represents the coarse status of the peer connection lifecycle.
 */
export enum WebRTCConnectionState {
  Disconnected = "disconnected",
  Connecting = "connecting",
  Connected = "connected",
  Reconnecting = "reconnecting",
  Failed = "failed",
  Closed = "closed",
}

/**
 * Result of attempting to establish a realtime connection with Azure OpenAI.
 */
export interface ConnectionResult {
  success: boolean;
  connectionId: string;
  connectionState: WebRTCConnectionState;
  audioTracks: MediaStreamTrack[];
  remoteStream?: MediaStream;
  dataChannel?: RTCDataChannel;
  error?: WebRTCError;
}

/**
 * Snapshot of transport-level metrics captured from the peer connection.
 */
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
  negotiationLatencyMs?: number;
  statsIntervalMs?: number;
  timestamp?: number;
}

/**
 * Qualitative indicator of overall realtime connection health.
 */
export enum ConnectionQuality {
  Excellent = "excellent",
  Good = "good",
  Fair = "fair",
  Poor = "poor",
  Failed = "failed",
}

/**
 * Structured error raised by transport components when failures occur.
 */
export interface WebRTCError {
  code: WebRTCErrorCode;
  message: string;
  details?: any;
  recoverable: boolean;
  timestamp: Date;
}

/**
 * Error wrapper that exposes typed metadata while behaving like a native `Error`.
 */
export class WebRTCErrorImpl extends Error implements WebRTCError {
  public readonly code: WebRTCErrorCode;
  public readonly details?: any;
  public readonly recoverable: boolean;
  public readonly timestamp: Date;

  constructor(error: WebRTCError) {
    super(error.message);
    this.name = "WebRTCError";
    this.code = error.code;
    this.details = error.details;
    this.recoverable = error.recoverable;
    this.timestamp = error.timestamp;
  }
}

/**
 * Enumerates well-known WebRTC failures surfaced by the transport layer.
 */
export enum WebRTCErrorCode {
  AuthenticationFailed = "AUTHENTICATION_FAILED",
  SdpNegotiationFailed = "SDP_NEGOTIATION_FAILED",
  IceConnectionFailed = "ICE_CONNECTION_FAILED",
  DataChannelFailed = "DATA_CHANNEL_FAILED",
  AudioTrackFailed = "AUDIO_TRACK_FAILED",
  NetworkTimeout = "NETWORK_TIMEOUT",
  RegionNotSupported = "REGION_NOT_SUPPORTED",
  ConfigurationInvalid = "CONFIGURATION_INVALID",
}

/**
 * Event types emitted by the transport to describe connection and recovery changes.
 */
export type WebRTCEventType =
  | "connectionStateChanged"
  | "audioTrackAdded"
  | "audioTrackRemoved"
  | "dataChannelMessage"
  | "dataChannelStateChanged"
  | "connectionQualityChanged"
  | "connectionDiagnostics"
  | "reconnectAttempt"
  | "reconnectSucceeded"
  | "reconnectFailed"
  | "fallbackStateChanged"
  | "error";

/**
 * Signature for callbacks registered against transport events.
 */
export interface WebRTCEventHandler {
  (event: WebRTCEvent): Promise<void> | void;
}

/**
 * Base shape for transport events propagated to observers.
 */
export interface WebRTCEvent {
  type: WebRTCEventType;
  connectionId: string;
  timestamp: Date;
  data?: any;
}

/**
 * Event describing a transition between two connection states.
 */
export interface ConnectionStateChangedEvent extends WebRTCEvent {
  type: "connectionStateChanged";
  data: {
    previousState: WebRTCConnectionState;
    currentState: WebRTCConnectionState;
    reason?: string;
  };
}

/**
 * Event published when audio tracks are added to or removed from the peer connection.
 */
export interface AudioTrackEvent extends WebRTCEvent {
  type: "audioTrackAdded" | "audioTrackRemoved";
  data: {
    track: MediaStreamTrack;
    stream: MediaStream;
    isRemote: boolean;
    processedStream?: MediaStream;
    sourceStream?: MediaStream;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Event emitted for inbound data channel messages containing realtime events.
 */
export interface DataChannelMessageEvent extends WebRTCEvent {
  type: "dataChannelMessage";
  data: {
    message: RealtimeEvent;
    channel: RTCDataChannel;
  };
}

/**
 * Event highlighting a change in measured connection quality.
 */
export interface ConnectionQualityChangedEvent extends WebRTCEvent {
  type: "connectionQualityChanged";
  data: {
    previousQuality: ConnectionQuality;
    currentQuality: ConnectionQuality;
    statistics: ConnectionStatistics;
  };
}

/**
 * Diagnostic sample emitted when fresh connection statistics are collected.
 */
export interface ConnectionDiagnosticsEvent extends WebRTCEvent {
  type: "connectionDiagnostics";
  data: {
    statistics: ConnectionStatistics;
    statsIntervalMs: number;
    negotiation?: {
      durationMs: number;
      timeoutMs: number;
      timedOut: boolean;
      errorCode?: WebRTCErrorCode;
    };
  };
}

/**
 * Recovery operations attempted by the transport during fault handling.
 */
export type RecoveryStrategy =
  | "retry_connection"
  | "restart_ice"
  | "recreate_datachannel"
  | "full_reconnect";

/**
 * Telemetry emitted before a recovery attempt is executed.
 */
export interface ReconnectAttemptEvent extends WebRTCEvent {
  type: "reconnectAttempt";
  data: {
    strategy: RecoveryStrategy;
    attempt: number;
    delayMs: number;
  };
}

/**
 * Telemetry emitted after a recovery attempt completes, indicating success or failure.
 */
export interface ReconnectResultEvent extends WebRTCEvent {
  type: "reconnectSucceeded" | "reconnectFailed";
  data: {
    strategy: RecoveryStrategy;
    attempt: number;
    durationMs: number;
    error?: WebRTCError;
  };
}

/**
 * Event triggered when the data channel transitions between states or enters fallback mode.
 */
export interface DataChannelStateChangedEvent extends WebRTCEvent {
  type: "dataChannelStateChanged" | "fallbackStateChanged";
  data: {
    state: RTCDataChannelState | "unavailable";
    fallbackActive: boolean;
    queuedMessages: number;
    reason?: string;
  };
}

/**
 * Payload forwarded to telemetry observers describing recovery lifecycle milestones.
 */
export type RecoveryEventPayload =
  | {
      type: "reconnectAttempt";
      strategy: RecoveryStrategy;
      attempt: number;
      delayMs: number;
    }
  | {
      type: "reconnectSucceeded";
      strategy: RecoveryStrategy;
      attempt: number;
      durationMs: number;
    }
  | {
      type: "reconnectFailed";
      strategy: RecoveryStrategy;
      attempt: number;
      durationMs: number;
      error?: WebRTCError | unknown;
    };

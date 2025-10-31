import * as vscode from "vscode";
import { ServiceInitializable } from "../core/service-initializable";
import type { AgentVoiceError } from "./error/agent-voice-error";

/**
 * Defines the contract for retrieving, managing, and monitoring ephemeral keys that
 * authorize realtime Azure OpenAI sessions.
 */
export interface EphemeralKeyService extends ServiceInitializable {
  /**
   * Requests a fresh ephemeral key from Azure or the Agent Voice backend.
   *
   * @returns Metadata describing the newly issued key or the failure details.
   */
  requestEphemeralKey(): Promise<EphemeralKeyResult>;

  /**
   * Retrieves the currently cached key if one has already been issued.
   *
   * @returns Information about the active key or undefined when no key is stored.
   */
  getCurrentKey(): EphemeralKeyInfo | undefined;

  /**
   * Renews the current key, typically used shortly before expiration.
   *
   * @returns The result of the renewal operation including the refreshed key payload.
   */
  renewKey(): Promise<EphemeralKeyResult>;

  /**
   * Revokes the cached key across both local state and remote Azure resources.
   */
  revokeCurrentKey(): Promise<void>;

  /**
   * Creates a new realtime session bound to the currently valid ephemeral key.
   *
   * @returns Connection data for establishing the realtime voice channel.
   */
  createRealtimeSession(): Promise<RealtimeSessionInfo>;

  /**
   * Ends an existing realtime session and releases associated resources.
   *
   * @param sessionId The identifier returned when the session was created.
   */
  endSession(sessionId: string): Promise<void>;

  /**
   * Checks if the cached key is still valid according to expiration and service rules.
   *
   * @returns True when the key may be safely reused.
   */
  isKeyValid(): boolean;

  /**
   * Retrieves the expiration timestamp for the currently cached key.
   *
   * @returns The UTC expiration time or undefined when no key is present.
   */
  getKeyExpiration(): Date | undefined;

  /**
   * Executes a health check that verifies connectivity and credential validity.
   *
   * @returns Diagnostics describing the authentication capabilities of the service.
   */
  testAuthentication(): Promise<AuthenticationTestResult>;

  /**
   * Registers a callback for key renewal events.
   *
   * @param handler Invoked whenever a new key is obtained.
   * @returns Disposable that removes the handler.
   */
  onKeyRenewed(handler: KeyRenewalHandler): vscode.Disposable;

  /**
   * Registers a callback that fires when the current key expires.
   *
   * @param handler Invoked with details about the expired key.
   * @returns Disposable that removes the handler.
   */
  onKeyExpired(handler: KeyExpirationHandler): vscode.Disposable;

  /**
   * Registers a callback that reports authentication failures.
   *
   * @param handler Invoked with contextual error information.
   * @returns Disposable that removes the handler.
   */
  onAuthenticationError(handler: AuthenticationErrorHandler): vscode.Disposable;
}

/**
 * Represents the outcome of a request for an ephemeral key, including metadata when successful.
 */
export interface EphemeralKeyResult {
  /** Indicates whether the operation succeeded. */
  success: boolean;
  /** The issued key secret when available. */
  ephemeralKey?: string;
  /** Identifier associated with the issued key or session. */
  sessionId?: string;
  /** Expiration timestamp for the key. */
  expiresAt?: Date;
  /** Timestamp when the key was minted. */
  issuedAt?: Date;
  /** Recommended timestamp to proactively refresh the key. */
  refreshAt?: Date;
  /** Seconds remaining before the key should be refreshed. */
  secondsUntilRefresh?: number;
  /** Seconds defining the proactive refresh cadence. */
  refreshIntervalSeconds?: number;
  /** Detailed error information when the request failed. */
  error?: AuthenticationError;
}

/**
 * Describes the locally cached ephemeral key state.
 */
export interface EphemeralKeyInfo {
  /** The raw ephemeral key value. */
  key: string;
  /** Session identifier tied to the key issuance. */
  sessionId: string;
  /** Timestamp indicating when the key was obtained. */
  issuedAt: Date;
  /** Timestamp when the key will expire. */
  expiresAt: Date;
  /** Flag indicating whether the key currently passes validation. */
  isValid: boolean;
  /** Number of seconds remaining before expiration. */
  secondsRemaining: number;
  /** Timestamp when the key should be proactively refreshed. */
  refreshAt: Date;
  /** Seconds remaining before the proactive refresh window elapses. */
  secondsUntilRefresh: number;
  /** Total TTL reported by the service in seconds. */
  ttlSeconds: number;
  /** Seconds defining the proactive refresh cadence. */
  refreshIntervalSeconds: number;
}

/**
 * Connection details required to establish a realtime Agent Voice session.
 */
export interface RealtimeSessionInfo {
  /** Unique session identifier returned by the backend. */
  sessionId: string;
  /** Ephemeral key issued for the session. */
  ephemeralKey: string;
  /** Optional WebSocket fallback URL when WebRTC is unavailable. */
  websocketUrl?: string;
  /** WebRTC URL used for low-latency audio streaming. */
  webrtcUrl: string;
  /** Expiration date for the realtime session. */
  expiresAt: Date;
  /** Timestamp indicating when the session credentials were minted. */
  issuedAt: Date;
  /** Timestamp indicating when the credentials should be refreshed. */
  refreshAt: Date;
  /** Interval in milliseconds representing the proactive refresh cadence. */
  refreshIntervalMs: number;
  /** Complete key metadata shared with downstream services. */
  keyInfo: EphemeralKeyInfo;
}

/**
 * Aggregated diagnostics for verifying authentication readiness.
 */
export interface AuthenticationTestResult {
  /** Indicates that all checks passed. */
  success: boolean;
  /** Azure OpenAI endpoint used for validation. */
  endpoint: string;
  /** Azure region associated with the endpoint. */
  region: string;
  /** True when credentials are present and valid. */
  hasValidCredentials: boolean;
  /** True when the service can successfully create sessions. */
  canCreateSessions: boolean;
  /** Optional latency measurement for the test request. */
  latencyMs?: number;
  /** Optional error message describing why validation failed. */
  error?: string;
}

/**
 * Detailed information about authentication failures and recovery guidance.
 */
export interface AuthenticationError {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message. */
  message: string;
  /** Indicates whether the operation can be safely retried. */
  isRetryable: boolean;
  /** Suggested remediation steps or user guidance. */
  remediation: string;
  /** Raw Azure error payload for diagnostics. */
  azureErrorDetails?: any;
  /** Optional Agent Voice-specific error wrapper. */
  voicePilotError?: AgentVoiceError;
}

/**
 * Request payload for creating an Azure OpenAI realtime session.
 */
export interface AzureSessionRequest {
  /** Model deployment name, e.g., "gpt-4o-realtime-preview". */
  model: string;
  /** Optional voice selection for synthesized output. */
  voice?: string;
  /** Optional system instructions applied to the session. */
  instructions?: string;
  /** Audio input format supported by the session. */
  input_audio_format?: "pcm16" | "pcm24" | "pcm32";
  /** Audio output format produced by the session. */
  output_audio_format?: "pcm16" | "pcm24" | "pcm32";
  /** Optional server-side voice activity detection configuration. */
  turn_detection?: {
    /** VAD mode requested for the session. */
    type: "server_vad" | "semantic_vad";
    /** Optional threshold for detecting speech. */
    threshold?: number;
    /** Optional prefix padding to include before detected speech. */
    prefix_padding_ms?: number;
    /** Optional required silence duration to close a turn. */
    silence_duration_ms?: number;
    /** Automatically create responses when a turn closes. */
    create_response?: boolean;
    /** Interrupt active responses when new speech is detected. */
    interrupt_response?: boolean;
    /** Aggressiveness level for semantic VAD. */
    eagerness?: "low" | "auto" | "high";
  };
}

/**
 * Response payload returned after creating an Azure OpenAI realtime session.
 */
export interface AzureSessionResponse {
  /** Session identifier returned by Azure. */
  id: string;
  /** Model deployment used for the session. */
  model: string;
  /** Unix timestamp describing when the session expires. */
  expires_at: number;
  /** Ephemeral client secret used to authenticate the session. */
  client_secret: {
    /** Ephemeral key value. */
    value: string;
    /** Unix timestamp of the key expiration. */
    expires_at: number;
  };
  /** Optional turn detection configuration returned by Azure. */
  turn_detection?: object;
  /** Optional voice set on the session. */
  voice?: string;
  /** Optional instructions echoed back by the service. */
  instructions?: string;
  /** Optional audio input format echoed back by the service. */
  input_audio_format?: string;
  /** Optional audio output format echoed back by the service. */
  output_audio_format?: string;
}

/**
 * Connection information for establishing a WebRTC transport to Azure OpenAI realtime.
 */
export interface WebRTCConnectionInfo {
  /** Unique session identifier. */
  sessionId: string;
  /** Ephemeral key required for the WebRTC negotiation. */
  ephemeralKey: string;
  /** Base URL for the WebRTC signaling endpoint. */
  webrtcUrl: string;
  /** List of ICE servers used during peer connection setup. */
  iceServers?: RTCIceServer[];
}

/**
 * Callback triggered when a new ephemeral key is issued.
 */
export interface KeyRenewalHandler {
  /**
   * @param result Metadata describing the newly issued key.
   */
  (result: EphemeralKeyResult): Promise<void>;
}

/**
 * Callback triggered when the current ephemeral key expires.
 */
export interface KeyExpirationHandler {
  /**
   * @param info Details about the key that expired.
   */
  (info: EphemeralKeyInfo): Promise<void>;
}

/**
 * Callback triggered when an authentication error occurs.
 */
export interface AuthenticationErrorHandler {
  /**
   * @param error Diagnostics describing the failure.
   */
  (error: AuthenticationError): Promise<void>;
}

/**
 * Configuration options controlling how the ephemeral key service renews and retains keys.
 */
export interface EphemeralKeyServiceConfig {
  /** Margin in seconds before expiry when proactive renewal should occur. */
  renewalMarginSeconds: number;
  /** Interval in milliseconds to proactively refresh ephemeral keys. */
  proactiveRenewalIntervalMs: number;
  /** Maximum number of retry attempts for key requests. */
  maxRetryAttempts: number;
  /** Backoff delay in milliseconds between retries. */
  retryBackoffMs: number;
  /** Maximum duration in milliseconds before a session is considered stale. */
  sessionTimeoutMs: number;
}

import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';

// Core service interface
export interface EphemeralKeyService extends ServiceInitializable {
  // Primary authentication operations
  requestEphemeralKey(): Promise<EphemeralKeyResult>;
  getCurrentKey(): EphemeralKeyInfo | undefined;
  renewKey(): Promise<EphemeralKeyResult>;
  revokeCurrentKey(): Promise<void>;

  // Session management
  createRealtimeSession(): Promise<RealtimeSessionInfo>;
  endSession(sessionId: string): Promise<void>;

  // Lifecycle and diagnostics
  isKeyValid(): boolean;
  getKeyExpiration(): Date | undefined;
  testAuthentication(): Promise<AuthenticationTestResult>;

  // Event handling
  onKeyRenewed(handler: KeyRenewalHandler): vscode.Disposable;
  onKeyExpired(handler: KeyExpirationHandler): vscode.Disposable;
  onAuthenticationError(handler: AuthenticationErrorHandler): vscode.Disposable;
}

// Core result and info types
export interface EphemeralKeyResult {
  success: boolean;
  ephemeralKey?: string;
  sessionId?: string;
  expiresAt?: Date;
  error?: AuthenticationError;
}

export interface EphemeralKeyInfo {
  key: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
  isValid: boolean;
  secondsRemaining: number;
}

export interface RealtimeSessionInfo {
  sessionId: string;
  ephemeralKey: string;
  websocketUrl?: string;
  webrtcUrl: string;
  expiresAt: Date;
}

export interface AuthenticationTestResult {
  success: boolean;
  endpoint: string;
  region: string;
  hasValidCredentials: boolean;
  canCreateSessions: boolean;
  latencyMs?: number;
  error?: string;
}

export interface AuthenticationError {
  code: string;
  message: string;
  isRetryable: boolean;
  remediation: string;
  azureErrorDetails?: any;
}

// Azure Sessions API contracts
export interface AzureSessionRequest {
  model: string; // e.g., "gpt-4o-realtime-preview"
  voice?: string; // Optional voice selection
  instructions?: string; // Optional system instructions
  input_audio_format?: 'pcm16'; // Audio format specification
  output_audio_format?: 'pcm16';
  turn_detection?: {
    type: 'server_vad';
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
}

export interface AzureSessionResponse {
  id: string; // Session identifier
  model: string;
  expires_at: number; // Unix timestamp
  client_secret: {
    value: string; // Ephemeral key
    expires_at: number;
  };
  turn_detection?: object;
  voice?: string;
  instructions?: string;
  input_audio_format?: string;
  output_audio_format?: string;
}

// WebRTC connection information
export interface WebRTCConnectionInfo {
  sessionId: string;
  ephemeralKey: string;
  webrtcUrl: string; // https://{region}.realtimeapi-preview.ai.azure.com/v1/realtimertc
  iceServers?: RTCIceServer[];
}

// Event handler interfaces
export interface KeyRenewalHandler {
  (result: EphemeralKeyResult): Promise<void>;
}

export interface KeyExpirationHandler {
  (info: EphemeralKeyInfo): Promise<void>;
}

export interface AuthenticationErrorHandler {
  (error: AuthenticationError): Promise<void>;
}

// Service configuration
export interface EphemeralKeyServiceConfig {
  renewalMarginSeconds: number; // Default: 10
  maxRetryAttempts: number; // Default: 3
  retryBackoffMs: number; // Default: 1000
  sessionTimeoutMs: number; // Default: 300000 (5 minutes)
}

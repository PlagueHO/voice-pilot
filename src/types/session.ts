import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';
import { AuthenticationError, EphemeralKeyInfo } from './ephemeral';

// Session Manager Interface
export interface SessionManager extends ServiceInitializable {
  // Primary session operations
  startSession(config?: SessionConfig): Promise<SessionInfo>;
  endSession(sessionId?: string): Promise<void>;
  renewSession(sessionId: string): Promise<RenewalResult>;

  // Session state queries
  getSessionInfo(sessionId: string): SessionInfo | undefined;
  getCurrentSession(): SessionInfo | undefined;
  getAllSessions(): SessionInfo[];
  isSessionActive(sessionId?: string): boolean;

  // Session configuration
  updateSessionConfig(sessionId: string, config: Partial<SessionConfig>): Promise<void>;
  getSessionConfig(sessionId: string): SessionConfig | undefined;

  // Event handling
  onSessionStarted(handler: SessionEventHandler): vscode.Disposable;
  onSessionEnded(handler: SessionEventHandler): vscode.Disposable;
  onSessionRenewed(handler: SessionRenewalHandler): vscode.Disposable;
  onSessionError(handler: SessionErrorHandler): vscode.Disposable;
  onSessionStateChanged(handler: SessionStateHandler): vscode.Disposable;

  // Diagnostic operations
  getSessionDiagnostics(sessionId: string): SessionDiagnostics;
  testSessionHealth(sessionId: string): Promise<SessionHealthResult>;

  // Activity management
  resetInactivityTimer(sessionId: string): Promise<void>;
}

// Core Session Types
export interface SessionInfo {
  sessionId: string;
  state: SessionState;
  startedAt: Date;
  lastActivity: Date;
  expiresAt?: Date;
  config: SessionConfig;
  statistics: SessionStatistics;
  connectionInfo: ConnectionInfo;
}

export interface SessionConfig {
  renewalMarginSeconds: number; // Default: 10
  inactivityTimeoutMinutes: number; // Default: 5
  heartbeatIntervalSeconds: number; // Default: 30
  maxRetryAttempts: number; // Default: 3
  retryBackoffMs: number; // Default: 1000
  enableHeartbeat: boolean; // Default: true
  enableInactivityTimeout: boolean; // Default: true
}

export interface SessionStatistics {
  renewalCount: number;
  failedRenewalCount: number;
  heartbeatCount: number;
  inactivityResets: number;
  totalDurationMs: number;
  averageRenewalLatencyMs: number;
}

export interface ConnectionInfo {
  webrtcState: 'disconnected' | 'connecting' | 'connected' | 'failed';
  lastConnectedAt?: Date;
  reconnectAttempts: number;
  ephemeralKeyInfo?: EphemeralKeyInfo;
}

export interface RenewalResult {
  success: boolean;
  sessionId: string;
  newExpiresAt?: Date;
  latencyMs: number;
  error?: SessionError;
}

export interface SessionDiagnostics {
  sessionId: string;
  state: SessionState;
  timerStatus: SessionTimerStatus;
  credentialStatus: 'valid' | 'expired' | 'missing' | 'invalid';
  connectionStatus: 'healthy' | 'degraded' | 'failed';
  lastError?: SessionError;
  uptime: number;
  nextScheduledEvent?: TimerEventInfo;
}

export interface SessionHealthResult {
  isHealthy: boolean;
  checks: HealthCheck[];
  latencyMs: number;
  recommendations: string[];
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
}

export enum SessionState {
  Idle = 'idle',
  Starting = 'starting',
  Active = 'active',
  Renewing = 'renewing',
  Paused = 'paused',
  Ending = 'ending',
  Failed = 'failed'
}

export interface SessionError {
  code: string;
  message: string;
  isRetryable: boolean;
  remediation: string;
  timestamp: Date;
  context?: any;
}

// Event Handler Interfaces
export interface SessionEventHandler {
  (event: SessionEvent): Promise<void>;
}

export interface SessionRenewalHandler {
  (event: SessionRenewalEvent): Promise<void>;
}

export interface SessionErrorHandler {
  (event: SessionErrorEvent): Promise<void>;
}

export interface SessionStateHandler {
  (event: SessionStateEvent): Promise<void>;
}

// Event Types
export interface SessionEvent {
  type: 'started' | 'ended';
  sessionId: string;
  timestamp: Date;
  sessionInfo: SessionInfo;
}

export interface SessionRenewalEvent {
  type: 'renewal-started' | 'renewal-completed' | 'renewal-failed';
  sessionId: string;
  timestamp: Date;
  result?: RenewalResult;
  error?: SessionError;
  diagnostics?: SessionDiagnostics;
}

export interface SessionErrorEvent {
  type: 'authentication-error' | 'connection-error' | 'timeout-error' | 'renewal-error';
  sessionId: string;
  timestamp: Date;
  error: SessionError;
  retryAttempt?: number;
}

export interface SessionStateEvent {
  type: 'state-changed';
  sessionId: string;
  timestamp: Date;
  previousState: SessionState;
  newState: SessionState;
  reason: string;
  diagnostics?: SessionDiagnostics;
}

// Timer Integration Interfaces
export interface TimerEventInfo {
  type: 'renewal' | 'timeout' | 'heartbeat';
  sessionId: string;
  scheduledAt: Date;
  timeRemainingMs: number;
}

// Re-exported from SessionTimerManager for integration
export interface SessionTimerStatus {
  sessionId: string;
  renewalTimer?: TimerEventStatus;
  timeoutTimer?: TimerEventStatus;
  heartbeatTimer?: TimerEventStatus & { intervalMs: number };
}

export interface TimerEventStatus {
  isActive: boolean;
  scheduledAt: Date;
  timeRemainingMs: number;
  intervalMs?: number;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
}

// Service Dependencies Integration
export interface EphemeralKeyIntegration {
  keyService: any; // EphemeralKeyService - avoiding circular dependency
  onKeyRenewed: (result: any) => Promise<void>; // EphemeralKeyResult
  onKeyExpired: (info: EphemeralKeyInfo) => Promise<void>;
  onAuthenticationError: (error: AuthenticationError) => Promise<void>;
}

// Integration with WebRTC Audio Transport (SP-006 dependency)
export interface WebRTCIntegration {
  onConnectionStateChanged: (state: RTCPeerConnectionState) => Promise<void>;
  onAudioActivityDetected: () => Promise<void>;
  onConnectionError: (error: Error) => Promise<void>;
}

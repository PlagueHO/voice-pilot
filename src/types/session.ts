import * as vscode from "vscode";
import { ServiceInitializable } from "../core/service-initializable";
import type { ConversationStorageService } from "./conversation-storage";
import { AuthenticationError, EphemeralKeyInfo } from "./ephemeral";

/**
 * Contract implemented by services that manage realtime Copilot sessions.
 */
export interface SessionManager extends ServiceInitializable {
  /** Initializes a new session using the optional configuration override. */
  startSession(config?: SessionConfig): Promise<SessionInfo>;
  /** Gracefully terminates the specified session or the active session. */
  endSession(sessionId?: string): Promise<void>;
  /** Renews credentials and timers for the given session. */
  renewSession(sessionId: string): Promise<RenewalResult>;

  /** Retrieves metadata describing the requested session. */
  getSessionInfo(sessionId: string): SessionInfo | undefined;
  /** Returns the session currently in focus, if any. */
  getCurrentSession(): SessionInfo | undefined;
  /** Lists all sessions known to the manager. */
  getAllSessions(): SessionInfo[];
  /** Indicates whether the specified or active session is running. */
  isSessionActive(sessionId?: string): boolean;

  /** Applies configuration overrides to an existing session. */
  updateSessionConfig(
    sessionId: string,
    config: Partial<SessionConfig>,
  ): Promise<void>;
  /** Fetches the effective configuration for the given session. */
  getSessionConfig(sessionId: string): SessionConfig | undefined;

  /** Registers a handler that fires when sessions start. */
  onSessionStarted(handler: SessionEventHandler): vscode.Disposable;
  /** Registers a handler that fires when sessions end. */
  onSessionEnded(handler: SessionEventHandler): vscode.Disposable;
  /** Registers a handler that fires when session renewals complete. */
  onSessionRenewed(handler: SessionRenewalHandler): vscode.Disposable;
  /** Registers a handler for surfaced session errors. */
  onSessionError(handler: SessionErrorHandler): vscode.Disposable;
  /** Registers a handler for session state transitions. */
  onSessionStateChanged(handler: SessionStateHandler): vscode.Disposable;

  /** Injects the conversation storage dependency for transcript persistence. */
  setConversationStorage(storage: ConversationStorageService): void;

  /** Provides a snapshot of diagnostics for the targeted session. */
  getSessionDiagnostics(sessionId: string): SessionDiagnostics;
  /** Executes health checks and returns aggregated results. */
  testSessionHealth(sessionId: string): Promise<SessionHealthResult>;

  /** Resets inactivity timers associated with the specified session. */
  resetInactivityTimer(sessionId: string): Promise<void>;
}

/**
 * Metadata describing the state and configuration of an active session.
 */
export interface SessionInfo {
  sessionId: string;
  state: SessionState;
  startedAt: Date;
  lastActivity: Date;
  expiresAt?: Date;
  config: SessionConfig;
  statistics: SessionStatistics;
  connectionInfo: ConnectionInfo;
  conversationId?: string;
}

/**
 * Configuration knobs that govern session renewals and heartbeats.
 */
export interface SessionConfig {
  renewalMarginSeconds: number; // Default: 10
  inactivityTimeoutMinutes: number; // Default: 5
  heartbeatIntervalSeconds: number; // Default: 30
  maxRetryAttempts: number; // Default: 3
  retryBackoffMs: number; // Default: 1000
  enableHeartbeat: boolean; // Default: true
  enableInactivityTimeout: boolean; // Default: true
}

/**
 * Statistical counters accumulated over the lifetime of a session.
 */
export interface SessionStatistics {
  renewalCount: number;
  failedRenewalCount: number;
  heartbeatCount: number;
  inactivityResets: number;
  totalDurationMs: number;
  averageRenewalLatencyMs: number;
}

/**
 * Connection-level status and metadata for the current session transport.
 */
export interface ConnectionInfo {
  webrtcState: "disconnected" | "connecting" | "connected" | "failed";
  lastConnectedAt?: Date;
  reconnectAttempts: number;
  ephemeralKeyInfo?: EphemeralKeyInfo;
}

/**
 * Outcome returned after attempting to renew an existing session.
 */
export interface RenewalResult {
  success: boolean;
  sessionId: string;
  newExpiresAt?: Date;
  latencyMs: number;
  error?: SessionError;
}

/**
 * Diagnostic snapshot used to troubleshoot session lifecycle issues.
 */
export interface SessionDiagnostics {
  sessionId: string;
  state: SessionState;
  timerStatus: SessionTimerStatus;
  credentialStatus: "valid" | "expired" | "missing" | "invalid";
  connectionStatus: "healthy" | "degraded" | "failed";
  lastError?: SessionError;
  uptime: number;
  nextScheduledEvent?: TimerEventInfo;
}

/**
 * Result returned by the health probe that validates session viability.
 */
export interface SessionHealthResult {
  isHealthy: boolean;
  checks: HealthCheck[];
  latencyMs: number;
  recommendations: string[];
}

/**
 * Individual check result included in health probe output.
 */
export interface HealthCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  details?: any;
}

/**
 * Enumeration describing high-level session lifecycle states.
 */
export enum SessionState {
  Idle = "idle",
  Starting = "starting",
  Active = "active",
  Renewing = "renewing",
  Paused = "paused",
  Ending = "ending",
  Failed = "failed",
}

/**
 * Error payload surfaced when session operations fail.
 */
export interface SessionError {
  code: string;
  message: string;
  isRetryable: boolean;
  remediation: string;
  timestamp: Date;
  context?: any;
}

/** Handler invoked when sessions start or end. */
export interface SessionEventHandler {
  (event: SessionEvent): Promise<void>;
}

/** Handler invoked when session renewal events occur. */
export interface SessionRenewalHandler {
  (event: SessionRenewalEvent): Promise<void>;
}

/** Handler invoked when session errors surface. */
export interface SessionErrorHandler {
  (event: SessionErrorEvent): Promise<void>;
}

/** Handler invoked when session state transitions occur. */
export interface SessionStateHandler {
  (event: SessionStateEvent): Promise<void>;
}

/** Event emitted when sessions start or end. */
export interface SessionEvent {
  type: "started" | "ended";
  sessionId: string;
  timestamp: Date;
  sessionInfo: SessionInfo;
}

/** Event describing the lifecycle of session renewal operations. */
export interface SessionRenewalEvent {
  type: "renewal-started" | "renewal-completed" | "renewal-failed";
  sessionId: string;
  timestamp: Date;
  result?: RenewalResult;
  error?: SessionError;
  diagnostics?: SessionDiagnostics;
}

/** Event describing errors that occur during session management. */
export interface SessionErrorEvent {
  type:
    | "authentication-error"
    | "connection-error"
    | "timeout-error"
    | "renewal-error";
  sessionId: string;
  timestamp: Date;
  error: SessionError;
  retryAttempt?: number;
}

/** Event emitted when a session transitions between lifecycle states. */
export interface SessionStateEvent {
  type: "state-changed";
  sessionId: string;
  timestamp: Date;
  previousState: SessionState;
  newState: SessionState;
  reason: string;
  diagnostics?: SessionDiagnostics;
}

/** Metadata describing timers that drive session lifecycle activities. */
export interface TimerEventInfo {
  type: "renewal" | "timeout" | "heartbeat";
  sessionId: string;
  scheduledAt: Date;
  timeRemainingMs: number;
}

/** Aggregated view of timers orchestrated by the session timer manager. */
export interface SessionTimerStatus {
  sessionId: string;
  renewalTimer?: TimerEventStatus;
  timeoutTimer?: TimerEventStatus;
  heartbeatTimer?: TimerEventStatus & { intervalMs: number };
}

/** Detailed information for a single timer tracking session actions. */
export interface TimerEventStatus {
  isActive: boolean;
  scheduledAt: Date;
  timeRemainingMs: number;
  intervalMs?: number;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
}

/** Dependency contract for integrating the session layer with ephemeral keys. */
export interface EphemeralKeyIntegration {
  keyService: any; // EphemeralKeyService - avoiding circular dependency
  onKeyRenewed: (result: any) => Promise<void>; // EphemeralKeyResult
  onKeyExpired: (info: EphemeralKeyInfo) => Promise<void>;
  onAuthenticationError: (error: AuthenticationError) => Promise<void>;
}

/** Integration points for the WebRTC transport layer used by sessions. */
export interface WebRTCIntegration {
  onConnectionStateChanged: (state: RTCPeerConnectionState) => Promise<void>;
  onAudioActivityDetected: () => Promise<void>;
  onConnectionError: (error: Error) => Promise<void>;
}

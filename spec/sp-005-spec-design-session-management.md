---
title: Session Management & Renewal
version: 1.0
date_created: 2025-09-21
last_updated: 2025-09-21
owner: VoicePilot Project
tags: [design, session, lifecycle, timer, renewal]
---

## Introduction

This specification defines the session management and renewal system for VoicePilot voice interactions, including session lifecycle coordination, automatic renewal mechanisms, and timer-based state management. The session manager acts as the central coordinator between ephemeral key services, WebRTC connections, and UI components to ensure uninterrupted voice conversations through automated credential renewal and connection management.

## 1. Purpose & Scope

This specification defines the session management requirements for VoicePilot's voice interaction system, covering:

- Voice session lifecycle management and state coordination
- Integration with ephemeral key service for automatic credential renewal
- Timer-based session management for renewal, timeout, and heartbeat operations
- Session state persistence and recovery mechanisms
- Error handling and graceful degradation for session failures
- Coordination between extension host and webview contexts during sessions

**Intended Audience**: Extension developers, session architects, and voice interaction specialists.

**Assumptions**:

- EphemeralKeyService is initialized and functional (SP-004 dependency)
- VS Code Extension Context with lifecycle management (SP-001 dependency)
- Understanding of voice session requirements and WebRTC connection patterns
- Knowledge of timer-based renewal patterns and state management
- Familiarity with Azure OpenAI Realtime API session constraints

## 2. Definitions

- **Voice Session**: Active voice interaction period with established WebRTC connection and valid credentials
- **Session Renewal**: Process of refreshing ephemeral credentials before expiration during active sessions
- **Session Timer**: Automated timer mechanism for renewal, timeout, and heartbeat operations
- **Session State**: Current status of voice session including connection, authentication, and activity states
- **Session Coordinator**: Central component managing session lifecycle and dependencies
- **Heartbeat Check**: Periodic verification of session health and connection status
- **Inactivity Timeout**: Automatic session termination after period of voice inactivity
- **Graceful Termination**: Proper cleanup of session resources and connections
- **Session Recovery**: Mechanism to restore session state after temporary failures

## 3. Requirements, Constraints & Guidelines

### Session Lifecycle Requirements

- **REQ-001**: Session manager SHALL coordinate with EphemeralKeyService for credential management
- **REQ-002**: Sessions SHALL automatically renew credentials 10 seconds before expiration
- **REQ-003**: Session manager SHALL support concurrent session handling for multiple voice contexts
- **REQ-004**: Session state SHALL be maintained consistently across component interactions
- **REQ-005**: Session manager SHALL provide event notifications for state transitions
- **REQ-006**: Session termination SHALL trigger proper cleanup of all associated resources

### Timer Management Requirements

- **TIM-001**: Session manager SHALL use SessionTimerManager for all time-based operations
- **TIM-002**: Renewal timers SHALL be automatically scheduled upon session creation
- **TIM-003**: Inactivity timers SHALL reset upon voice activity detection
- **TIM-004**: Heartbeat timers SHALL verify session health at configurable intervals
- **TIM-005**: Timer operations SHALL support pause/resume for debugging and testing

### Integration Requirements

- **INT-001**: Session manager SHALL implement ServiceInitializable interface for lifecycle consistency
- **INT-002**: Session manager SHALL coordinate with WebRTC clients for connection state
- **INT-003**: Session manager SHALL notify UI components of session state changes
- **INT-004**: Session manager SHALL handle configuration updates without session interruption

### Error Handling Requirements

- **ERR-001**: Failed renewals SHALL trigger exponential backoff retry mechanism
- **ERR-002**: Network failures SHALL not immediately terminate sessions if recoverable
- **ERR-003**: Authentication errors SHALL provide clear remediation guidance
- **ERR-004**: Session errors SHALL be logged with sufficient context for troubleshooting

### Performance Requirements

- **PERF-001**: Session startup SHALL complete within 3 seconds under normal conditions
- **PERF-002**: Session renewal SHALL not interrupt active voice interactions
- **PERF-003**: Session state queries SHALL respond within 100ms
- **PERF-004**: Session cleanup SHALL complete within 2 seconds

### Security Requirements

- **SEC-001**: Session credentials SHALL never be exposed outside extension host context
- **SEC-002**: Session state SHALL not persist sensitive authentication information
- **SEC-003**: Session termination SHALL immediately invalidate all associated credentials
- **SEC-004**: Session events SHALL not leak sensitive information in logging

### Configuration Constraints

- **CON-001**: Default renewal margin SHALL be 10 seconds before key expiration
- **CON-002**: Default inactivity timeout SHALL be 5 minutes
- **CON-003**: Default heartbeat interval SHALL be 30 seconds
- **CON-004**: Maximum concurrent sessions SHALL be limited to prevent resource exhaustion

### Implementation Guidelines

- **GUD-001**: Use dependency injection for service coordination and testing
- **GUD-002**: Implement state machine pattern for clear session state transitions
- **GUD-003**: Provide comprehensive event system for session lifecycle notifications
- **GUD-004**: Support diagnostic operations for session troubleshooting

### Design Patterns

- **PAT-001**: Use Observer pattern for session state change notifications
- **PAT-002**: Implement Coordinator pattern for multi-service session management
- **PAT-003**: Use Timer abstraction for testable time-based operations
- **PAT-004**: Provide async/await interfaces for all session operations

## 4. Interfaces & Data Contracts

### Session Manager Interface

```typescript
import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';
import { EphemeralKeyInfo, AuthenticationError } from '../types/ephemeral';

interface SessionManager extends ServiceInitializable {
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
}

interface SessionInfo {
  sessionId: string;
  state: SessionState;
  startedAt: Date;
  lastActivity: Date;
  expiresAt?: Date;
  config: SessionConfig;
  statistics: SessionStatistics;
  connectionInfo: ConnectionInfo;
}

interface SessionConfig {
  renewalMarginSeconds: number; // Default: 10
  inactivityTimeoutMinutes: number; // Default: 5
  heartbeatIntervalSeconds: number; // Default: 30
  maxRetryAttempts: number; // Default: 3
  retryBackoffMs: number; // Default: 1000
  enableHeartbeat: boolean; // Default: true
  enableInactivityTimeout: boolean; // Default: true
}

interface SessionStatistics {
  renewalCount: number;
  failedRenewalCount: number;
  heartbeatCount: number;
  inactivityResets: number;
  totalDurationMs: number;
  averageRenewalLatencyMs: number;
}

interface ConnectionInfo {
  webrtcState: 'disconnected' | 'connecting' | 'connected' | 'failed';
  lastConnectedAt?: Date;
  reconnectAttempts: number;
  ephemeralKeyInfo?: EphemeralKeyInfo;
}

interface RenewalResult {
  success: boolean;
  sessionId: string;
  newExpiresAt?: Date;
  latencyMs: number;
  error?: SessionError;
}

interface SessionDiagnostics {
  sessionId: string;
  state: SessionState;
  timerStatus: SessionTimerStatus;
  credentialStatus: 'valid' | 'expired' | 'missing' | 'invalid';
  connectionStatus: 'healthy' | 'degraded' | 'failed';
  lastError?: SessionError;
  uptime: number;
  nextScheduledEvent?: TimerEventInfo;
}

interface SessionHealthResult {
  isHealthy: boolean;
  checks: HealthCheck[];
  latencyMs: number;
  recommendations: string[];
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: any;
}

enum SessionState {
  Idle = 'idle',
  Starting = 'starting',
  Active = 'active',
  Renewing = 'renewing',
  Paused = 'paused',
  Ending = 'ending',
  Failed = 'failed'
}

interface SessionError {
  code: string;
  message: string;
  isRetryable: boolean;
  remediation: string;
  timestamp: Date;
  context?: any;
}
```

### Event Handler Interfaces

```typescript
interface SessionEventHandler {
  (event: SessionEvent): Promise<void>;
}

interface SessionRenewalHandler {
  (event: SessionRenewalEvent): Promise<void>;
}

interface SessionErrorHandler {
  (event: SessionErrorEvent): Promise<void>;
}

interface SessionStateHandler {
  (event: SessionStateEvent): Promise<void>;
}

interface SessionEvent {
  type: 'started' | 'ended';
  sessionId: string;
  timestamp: Date;
  sessionInfo: SessionInfo;
}

interface SessionRenewalEvent {
  type: 'renewal-started' | 'renewal-completed' | 'renewal-failed';
  sessionId: string;
  timestamp: Date;
  result?: RenewalResult;
  error?: SessionError;
}

interface SessionErrorEvent {
  type: 'authentication-error' | 'connection-error' | 'timeout-error' | 'renewal-error';
  sessionId: string;
  timestamp: Date;
  error: SessionError;
  retryAttempt?: number;
}

interface SessionStateEvent {
  type: 'state-changed';
  sessionId: string;
  timestamp: Date;
  previousState: SessionState;
  newState: SessionState;
  reason: string;
}
```

### Timer Integration Interfaces

```typescript
interface TimerEventInfo {
  type: 'renewal' | 'timeout' | 'heartbeat';
  sessionId: string;
  scheduledAt: Date;
  timeRemainingMs: number;
}

// Re-exported from SessionTimerManager for integration
interface SessionTimerStatus {
  sessionId: string;
  renewalTimer?: TimerEventStatus;
  timeoutTimer?: TimerEventStatus;
  heartbeatTimer?: TimerEventStatus & { intervalMs: number };
}

interface TimerEventStatus {
  isActive: boolean;
  scheduledAt: Date;
  timeRemainingMs: number;
  intervalMs?: number;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
}
```

### Service Dependencies Integration

```typescript
// Integration with EphemeralKeyService (SP-004)
interface EphemeralKeyIntegration {
  keyService: EphemeralKeyService;
  onKeyRenewed: (result: EphemeralKeyResult) => Promise<void>;
  onKeyExpired: (info: EphemeralKeyInfo) => Promise<void>;
  onAuthenticationError: (error: AuthenticationError) => Promise<void>;
}

// Integration with WebRTC Audio Transport (SP-006 dependency)
interface WebRTCIntegration {
  onConnectionStateChanged: (state: RTCPeerConnectionState) => Promise<void>;
  onAudioActivityDetected: () => Promise<void>;
  onConnectionError: (error: Error) => Promise<void>;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given valid configuration, When startSession() is called, Then session starts within 3 seconds and enters Active state
- **AC-002**: Given active session nearing expiration, When 10 seconds remain, Then automatic renewal occurs without interruption
- **AC-003**: Given session renewal failure, When retries are exhausted, Then session enters Failed state with clear error message
- **AC-004**: Given active session with no voice activity, When inactivity timeout expires, Then session ends gracefully
- **AC-005**: Given session manager disposal, When dispose() is called, Then all active sessions end and timers are cleared
- **AC-006**: Given session state change, When state transitions occur, Then appropriate event handlers are notified
- **AC-007**: Given session health check, When testSessionHealth() is called, Then comprehensive diagnostics are returned within 100ms
- **AC-008**: Given configuration update, When updateSessionConfig() is called, Then timers adjust without session interruption
- **AC-009**: Given multiple concurrent sessions, When sessions operate independently, Then each session maintains separate state and timers
- **AC-010**: Given session pause/resume, When pauseSession() and resumeSession() are called, Then timer state is preserved accurately

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for session logic, Integration tests with timer and key services, End-to-End tests with complete voice workflows
- **Frameworks**: VS Code Extension Test Runner, Mocha with timer mocking, Test doubles for service dependencies
- **Test Data Management**: Mock session configurations, controlled timer scenarios, simulated network conditions
- **CI/CD Integration**: Automated session lifecycle testing in GitHub Actions with deterministic timing
- **Coverage Requirements**: 95% coverage for session state machine logic, 100% coverage for error handling paths
- **Performance Testing**: Session startup latency measurement, renewal timing validation, concurrent session stress testing
- **Timer Testing**: Fake timer implementation for deterministic test execution, pause/resume state verification
- **Integration Testing**: Real Azure ephemeral key integration in isolated test environment

## 7. Rationale & Context

The session management design addresses critical requirements for uninterrupted voice interactions:

1. **Automatic Renewal**: Prevents voice session interruptions due to credential expiration by proactively renewing keys with safety margins.

2. **State Coordination**: Centralizes session state management to ensure consistent behavior across WebRTC, UI, and authentication components.

3. **Timer Abstraction**: Uses dedicated timer management for testable, reliable time-based operations with pause/resume capabilities.

4. **Error Recovery**: Implements robust retry mechanisms and graceful degradation to handle network and authentication failures.

5. **Performance Optimization**: Minimizes renewal latency and provides non-blocking session operations to maintain voice interaction quality.

6. **Diagnostic Support**: Comprehensive health checking and diagnostics enable effective troubleshooting of session issues.

The coordinator pattern ensures proper sequencing of session operations while maintaining loose coupling between components.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Extension Context - Required for service initialization and lifecycle management
- **PLT-002**: VS Code Event System - Required for session event notifications and state change handling

### Extension Internal Dependencies

- **INT-001**: EphemeralKeyService (SP-004) - Required for credential management and automatic renewal
- **INT-002**: SessionTimerManager - Required for renewal, timeout, and heartbeat timer operations
- **INT-003**: ConfigurationManager (SP-002) - Required for session configuration management
- **INT-004**: Logger - Required for session event logging and diagnostic information
- **INT-005**: ServiceInitializable Pattern (SP-001) - Required for consistent lifecycle management

### Future Integration Dependencies

- **FUT-001**: WebRTC Audio Transport (SP-006) - Will be required for connection state coordination
- **FUT-002**: Voice Control Panel UI (SP-013) - Will be required for session status display
- **FUT-003**: Audio Pipeline Service (SP-007) - Will be required for voice activity detection

### Azure Service Dependencies

- **AZR-001**: Azure OpenAI Realtime API - Required for session validity and connection establishment
- **AZR-002**: WebRTC Peer Connection - Required for voice transport and connection state monitoring

### Performance Dependencies

- **PERF-001**: Timer Resolution - Required for accurate timing operations with millisecond precision
- **PERF-002**: Memory Management - Required for efficient session state storage and cleanup
- **PERF-003**: Event Loop - Required for non-blocking session operations and timer callbacks

### Testing Dependencies

- **TEST-001**: Timer Mocking - Required for deterministic testing of time-based operations
- **TEST-002**: Service Mocking - Required for isolated testing of session logic
- **TEST-003**: VS Code Test Environment - Required for integration testing with extension context

## 9. Examples & Edge Cases

### Basic Session Lifecycle

```typescript
class SessionManagerImpl implements SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private timerManager!: SessionTimerManager;
  private keyService!: EphemeralKeyService;
  private configManager!: ConfigurationManager;
  private logger!: Logger;
  private eventHandlers = new Map<string, Set<Function>>();

  async initialize(): Promise<void> {
    this.logger.info('Initializing SessionManager');

    // Validate dependencies
    if (!this.keyService.isInitialized()) {
      throw new Error('EphemeralKeyService must be initialized before SessionManager');
    }

    // Initialize timer manager with callbacks
    this.timerManager = new SessionTimerManager(
      this.logger,
      this.handleRenewalRequired.bind(this),
      this.handleTimeoutExpired.bind(this),
      this.handleHeartbeatCheck.bind(this)
    );

    // Setup key service event handlers
    this.keyService.onKeyRenewed(this.handleKeyRenewed.bind(this));
    this.keyService.onKeyExpired(this.handleKeyExpired.bind(this));
    this.keyService.onAuthenticationError(this.handleAuthError.bind(this));

    this.initialized = true;
    this.logger.info('SessionManager initialized successfully');
  }

  async startSession(config: SessionConfig = this.getDefaultConfig()): Promise<SessionInfo> {
    this.ensureInitialized();

    const sessionId = this.generateSessionId();
    const sessionInfo: SessionInfo = {
      sessionId,
      state: SessionState.Starting,
      startedAt: new Date(),
      lastActivity: new Date(),
      config,
      statistics: this.createEmptyStatistics(),
      connectionInfo: {
        webrtcState: 'disconnected',
        reconnectAttempts: 0
      }
    };

    this.sessions.set(sessionId, sessionInfo);
    this.emitSessionEvent('started', sessionInfo);

    try {
      // Request initial ephemeral key
      const keyResult = await this.keyService.requestEphemeralKey();
      if (!keyResult.success) {
        throw new Error(`Failed to obtain session credentials: ${keyResult.error?.message}`);
      }

      // Update session with credential information
      sessionInfo.expiresAt = keyResult.expiresAt;
      sessionInfo.connectionInfo.ephemeralKeyInfo = this.keyService.getCurrentKey();
      sessionInfo.state = SessionState.Active;

      // Schedule automatic renewal
      this.scheduleRenewal(sessionId, keyResult.expiresAt!);

      // Start inactivity timer if enabled
      if (config.enableInactivityTimeout) {
        this.timerManager.startTimeoutTimer(sessionId, config.inactivityTimeoutMinutes * 60 * 1000);
      }

      // Start heartbeat timer if enabled
      if (config.enableHeartbeat) {
        this.timerManager.startHeartbeatTimer(sessionId, config.heartbeatIntervalSeconds * 1000);
      }

      this.logger.info('Session started successfully', {
        sessionId,
        expiresAt: keyResult.expiresAt?.toISOString()
      });

      return sessionInfo;

    } catch (error: any) {
      sessionInfo.state = SessionState.Failed;
      this.logger.error('Failed to start session', { sessionId, error: error.message });
      this.emitSessionError('authentication-error', sessionId, {
        code: 'SESSION_START_FAILED',
        message: error.message,
        isRetryable: true,
        remediation: 'Check Azure credentials and network connectivity',
        timestamp: new Date()
      });
      throw error;
    }
  }

  private scheduleRenewal(sessionId: string, expiresAt: Date): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const renewalTime = expiresAt.getTime() - (session.config.renewalMarginSeconds * 1000);
    this.timerManager.startRenewalTimer(sessionId, renewalTime);
  }

  private async handleRenewalRequired(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SessionState.Active) {
      return;
    }

    session.state = SessionState.Renewing;
    this.emitSessionStateChange(sessionId, SessionState.Active, SessionState.Renewing, 'Automatic renewal triggered');

    const renewalStart = Date.now();

    try {
      const renewalResult = await this.keyService.renewKey();
      const latencyMs = Date.now() - renewalStart;

      if (renewalResult.success) {
        session.expiresAt = renewalResult.expiresAt;
        session.connectionInfo.ephemeralKeyInfo = this.keyService.getCurrentKey();
        session.statistics.renewalCount++;
        session.statistics.averageRenewalLatencyMs =
          (session.statistics.averageRenewalLatencyMs * (session.statistics.renewalCount - 1) + latencyMs) /
          session.statistics.renewalCount;
        session.state = SessionState.Active;

        // Schedule next renewal
        this.scheduleRenewal(sessionId, renewalResult.expiresAt!);

        this.emitSessionRenewal('renewal-completed', sessionId, {
          success: true,
          sessionId,
          newExpiresAt: renewalResult.expiresAt,
          latencyMs
        });

        this.logger.info('Session renewed successfully', {
          sessionId,
          latencyMs,
          newExpiresAt: renewalResult.expiresAt?.toISOString()
        });

      } else {
        session.statistics.failedRenewalCount++;
        session.state = SessionState.Failed;

        this.emitSessionRenewal('renewal-failed', sessionId, {
          success: false,
          sessionId,
          latencyMs,
          error: {
            code: 'RENEWAL_FAILED',
            message: renewalResult.error?.message || 'Unknown renewal error',
            isRetryable: renewalResult.error?.isRetryable || false,
            remediation: renewalResult.error?.remediation || 'Check Azure service status',
            timestamp: new Date()
          }
        });

        this.logger.error('Session renewal failed', {
          sessionId,
          error: renewalResult.error?.message
        });
      }

    } catch (error: any) {
      session.statistics.failedRenewalCount++;
      session.state = SessionState.Failed;
      const latencyMs = Date.now() - renewalStart;

      this.emitSessionError('renewal-error', sessionId, {
        code: 'RENEWAL_EXCEPTION',
        message: error.message,
        isRetryable: true,
        remediation: 'Check network connectivity and retry',
        timestamp: new Date()
      });

      this.logger.error('Session renewal exception', { sessionId, error: error.message });
    }
  }
}
```

### Error Handling and Recovery

```typescript
private async handleTimeoutExpired(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  this.logger.info('Session inactivity timeout expired', { sessionId });

  this.emitSessionError('timeout-error', sessionId, {
    code: 'INACTIVITY_TIMEOUT',
    message: `Session ${sessionId} terminated due to ${session.config.inactivityTimeoutMinutes} minutes of inactivity`,
    isRetryable: false,
    remediation: 'Start a new session when ready to continue',
    timestamp: new Date()
  });

  await this.endSession(sessionId);
}

private async handleHeartbeatCheck(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  session.statistics.heartbeatCount++;

  try {
    // Perform health check
    const healthResult = await this.testSessionHealth(sessionId);

    if (!healthResult.isHealthy) {
      this.logger.warn('Session health check failed', {
        sessionId,
        checks: healthResult.checks.filter(c => c.status !== 'pass')
      });

      // Consider session degraded but don't terminate automatically
      session.connectionInfo.webrtcState = 'failed';
    }

  } catch (error: any) {
    this.logger.error('Heartbeat check failed', { sessionId, error: error.message });
  }
}

public async testSessionHealth(sessionId: string): Promise<SessionHealthResult> {
  const session = this.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const startTime = Date.now();
  const checks: HealthCheck[] = [];

  // Check credential validity
  const keyInfo = this.keyService.getCurrentKey();
  checks.push({
    name: 'credential-validity',
    status: keyInfo && keyInfo.isValid ? 'pass' : 'fail',
    message: keyInfo?.isValid ? 'Credentials are valid' : 'Credentials are expired or invalid'
  });

  // Check timer status
  const timerStatus = this.timerManager.getTimerStatus(sessionId);
  checks.push({
    name: 'timer-health',
    status: timerStatus.renewalTimer?.isActive ? 'pass' : 'warn',
    message: timerStatus.renewalTimer?.isActive ? 'Renewal timer is active' : 'Renewal timer is not active'
  });

  // Check session age
  const ageMinutes = (Date.now() - session.startedAt.getTime()) / (1000 * 60);
  checks.push({
    name: 'session-age',
    status: ageMinutes < 60 ? 'pass' : 'warn',
    message: `Session age: ${ageMinutes.toFixed(1)} minutes`
  });

  const latencyMs = Date.now() - startTime;
  const failedChecks = checks.filter(c => c.status === 'fail');

  return {
    isHealthy: failedChecks.length === 0,
    checks,
    latencyMs,
    recommendations: this.generateHealthRecommendations(checks)
  };
}

private generateHealthRecommendations(checks: HealthCheck[]): string[] {
  const recommendations: string[] = [];

  const credentialCheck = checks.find(c => c.name === 'credential-validity');
  if (credentialCheck?.status === 'fail') {
    recommendations.push('Renew session credentials through manual renewal');
  }

  const timerCheck = checks.find(c => c.name === 'timer-health');
  if (timerCheck?.status === 'warn') {
    recommendations.push('Restart session to reestablish proper timer scheduling');
  }

  const ageCheck = checks.find(c => c.name === 'session-age');
  if (ageCheck?.status === 'warn') {
    recommendations.push('Consider ending long-running session and starting fresh');
  }

  return recommendations;
}
```

### Edge Case: Session Disposal During Active Operations

```typescript
dispose(): void {
  this.logger.info('Disposing SessionManager');

  // End all active sessions gracefully
  const activeSessions = Array.from(this.sessions.values()).filter(s =>
    s.state === SessionState.Active || s.state === SessionState.Renewing
  );

  for (const session of activeSessions) {
    try {
      this.endSessionSync(session.sessionId);
    } catch (error: any) {
      this.logger.warn('Failed to end session during disposal', {
        sessionId: session.sessionId,
        error: error.message
      });
    }
  }

  // Clear timer manager
  if (this.timerManager) {
    this.timerManager.dispose();
  }

  // Clear all session state
  this.sessions.clear();
  this.eventHandlers.clear();

  this.initialized = false;
  this.logger.info('SessionManager disposed');
}

private endSessionSync(sessionId: string): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  session.state = SessionState.Ending;

  // Clear all timers for this session
  this.timerManager.clearAllTimers(sessionId);

  // Calculate final statistics
  session.statistics.totalDurationMs = Date.now() - session.startedAt.getTime();

  // Remove from active sessions
  this.sessions.delete(sessionId);

  this.logger.info('Session ended synchronously', {
    sessionId,
    duration: session.statistics.totalDurationMs,
    renewals: session.statistics.renewalCount
  });
}
```

### Concurrent Session Management

```typescript
public async startSession(config: SessionConfig = this.getDefaultConfig()): Promise<SessionInfo> {
  // Check concurrent session limits
  const activeSessions = Array.from(this.sessions.values()).filter(s =>
    s.state === SessionState.Active || s.state === SessionState.Starting
  );

  if (activeSessions.length >= this.getMaxConcurrentSessions()) {
    throw new Error(`Maximum concurrent sessions (${this.getMaxConcurrentSessions()}) exceeded`);
  }

  // Continue with normal session startup...
  return await this.startSessionInternal(config);
}

public getAllSessions(): SessionInfo[] {
  return Array.from(this.sessions.values());
}

public getCurrentSession(): SessionInfo | undefined {
  // Return most recently active session
  const activeSessions = Array.from(this.sessions.values())
    .filter(s => s.state === SessionState.Active)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  return activeSessions[0];
}

private getMaxConcurrentSessions(): number {
  return this.configManager.getSessionConfig()?.maxConcurrentSessions || 3;
}

public async resetInactivityTimer(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  session.lastActivity = new Date();
  session.statistics.inactivityResets++;

  // Reset the inactivity timer
  this.timerManager.resetInactivityTimer(sessionId);

  this.logger.debug('Session inactivity timer reset', { sessionId });
}
```

## 10. Validation Criteria

- Session manager initializes successfully with all required service dependencies
- Sessions start within 3-second timeout and enter Active state with valid credentials
- Automatic renewal occurs 10 seconds before credential expiration without interruption
- Failed renewals trigger appropriate retry mechanisms with exponential backoff
- Inactivity timeout properly terminates sessions after configured period
- Session disposal cleans up all active sessions, timers, and resources
- Event handlers are notified for all session state transitions
- Health checks provide comprehensive diagnostics within 100ms response time
- Configuration updates apply to active sessions without interruption
- Concurrent sessions maintain independent state and timer management

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-002: Configuration & Settings Management](sp-002-spec-design-configuration-management.md)
- [SP-004: Ephemeral Key Service (Azure Realtime)](sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md) (Future dependency)
- [SP-007: Microphone Capture & Audio Pipeline](sp-007-spec-design-audio-capture-pipeline.md) (Future dependency)
- [SP-013: UI Sidebar Panel & Layout](sp-013-spec-design-ui-sidebar-panel.md) (Future dependency)
- [VS Code Extension Lifecycle Documentation](https://code.visualstudio.com/api/get-started/extension-anatomy)
- [Azure OpenAI Realtime API Session Management](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio)

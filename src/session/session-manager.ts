import * as vscode from 'vscode';
import { EphemeralKeyServiceImpl } from '../auth/ephemeral-key-service';
import { ConfigurationManager } from '../config/configuration-manager';
import { Logger } from '../core/logger';
import { EphemeralKeyInfo, EphemeralKeyResult } from '../types/ephemeral';
import {
    HealthCheck,
    RenewalResult,
    SessionConfig,
    SessionDiagnostics,
    SessionError,
    SessionErrorEvent,
    SessionErrorHandler,
    SessionEvent,
    SessionEventHandler,
    SessionHealthResult,
    SessionInfo,
    SessionManager,
    SessionRenewalEvent,
    SessionRenewalHandler,
    SessionState,
    SessionStateEvent,
    SessionStateHandler,
    SessionStatistics
} from '../types/session';
import { SessionTimerManagerImpl } from './session-timer-manager';

/**
 * Comprehensive session management implementation for VoicePilot voice interactions.
 * Handles session lifecycle, automatic credential renewal, timer-based operations,
 * and event notifications according to SP-005 Session Management & Renewal specification.
 */
export class SessionManagerImpl implements SessionManager {
  private initialized = false;
  private sessions = new Map<string, SessionInfo>();
  private timerManager!: SessionTimerManagerImpl;
  private keyService!: EphemeralKeyServiceImpl;
  private configManager!: ConfigurationManager;
  private logger!: Logger;
  private eventHandlers = new Map<string, Set<Function>>();

  constructor(
    keyService?: EphemeralKeyServiceImpl,
    timerManager?: SessionTimerManagerImpl,
    configManager?: ConfigurationManager,
    logger?: Logger
  ) {
    if (keyService) { this.keyService = keyService; }
    if (timerManager) { this.timerManager = timerManager; }
    if (configManager) { this.configManager = configManager; }
    if (logger) { this.logger = logger; }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger = this.logger || new Logger('SessionManager');
    this.logger.info('Initializing SessionManager');

    // Validate dependencies
    if (!this.keyService || !this.keyService.isInitialized()) {
      throw new Error('EphemeralKeyService must be initialized before SessionManager');
    }

    if (!this.configManager || !this.configManager.isInitialized()) {
      throw new Error('ConfigurationManager must be initialized before SessionManager');
    }

    // Initialize timer manager with callbacks
    if (!this.timerManager) {
      this.timerManager = new SessionTimerManagerImpl(
        this.logger,
        this.handleRenewalRequired.bind(this),
        this.handleTimeoutExpired.bind(this),
        this.handleHeartbeatCheck.bind(this)
      );
    }

    // Setup key service event handlers
    this.keyService.onKeyRenewed(this.handleKeyRenewed.bind(this));
    this.keyService.onKeyExpired(this.handleKeyExpired.bind(this));
    this.keyService.onAuthenticationError(this.handleAuthError.bind(this));

    this.initialized = true;
    this.logger.info('SessionManager initialized successfully');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

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

  // Primary session operations
  async startSession(config: SessionConfig = this.getDefaultConfig()): Promise<SessionInfo> {
    this.ensureInitialized();

    // Check concurrent session limits
    const activeSessions = Array.from(this.sessions.values()).filter(s =>
      s.state === SessionState.Active || s.state === SessionState.Starting
    );

    if (activeSessions.length >= this.getMaxConcurrentSessions()) {
      throw new Error(`Maximum concurrent sessions (${this.getMaxConcurrentSessions()}) exceeded`);
    }

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

  async endSession(sessionId?: string): Promise<void> {
    const targetSessionId = sessionId || this.getCurrentSession()?.sessionId;
    if (!targetSessionId) {
      return;
    }

    const session = this.sessions.get(targetSessionId);
    if (!session) {
      return;
    }

    session.state = SessionState.Ending;

    try {
      // Clear all timers for this session
      this.timerManager.clearAllTimers(targetSessionId);

      // End session with key service if needed
      if (session.connectionInfo.ephemeralKeyInfo?.sessionId) {
        await this.keyService.endSession(session.connectionInfo.ephemeralKeyInfo.sessionId);
      }

      // Calculate final statistics
      session.statistics.totalDurationMs = Date.now() - session.startedAt.getTime();

      // Remove from active sessions
      this.sessions.delete(targetSessionId);

      this.emitSessionEvent('ended', session);

      this.logger.info('Session ended successfully', {
        sessionId: targetSessionId,
        duration: session.statistics.totalDurationMs,
        renewals: session.statistics.renewalCount
      });

    } catch (error: any) {
      this.logger.error('Error ending session', {
        sessionId: targetSessionId,
        error: error.message
      });
      throw error;
    }
  }

  async renewSession(sessionId: string): Promise<RenewalResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sessionId,
        latencyMs: 0,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `Session ${sessionId} not found`,
          isRetryable: false,
          remediation: 'Start a new session',
          timestamp: new Date()
        }
      };
    }

    const startTime = Date.now();
    session.state = SessionState.Renewing;
    this.emitSessionStateChange(sessionId, SessionState.Active, SessionState.Renewing, 'Manual renewal requested');

    try {
      const renewalResult = await this.keyService.renewKey();
      const latencyMs = Date.now() - startTime;

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

        return {
          success: true,
          sessionId,
          newExpiresAt: renewalResult.expiresAt,
          latencyMs
        };
      } else {
        session.statistics.failedRenewalCount++;
        session.state = SessionState.Failed;

        return {
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
        };
      }
    } catch (error: any) {
      session.statistics.failedRenewalCount++;
      session.state = SessionState.Failed;
      const latencyMs = Date.now() - startTime;

      return {
        success: false,
        sessionId,
        latencyMs,
        error: {
          code: 'RENEWAL_EXCEPTION',
          message: error.message,
          isRetryable: true,
          remediation: 'Check network connectivity and retry',
          timestamp: new Date()
        }
      };
    }
  }

  // Session state queries
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getCurrentSession(): SessionInfo | undefined {
    // Return most recently active session
    const activeSessions = Array.from(this.sessions.values())
      .filter(s => s.state === SessionState.Active)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return activeSessions[0];
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  isSessionActive(sessionId?: string): boolean {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      return session?.state === SessionState.Active;
    }
    return this.getCurrentSession()?.state === SessionState.Active || false;
  }

  // Session configuration
  async updateSessionConfig(sessionId: string, config: Partial<SessionConfig>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const oldConfig = { ...session.config };
    session.config = { ...session.config, ...config };

    // Update timers if intervals changed
    if (config.inactivityTimeoutMinutes && config.inactivityTimeoutMinutes !== oldConfig.inactivityTimeoutMinutes) {
      if (session.config.enableInactivityTimeout) {
        this.timerManager.startTimeoutTimer(sessionId, config.inactivityTimeoutMinutes * 60 * 1000);
      }
    }

    if (config.heartbeatIntervalSeconds && config.heartbeatIntervalSeconds !== oldConfig.heartbeatIntervalSeconds) {
      if (session.config.enableHeartbeat) {
        this.timerManager.startHeartbeatTimer(sessionId, config.heartbeatIntervalSeconds * 1000);
      }
    }

    this.logger.info('Session configuration updated', { sessionId, config });
  }

  getSessionConfig(sessionId: string): SessionConfig | undefined {
    return this.sessions.get(sessionId)?.config;
  }

  // Event handling
  onSessionStarted(handler: SessionEventHandler): vscode.Disposable {
    return this.addEventHandler('session-started', handler);
  }

  onSessionEnded(handler: SessionEventHandler): vscode.Disposable {
    return this.addEventHandler('session-ended', handler);
  }

  onSessionRenewed(handler: SessionRenewalHandler): vscode.Disposable {
    return this.addEventHandler('session-renewed', handler);
  }

  onSessionError(handler: SessionErrorHandler): vscode.Disposable {
    return this.addEventHandler('session-error', handler);
  }

  onSessionStateChanged(handler: SessionStateHandler): vscode.Disposable {
    return this.addEventHandler('session-state-changed', handler);
  }

  // Diagnostic operations
  getSessionDiagnostics(sessionId: string): SessionDiagnostics {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const timerStatus = this.timerManager.getTimerStatus(sessionId);
    const keyInfo = this.keyService.getCurrentKey();
    const nextEvent = this.timerManager.getNextScheduledEvent(sessionId);

    let credentialStatus: 'valid' | 'expired' | 'missing' | 'invalid' = 'missing';
    if (keyInfo) {
      credentialStatus = keyInfo.isValid ? 'valid' : 'expired';
    }

    let connectionStatus: 'healthy' | 'degraded' | 'failed' = 'healthy';
    if (session.connectionInfo.webrtcState === 'failed') {
      connectionStatus = 'failed';
    } else if (session.connectionInfo.webrtcState === 'connecting' || session.statistics.failedRenewalCount > 0) {
      connectionStatus = 'degraded';
    }

    return {
      sessionId,
      state: session.state,
      timerStatus,
      credentialStatus,
      connectionStatus,
      uptime: Date.now() - session.startedAt.getTime(),
      nextScheduledEvent: nextEvent ? {
        type: nextEvent.type,
        sessionId: nextEvent.sessionId,
        scheduledAt: nextEvent.scheduledAt,
        timeRemainingMs: nextEvent.timeRemainingMs
      } : undefined
    };
  }

  async testSessionHealth(sessionId: string): Promise<SessionHealthResult> {
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

  async resetInactivityTimer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

    session.lastActivity = new Date();
    session.statistics.inactivityResets++;

    // Reset the inactivity timer
    this.timerManager.resetInactivityTimer(sessionId);

    this.logger.debug('Session inactivity timer reset', { sessionId });
  }

  // Private implementation methods
  private scheduleRenewal(sessionId: string, expiresAt: Date): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

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

  private async handleTimeoutExpired(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }

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
    if (!session) { return; }

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

  private async handleKeyRenewed(result: EphemeralKeyResult): Promise<void> {
    this.logger.debug('Key renewed event received', { success: result.success });
    // Key renewals are handled by session renewal logic
  }

  private async handleKeyExpired(info: EphemeralKeyInfo): Promise<void> {
    this.logger.warn('Key expired event received', { sessionId: info.sessionId });
    // Find sessions using this key and mark them as failed
    for (const [sessionId, session] of this.sessions) {
      if (session.connectionInfo.ephemeralKeyInfo?.sessionId === info.sessionId) {
        session.state = SessionState.Failed;
        this.emitSessionError('authentication-error', sessionId, {
          code: 'KEY_EXPIRED',
          message: 'Session credentials expired',
          isRetryable: true,
          remediation: 'Session will attempt automatic renewal',
          timestamp: new Date()
        });
      }
    }
  }

  private async handleAuthError(error: any): Promise<void> {
    this.logger.error('Authentication error received', { error });
    // Mark all active sessions as failed
    for (const [sessionId, session] of this.sessions) {
      if (session.state === SessionState.Active) {
        session.state = SessionState.Failed;
        this.emitSessionError('authentication-error', sessionId, {
          code: 'AUTH_ERROR',
          message: error.message || 'Authentication error',
          isRetryable: error.isRetryable || false,
          remediation: error.remediation || 'Check Azure credentials',
          timestamp: new Date()
        });
      }
    }
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultConfig(): SessionConfig {
    return {
      renewalMarginSeconds: 10,
      inactivityTimeoutMinutes: 5,
      heartbeatIntervalSeconds: 30,
      maxRetryAttempts: 3,
      retryBackoffMs: 1000,
      enableHeartbeat: true,
      enableInactivityTimeout: true
    };
  }

  private getMaxConcurrentSessions(): number {
    // TODO: Get from configuration
    return 3;
  }

  private createEmptyStatistics(): SessionStatistics {
    return {
      renewalCount: 0,
      failedRenewalCount: 0,
      heartbeatCount: 0,
      inactivityResets: 0,
      totalDurationMs: 0,
      averageRenewalLatencyMs: 0
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

  private endSessionSync(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {return;}

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

  private addEventHandler(eventType: string, handler: Function): vscode.Disposable {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    return {
      dispose: () => {
        this.eventHandlers.get(eventType)?.delete(handler);
      }
    };
  }

  private emitSessionEvent(type: 'started' | 'ended', sessionInfo: SessionInfo): void {
    const handlers = this.eventHandlers.get(`session-${type}`);
    if (!handlers) { return; }

    const event: SessionEvent = {
      type,
      sessionId: sessionInfo.sessionId,
      timestamp: new Date(),
      sessionInfo
    };

    for (const handler of handlers) {
      try {
        (handler as SessionEventHandler)(event);
      } catch (error: any) {
        this.logger.error(`Session ${type} event handler failed`, { error: error.message });
      }
    }
  }

  private emitSessionRenewal(type: 'renewal-started' | 'renewal-completed' | 'renewal-failed', sessionId: string, result?: RenewalResult, error?: SessionError): void {
    const handlers = this.eventHandlers.get('session-renewed');
    if (!handlers) { return; }

    const event: SessionRenewalEvent = {
      type,
      sessionId,
      timestamp: new Date(),
      result,
      error
    };

    for (const handler of handlers) {
      try {
        (handler as SessionRenewalHandler)(event);
      } catch (err: any) {
        this.logger.error('Session renewal event handler failed', { error: err.message });
      }
    }
  }

  private emitSessionError(type: 'authentication-error' | 'connection-error' | 'timeout-error' | 'renewal-error', sessionId: string, error: SessionError, retryAttempt?: number): void {
    const handlers = this.eventHandlers.get('session-error');
    if (!handlers) { return; }

    const event: SessionErrorEvent = {
      type,
      sessionId,
      timestamp: new Date(),
      error,
      retryAttempt
    };

    for (const handler of handlers) {
      try {
        (handler as SessionErrorHandler)(event);
      } catch (err: any) {
        this.logger.error('Session error event handler failed', { error: err.message });
      }
    }
  }

  private emitSessionStateChange(sessionId: string, previousState: SessionState, newState: SessionState, reason: string): void {
    const handlers = this.eventHandlers.get('session-state-changed');
    if (!handlers) { return; }

    const event: SessionStateEvent = {
      type: 'state-changed',
      sessionId,
      timestamp: new Date(),
      previousState,
      newState,
      reason
    };

    for (const handler of handlers) {
      try {
        (handler as SessionStateHandler)(event);
      } catch (error: any) {
        this.logger.error('Session state change event handler failed', { error: error.message });
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SessionManager not initialized. Call initialize() first.');
    }
  }
}

// Backwards-compatible implementation name expected by existing tests
export { SessionManagerImpl as SessionManager };


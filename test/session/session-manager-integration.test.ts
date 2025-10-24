import * as assert from 'assert';
import { SessionManagerImpl } from '../../src/session/session-manager';
import { EphemeralKeyInfo, EphemeralKeyResult } from '../../src/types/ephemeral';
import {
    SessionConfig,
    SessionErrorEvent,
    SessionEvent,
    SessionInfo,
    SessionRenewalEvent,
    SessionState
} from '../../src/types/session';

describe('SessionManagerImpl - Comprehensive Tests', () => {
  let sessionManager: SessionManagerImpl;
  let mockKeyService: any;
  let mockTimerManager: any;
  let mockConfigManager: any;
  let mockLogger: any;

  // Mock implementations
  const createMockKeyService = () => ({
    isInitialized: () => true,
    requestEphemeralKey: async (): Promise<EphemeralKeyResult> => ({
      success: true,
      ephemeralKey: 'mock-key',
      sessionId: 'mock-session-id',
      expiresAt: new Date(Date.now() + 300000) // 5 minutes
    }),
    getCurrentKey: (): EphemeralKeyInfo => {
      const issuedAt = new Date();
      const expiresAt = new Date(Date.now() + 300000);
      const refreshAt = new Date(Date.now() + 45000);
      return {
        key: 'mock-key',
        sessionId: 'mock-session-id',
        issuedAt,
        expiresAt,
        isValid: true,
        secondsRemaining: 300,
        refreshAt,
        secondsUntilRefresh: 45,
        ttlSeconds: 300,
        refreshIntervalSeconds: 45
      };
    },
    renewKey: async (): Promise<EphemeralKeyResult> => ({
      success: true,
      ephemeralKey: 'renewed-key',
      sessionId: 'mock-session-id',
      expiresAt: new Date(Date.now() + 300000)
    }),
    endSession: async (sessionId: string): Promise<void> => {},
    onKeyRenewed: (handler: any) => ({ dispose: () => {} }),
    onKeyExpired: (handler: any) => ({ dispose: () => {} }),
    onAuthenticationError: (handler: any) => ({ dispose: () => {} })
  });

  const createMockTimerManager = () => ({
    startRenewalTimer: (sessionId: string, renewAtMs: number) => {},
    startTimeoutTimer: (sessionId: string, timeoutMs: number) => {},
    startHeartbeatTimer: (sessionId: string, intervalMs: number) => {},
    clearAllTimers: (sessionId: string) => {},
    resetInactivityTimer: (sessionId: string) => {},
    getTimerStatus: (sessionId: string) => ({
      sessionId,
      renewalTimer: {
        isActive: true,
        scheduledAt: new Date(),
        timeRemainingMs: 300000
      }
    }),
    getNextScheduledEvent: (sessionId: string) => ({
      type: 'renewal',
      sessionId,
      scheduledAt: new Date(),
      timeRemainingMs: 300000
    }),
    dispose: () => {}
  });

  const createMockConfigManager = () => ({
    isInitialized: () => true
  });

  const createMockLogger = () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  });

  beforeEach(() => {
    mockKeyService = createMockKeyService();
    mockTimerManager = createMockTimerManager();
    mockConfigManager = createMockConfigManager();
    mockLogger = createMockLogger();

    sessionManager = new SessionManagerImpl(
      mockKeyService,
      mockTimerManager,
      mockConfigManager,
      mockLogger
    );
  });

  describe('Initialization and Lifecycle', () => {
    it('should initialize successfully with all dependencies', async () => {
      await sessionManager.initialize();
      assert.ok(sessionManager.isInitialized());
    });

    it('should be idempotent on multiple initialization calls', async () => {
      await sessionManager.initialize();
      await sessionManager.initialize(); // Should not throw
      assert.ok(sessionManager.isInitialized());
    });

    it('should throw if key service is not initialized', async () => {
      mockKeyService.isInitialized = () => false;
      await assert.rejects(
        sessionManager.initialize(),
        /EphemeralKeyService must be initialized/
      );
    });

    it('should throw if config manager is not initialized', async () => {
      mockConfigManager.isInitialized = () => false;
      await assert.rejects(
        sessionManager.initialize(),
        /ConfigurationManager must be initialized/
      );
    });

    it('should dispose cleanly and end all active sessions', async () => {
      await sessionManager.initialize();
      const sessionInfo = await sessionManager.startSession();
      assert.strictEqual(sessionInfo.state, SessionState.Active);

      sessionManager.dispose();
      assert.strictEqual(sessionManager.isInitialized(), false);
    });
  });

  describe('Session Lifecycle Operations', () => {
    beforeEach(async () => {
      await sessionManager.initialize();
    });

    it('should start a session successfully', async () => {
      const sessionInfo = await sessionManager.startSession();

      assert.ok(sessionInfo.sessionId);
      assert.strictEqual(sessionInfo.state, SessionState.Active);
      assert.ok(sessionInfo.startedAt);
      assert.ok(sessionInfo.lastActivity);
      assert.ok(sessionInfo.expiresAt);
      assert.deepStrictEqual(sessionInfo.config, {
        renewalMarginSeconds: 10,
        inactivityTimeoutMinutes: 5,
        heartbeatIntervalSeconds: 30,
        maxRetryAttempts: 3,
        retryBackoffMs: 1000,
        enableHeartbeat: true,
        enableInactivityTimeout: true
      });
    });

    it('should start a session with custom configuration', async () => {
      const customConfig: SessionConfig = {
        renewalMarginSeconds: 20,
        inactivityTimeoutMinutes: 10,
        heartbeatIntervalSeconds: 60,
        maxRetryAttempts: 5,
        retryBackoffMs: 2000,
        enableHeartbeat: false,
        enableInactivityTimeout: false
      };

      const sessionInfo = await sessionManager.startSession(customConfig);
      assert.deepStrictEqual(sessionInfo.config, customConfig);
    });

    it('should enforce concurrent session limits', async () => {
      // Start maximum allowed sessions (3)
      await sessionManager.startSession();
      await sessionManager.startSession();
      await sessionManager.startSession();

      // Fourth session should be rejected
      await assert.rejects(
        sessionManager.startSession(),
        /Maximum concurrent sessions.*exceeded/
      );
    });

    it('should end a session successfully', async () => {
      const sessionInfo = await sessionManager.startSession();
      await sessionManager.endSession(sessionInfo.sessionId);

      const retrievedSession = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(retrievedSession, undefined);
    });

    it('should end current session when no sessionId provided', async () => {
      const sessionInfo = await sessionManager.startSession();
      await sessionManager.endSession(); // No sessionId

      const retrievedSession = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(retrievedSession, undefined);
    });

    it('should handle session end gracefully when session not found', async () => {
      await sessionManager.endSession('non-existent-session');
      // Should not throw
    });

    it('should throw error on session start if key service fails', async () => {
      mockKeyService.requestEphemeralKey = async () => ({
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Cannot connect to Azure',
          isRetryable: true,
          remediation: 'Check network connectivity'
        }
      });

      await assert.rejects(
        sessionManager.startSession(),
        /Failed to obtain session credentials/
      );
    });
  });

  describe('Session State Management', () => {
    let sessionInfo: SessionInfo;

    beforeEach(async () => {
      await sessionManager.initialize();
      sessionInfo = await sessionManager.startSession();
    });

    it('should retrieve session info correctly', () => {
      const retrieved = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.sessionId, sessionInfo.sessionId);
      assert.strictEqual(retrieved.state, SessionState.Active);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = sessionManager.getSessionInfo('non-existent');
      assert.strictEqual(retrieved, undefined);
    });

    it('should return current session', () => {
      const current = sessionManager.getCurrentSession();
      assert.ok(current);
      assert.strictEqual(current.sessionId, sessionInfo.sessionId);
    });

    it('should return most recent session as current', async () => {
      const secondSession = await sessionManager.startSession();

      // Update last activity of first session to be earlier
      sessionInfo.lastActivity = new Date(Date.now() - 10000);

      const current = sessionManager.getCurrentSession();
      assert.strictEqual(current?.sessionId, secondSession.sessionId);
    });

    it('should return all sessions', async () => {
      const secondSession = await sessionManager.startSession();
      const allSessions = sessionManager.getAllSessions();

      assert.strictEqual(allSessions.length, 2);
      assert.ok(allSessions.some(s => s.sessionId === sessionInfo.sessionId));
      assert.ok(allSessions.some(s => s.sessionId === secondSession.sessionId));
    });

    it('should check session active status correctly', () => {
      assert.ok(sessionManager.isSessionActive(sessionInfo.sessionId));
      assert.ok(sessionManager.isSessionActive()); // Current session
    });

    it('should update session configuration', async () => {
      const newConfig: Partial<SessionConfig> = {
        inactivityTimeoutMinutes: 15,
        heartbeatIntervalSeconds: 45
      };

      await sessionManager.updateSessionConfig(sessionInfo.sessionId, newConfig);

      const updated = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(updated?.config.inactivityTimeoutMinutes, 15);
      assert.strictEqual(updated?.config.heartbeatIntervalSeconds, 45);
      // Other config values should remain unchanged
      assert.strictEqual(updated?.config.renewalMarginSeconds, 10);
    });

    it('should throw error when updating config for non-existent session', async () => {
      await assert.rejects(
        sessionManager.updateSessionConfig('non-existent', {}),
        /Session.*not found/
      );
    });

    it('should get session configuration', () => {
      const config = sessionManager.getSessionConfig(sessionInfo.sessionId);
      assert.ok(config);
      assert.strictEqual(config.renewalMarginSeconds, 10);
    });

    it('should return undefined for non-existent session config', () => {
      const config = sessionManager.getSessionConfig('non-existent');
      assert.strictEqual(config, undefined);
    });
  });

  describe('Session Renewal', () => {
    let sessionInfo: SessionInfo;

    beforeEach(async () => {
      await sessionManager.initialize();
      sessionInfo = await sessionManager.startSession();
    });

    it('should renew session successfully', async () => {
      const result = await sessionManager.renewSession(sessionInfo.sessionId);

      assert.ok(result.success);
      assert.strictEqual(result.sessionId, sessionInfo.sessionId);
      assert.ok(result.newExpiresAt);
      assert.ok(result.latencyMs >= 0);

      // Check session statistics updated
      const updated = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(updated?.statistics.renewalCount, 1);
    });

    it('should handle renewal failure', async () => {
      mockKeyService.renewKey = async () => ({
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Network timeout',
          isRetryable: true,
          remediation: 'Check connectivity'
        }
      });

      const result = await sessionManager.renewSession(sessionInfo.sessionId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.strictEqual(result.error.code, 'RENEWAL_FAILED');

      // Check session marked as failed
      const updated = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(updated?.state, SessionState.Failed);
      assert.strictEqual(updated?.statistics.failedRenewalCount, 1);
    });

    it('should handle renewal exception', async () => {
      mockKeyService.renewKey = async () => {
        throw new Error('Network error');
      };

      const result = await sessionManager.renewSession(sessionInfo.sessionId);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.strictEqual(result.error.code, 'RENEWAL_EXCEPTION');
    });

    it('should return error for non-existent session renewal', async () => {
      const result = await sessionManager.renewSession('non-existent');

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'SESSION_NOT_FOUND');
    });
  });

  describe('Event System', () => {
    let sessionInfo: SessionInfo;
    let eventCaptured: any = null;

    beforeEach(async () => {
      await sessionManager.initialize();
      eventCaptured = null;
    });

    it('should emit session started event', async () => {
      const disposable = sessionManager.onSessionStarted(async (event: SessionEvent) => {
        eventCaptured = event;
      });

      sessionInfo = await sessionManager.startSession();

      assert.ok(eventCaptured);
      assert.strictEqual(eventCaptured.type, 'started');
      assert.strictEqual(eventCaptured.sessionId, sessionInfo.sessionId);
      assert.ok(eventCaptured.timestamp);
      assert.ok(eventCaptured.sessionInfo);

      disposable.dispose();
    });

    it('should emit session ended event', async () => {
      sessionInfo = await sessionManager.startSession();

      const disposable = sessionManager.onSessionEnded(async (event: SessionEvent) => {
        eventCaptured = event;
      });

      await sessionManager.endSession(sessionInfo.sessionId);

      assert.ok(eventCaptured);
      assert.strictEqual(eventCaptured.type, 'ended');
      assert.strictEqual(eventCaptured.sessionId, sessionInfo.sessionId);

      disposable.dispose();
    });

    it('should emit session renewal events', async () => {
      sessionInfo = await sessionManager.startSession();
      let renewalEvents: SessionRenewalEvent[] = [];

      const disposable = sessionManager.onSessionRenewed(async (event: SessionRenewalEvent) => {
        renewalEvents.push(event);
      });

      await sessionManager.renewSession(sessionInfo.sessionId);

      assert.ok(renewalEvents.length > 0);
      const completedEvent = renewalEvents.find(e => e.type === 'renewal-completed');
      assert.ok(completedEvent);
      assert.strictEqual(completedEvent.sessionId, sessionInfo.sessionId);
      assert.ok(completedEvent.result?.success);

      disposable.dispose();
    });

    it('should emit session error events', async () => {
      sessionInfo = await sessionManager.startSession();

      const disposable = sessionManager.onSessionError(async (event: SessionErrorEvent) => {
        eventCaptured = event;
      });

      // Trigger error through failed renewal
      mockKeyService.renewKey = async () => ({
        success: false,
        error: { code: 'TEST_ERROR', message: 'Test error', isRetryable: false, remediation: 'Test' }
      });

      await sessionManager.renewSession(sessionInfo.sessionId);

      assert.ok(eventCaptured);
      assert.strictEqual(eventCaptured.type, 'renewal-error');
      assert.strictEqual(eventCaptured.sessionId, sessionInfo.sessionId);

      disposable.dispose();
    });

    it('should dispose event handlers correctly', async () => {
      let eventCount = 0;
      const disposable = sessionManager.onSessionStarted(async () => {
        eventCount++;
      });

      await sessionManager.startSession();
      assert.strictEqual(eventCount, 1);

      disposable.dispose();
      await sessionManager.startSession();
      assert.strictEqual(eventCount, 1); // Should not increment
    });
  });

  describe('Diagnostics and Health Monitoring', () => {
    let sessionInfo: SessionInfo;

    beforeEach(async () => {
      await sessionManager.initialize();
      sessionInfo = await sessionManager.startSession();
    });

    it('should provide session diagnostics', () => {
      const diagnostics = sessionManager.getSessionDiagnostics(sessionInfo.sessionId);

      assert.strictEqual(diagnostics.sessionId, sessionInfo.sessionId);
      assert.strictEqual(diagnostics.state, SessionState.Active);
      assert.ok(diagnostics.timerStatus);
      assert.strictEqual(diagnostics.credentialStatus, 'valid');
      assert.strictEqual(diagnostics.connectionStatus, 'healthy');
      assert.ok(diagnostics.uptime >= 0);
      assert.ok(diagnostics.nextScheduledEvent);
    });

    it('should throw error for non-existent session diagnostics', () => {
      assert.throws(
        () => sessionManager.getSessionDiagnostics('non-existent'),
        /Session.*not found/
      );
    });

    it('should test session health successfully', async () => {
      const healthResult = await sessionManager.testSessionHealth(sessionInfo.sessionId);

      assert.ok(healthResult.isHealthy);
      assert.ok(Array.isArray(healthResult.checks));
      assert.ok(healthResult.checks.length > 0);
      assert.ok(healthResult.latencyMs >= 0);
      assert.ok(Array.isArray(healthResult.recommendations));

      // Check specific health checks
      const credentialCheck = healthResult.checks.find(c => c.name === 'credential-validity');
      assert.ok(credentialCheck);
      assert.strictEqual(credentialCheck.status, 'pass');
    });

    it('should detect unhealthy session', async () => {
      // Mock expired credentials
      mockKeyService.getCurrentKey = () => ({
        key: 'expired-key',
        sessionId: 'mock-session-id',
        issuedAt: new Date(Date.now() - 400000),
        expiresAt: new Date(Date.now() - 100000), // Expired
        isValid: false,
        secondsRemaining: 0,
        refreshAt: new Date(Date.now() - 200000),
        secondsUntilRefresh: 0,
        ttlSeconds: 300,
        refreshIntervalSeconds: 45
      });

      const healthResult = await sessionManager.testSessionHealth(sessionInfo.sessionId);

      assert.strictEqual(healthResult.isHealthy, false);
      const credentialCheck = healthResult.checks.find(c => c.name === 'credential-validity');
      assert.strictEqual(credentialCheck?.status, 'fail');
      assert.ok(healthResult.recommendations.length > 0);
    });

    it('should throw error for non-existent session health check', async () => {
      await assert.rejects(
        sessionManager.testSessionHealth('non-existent'),
        /Session.*not found/
      );
    });

    it('should reset inactivity timer', async () => {
      const oldActivity = sessionInfo.lastActivity;

      // Wait a small amount to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await sessionManager.resetInactivityTimer(sessionInfo.sessionId);

      const updated = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.ok(updated && updated.lastActivity > oldActivity);
      assert.strictEqual(updated?.statistics.inactivityResets, 1);
    });

    it('should handle inactivity timer reset for non-existent session', async () => {
      await sessionManager.resetInactivityTimer('non-existent');
      // Should not throw
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(async () => {
      await sessionManager.initialize();
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new SessionManagerImpl();

      await assert.rejects(
        uninitializedManager.startSession(),
        /SessionManager not initialized/
      );
    });

    it('should handle timer callback errors gracefully', async () => {
      let errorLogged = false;
      mockLogger.error = () => { errorLogged = true; };

      // Mock a failing key service
      mockKeyService.renewKey = async () => {
        throw new Error('Simulated renewal failure');
      };

      const sessionInfo = await sessionManager.startSession();

      // Manually trigger renewal callback
      await (sessionManager as any).handleRenewalRequired(sessionInfo.sessionId);

      assert.ok(errorLogged);

      const updated = sessionManager.getSessionInfo(sessionInfo.sessionId);
      assert.strictEqual(updated?.state, SessionState.Failed);
    });

    it('should handle session cleanup during disposal', async () => {
      void await sessionManager.startSession();
      void await sessionManager.startSession();

      assert.strictEqual(sessionManager.getAllSessions().length, 2);

      sessionManager.dispose();

      // Sessions should be cleaned up
      assert.strictEqual(sessionManager.isInitialized(), false);
    });
  });
});

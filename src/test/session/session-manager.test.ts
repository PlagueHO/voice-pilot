import * as assert from 'assert';
import { Logger } from '../../core/logger';
import { SessionManagerImpl } from '../../session/session-manager';

describe('SessionManagerImpl - Backward Compatibility', () => {
  let manager: SessionManagerImpl;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = new Logger('TestSessionManager');
    manager = new SessionManagerImpl(undefined, undefined, undefined, mockLogger);
  });

  it('initializes once and is idempotent', async () => {
    // Mock dependencies for initialization
    (manager as any).keyService = {
      isInitialized: () => true,
      onKeyRenewed: () => ({ dispose: () => {} }),
      onKeyExpired: () => ({ dispose: () => {} }),
      onAuthenticationError: () => ({ dispose: () => {} })
    };
    (manager as any).configManager = {
      isInitialized: () => true
    };

    await manager.initialize();
    assert.ok(manager.isInitialized());
    await manager.initialize(); // second call should not throw
  });

  it('starts and ends a session', async () => {
    // Mock all required dependencies
    (manager as any).keyService = {
      isInitialized: () => true,
      requestEphemeralKey: async () => ({
        success: true,
        ephemeralKey: 'test-key',
        sessionId: 'test-session',
        expiresAt: new Date(Date.now() + 300000)
      }),
      getCurrentKey: () => ({
        key: 'test-key',
        sessionId: 'test-session',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        isValid: true,
        secondsRemaining: 300,
        refreshAt: new Date(Date.now() + 45000),
        secondsUntilRefresh: 45,
        ttlSeconds: 300,
        refreshIntervalSeconds: 45
      }),
      endSession: async () => {},
      onKeyRenewed: () => ({ dispose: () => {} }),
      onKeyExpired: () => ({ dispose: () => {} }),
      onAuthenticationError: () => ({ dispose: () => {} })
    };

    (manager as any).configManager = {
      isInitialized: () => true
    };

    await manager.initialize();
    const sessionInfo = await manager.startSession();
    assert.ok(manager.isSessionActive());
    assert.ok(sessionInfo.sessionId);

    await manager.endSession();
    assert.strictEqual(manager.isSessionActive(), false);
  });

  it('throws if starting before initialization', async () => {
    await assert.rejects(manager.startSession(), /not initialized/);
  });

  it('disposes cleanly', async () => {
    // Mock dependencies
    (manager as any).keyService = {
      isInitialized: () => true,
      requestEphemeralKey: async () => ({
        success: true,
        ephemeralKey: 'test-key',
        sessionId: 'test-session',
        expiresAt: new Date(Date.now() + 300000)
      }),
      getCurrentKey: () => ({
        key: 'test-key',
        sessionId: 'test-session',
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        isValid: true,
        secondsRemaining: 300,
        refreshAt: new Date(Date.now() + 45000),
        secondsUntilRefresh: 45,
        ttlSeconds: 300,
        refreshIntervalSeconds: 45
      }),
      endSession: async () => {},
      onKeyRenewed: () => ({ dispose: () => {} }),
      onKeyExpired: () => ({ dispose: () => {} }),
      onAuthenticationError: () => ({ dispose: () => {} })
    };

    (manager as any).configManager = {
      isInitialized: () => true
    };

    await manager.initialize();
    await manager.startSession();
    manager.dispose();
    assert.strictEqual(manager.isSessionActive(), false);
    assert.strictEqual(manager.isInitialized(), false);
  });
});

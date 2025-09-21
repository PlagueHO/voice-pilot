import * as assert from 'assert';
import { SessionManagerImpl } from '../../session/session-manager';

describe('SessionManagerImpl', () => {
  let manager: SessionManagerImpl;

  beforeEach(() => {
    manager = new SessionManagerImpl();
  });

  it('initializes once and is idempotent', async () => {
    await manager.initialize();
    assert.ok(manager.isInitialized());
    await manager.initialize(); // second call should not throw
  });

  it('starts and ends a session', async () => {
    await manager.initialize();
    await manager.startSession();
    assert.ok(manager.isSessionActive());
    await manager.endSession();
    assert.strictEqual(manager.isSessionActive(), false);
  });

  it('throws if starting before initialization', async () => {
    await assert.rejects(manager.startSession(), /not initialized/);
  });

  it('disposes cleanly', async () => {
    await manager.initialize();
    await manager.startSession();
    manager.dispose();
    assert.strictEqual(manager.isSessionActive(), false);
  });
});

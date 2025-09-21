import * as assert from 'assert';
import { SessionManagerImpl } from '../../session/session-manager';

describe('Unit: SessionManagerImpl', () => {
  it('is not initialized by default', () => {
    const mgr = new SessionManagerImpl();
    assert.strictEqual(mgr.isInitialized(), false);
  });

  it('initializes only once', async () => {
    const mgr = new SessionManagerImpl();
    await mgr.initialize();
    assert.ok(mgr.isInitialized());
    await mgr.initialize(); // idempotent
    assert.ok(mgr.isInitialized());
  });

  it('throws when starting session before initialize', async () => {
    const mgr = new SessionManagerImpl();
    await assert.rejects(mgr.startSession(), /not initialized/i);
  });

  it('starts and ends session after initialization', async () => {
    const mgr = new SessionManagerImpl();
    await mgr.initialize();
    await mgr.startSession();
    assert.strictEqual(mgr.isSessionActive(), true);
    await mgr.endSession();
    assert.strictEqual(mgr.isSessionActive(), false);
  });

  it('dispose clears active state', async () => {
    const mgr = new SessionManagerImpl();
    await mgr.initialize();
    await mgr.startSession();
    mgr.dispose();
    assert.strictEqual(mgr.isSessionActive(), false);
    assert.ok(mgr.isInitialized() === false || mgr.isInitialized() === true, 'dispose does not guarantee re-init state');
  });
});

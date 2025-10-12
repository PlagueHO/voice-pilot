import * as assert from 'assert';
import { Logger } from '../../core/logger';
import { SessionTimerManagerImpl } from '../../session/session-timer-manager';

class TestLogger extends Logger {
  constructor() { super('SessionTimerTest'); }
  // Silence output during tests
  debug(): void { /* no-op */ }
  info(): void { /* no-op */ }
  warn(): void { /* no-op */ }
  error(): void { /* no-op */ }
}

describe('SessionTimerManagerImpl', () => {
  let renewal: string[];
  let timeout: string[];
  let heartbeat: string[];
  let manager: SessionTimerManagerImpl;

  beforeEach(() => {
    renewal = [];
    timeout = [];
    heartbeat = [];
    manager = new SessionTimerManagerImpl(
      new TestLogger(),
      async (id) => { renewal.push(id); },
      async (id) => { timeout.push(id); },
      async (id) => { heartbeat.push(id); },
      undefined,
    );
  });

  afterEach(() => {
    manager.dispose();
  });

  it('triggers immediate renewal when scheduled time is past', async () => {
    manager.startRenewalTimer('s1', Date.now() - 1000);
    // Allow microtask queue to flush
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(renewal.length, 1);
    assert.strictEqual(renewal[0], 's1');
  });

  it('reports next heartbeat event when earliest', async () => {
    manager.startHeartbeatTimer('s1', 50);
    manager.startRenewalTimer('s1', Date.now() + 5000);
    const next = manager.getNextScheduledEvent('s1');
    assert.ok(next);
    assert.strictEqual(next?.type, 'heartbeat');
  });

  it('pauses and resumes timers preserving remaining time (approximate)', async () => {
    const renewIn = Date.now() + 200;
    manager.startRenewalTimer('s1', renewIn);
    manager.pauseTimers('s1');
    const statusPaused = manager.getTimerStatus('s1');
    assert.ok(statusPaused.renewalTimer);
    const remaining = statusPaused.renewalTimer!.timeRemainingMs;
    assert.ok(remaining <= 200 && remaining >= 0);
    manager.resumeTimers('s1');
    const statusResumed = manager.getTimerStatus('s1');
    assert.ok(statusResumed.renewalTimer?.isActive);
  });

  it('clears all timers on dispose', () => {
    manager.startRenewalTimer('s1', Date.now() + 1000);
    manager.startTimeoutTimer('s1', 1000);
    manager.startHeartbeatTimer('s1', 100);
    manager.dispose();
    const status = manager.getTimerStatus('s1');
    assert.strictEqual(status.renewalTimer, undefined);
    assert.strictEqual(status.timeoutTimer, undefined);
    assert.strictEqual(status.heartbeatTimer, undefined);
  });
});

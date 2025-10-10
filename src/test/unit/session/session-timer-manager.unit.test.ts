import type { Logger } from '../../../core/logger';
import { SessionTimerManagerImpl } from '../../../session/session-timer-manager';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

interface LogEntry {
  level: 'debug' | 'warn' | 'error';
  message: string;
  data?: unknown;
}

function createTestLogger() {
  const entries: LogEntry[] = [];
  const logger = {
    debug(message: string, data?: unknown) {
      entries.push({ level: 'debug', message, data });
    },
    info(message: string, data?: unknown) {
      entries.push({ level: 'debug', message, data });
    },
    warn(message: string, data?: unknown) {
      entries.push({ level: 'warn', message, data });
    },
    error(message: string, data?: unknown) {
      entries.push({ level: 'error', message, data });
    },
    setLevel() {
      /* noop */
    },
    dispose() {
      /* noop */
    },
  } as unknown as Logger;
  return { logger, entries };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function flushAsyncOperations() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

suite('Unit: SessionTimerManagerImpl', () => {
  const sessionId = 'session-123';
  let renewalInvocations: string[];
  let timeoutInvocations: string[];
  let heartbeatInvocations: string[];
  let loggerEntries: LogEntry[];
  let manager: SessionTimerManagerImpl;

  beforeEach(() => {
    renewalInvocations = [];
    timeoutInvocations = [];
    heartbeatInvocations = [];
    const { logger, entries } = createTestLogger();
    loggerEntries = entries;
    manager = new SessionTimerManagerImpl(
      logger,
      async (id) => {
        renewalInvocations.push(id);
      },
      async (id) => {
        timeoutInvocations.push(id);
      },
      async (id) => {
        heartbeatInvocations.push(id);
      },
    );
  });

  afterEach(() => {
    manager.dispose();
  });

  test('triggers renewal immediately when scheduled time is in the past', async () => {
    manager.startRenewalTimer(sessionId, Date.now() - 50);

    await flushAsyncOperations();

    expect(renewalInvocations).to.deep.equal([sessionId]);
    const warning = loggerEntries.find((entry) => entry.level === 'warn');
    expect(warning?.message).to.equal('Renewal timer scheduled in the past; triggering immediately');
  });

  test('schedules renewal and reports next event metadata', async () => {
    const renewAt = Date.now() + 40;

    manager.startRenewalTimer(sessionId, renewAt);

    const status = manager.getTimerStatus(sessionId);
    expect(status.renewalTimer?.isActive).to.equal(true);
    expect(status.renewalTimer?.scheduledAt.getTime()).to.equal(renewAt);
    expect(status.renewalTimer?.timeRemainingMs).to.be.greaterThan(0);

    const next = manager.getNextScheduledEvent(sessionId);
    expect(next?.type).to.equal('renewal');

    await delay(60);

    expect(renewalInvocations).to.deep.equal([sessionId]);
    expect(manager.getTimerStatus(sessionId).renewalTimer?.isActive).to.equal(false);
  });

  test('resetInactivityTimer restarts timeout countdown', async () => {
    manager.startTimeoutTimer(sessionId, 40);

    await delay(10);
    manager.resetInactivityTimer(sessionId);

    await delay(25);
    expect(timeoutInvocations).to.be.empty;

    await delay(30);
    expect(timeoutInvocations).to.deep.equal([sessionId]);
  });

  test('heartbeat timer tracks execution cadence and metadata', async () => {
    manager.startHeartbeatTimer(sessionId, 15);

    await delay(50);

    expect(heartbeatInvocations.length).to.be.greaterThan(1);
    const status = manager.getTimerStatus(sessionId);
    expect(status.heartbeatTimer?.isActive).to.equal(true);
    expect(status.heartbeatTimer?.intervalMs).to.equal(15);
    expect(status.heartbeatTimer?.lastExecutedAt).to.be.instanceOf(Date);
    expect(status.heartbeatTimer?.nextExecutionAt).to.be.instanceOf(Date);
    expect(status.heartbeatTimer?.timeRemainingMs).to.be.at.least(0);
  expect(status.heartbeatTimer?.timeRemainingMs).to.be.at.most(25);
  });

  test('pause and resume timers preserve remaining durations', async () => {
    const renewDelayMs = 60;
    manager.startRenewalTimer(sessionId, Date.now() + renewDelayMs);
  manager.startTimeoutTimer(sessionId, 80);

    await delay(15);
    manager.pauseTimers(sessionId);

    const pausedStatus = manager.getTimerStatus(sessionId);
    expect(pausedStatus.renewalTimer?.isActive).to.equal(false);
    expect(pausedStatus.timeoutTimer?.isActive).to.equal(false);
    const remainingRenewal = pausedStatus.renewalTimer?.timeRemainingMs ?? 0;
    expect(remainingRenewal).to.be.greaterThan(0);

  manager.resumeTimers(sessionId);

  await delay(remainingRenewal + 10);

  expect(renewalInvocations).to.deep.equal([sessionId]);
  expect(timeoutInvocations).to.deep.equal([]);

  await delay(30);
  expect(timeoutInvocations).to.deep.equal([sessionId]);
  });

  test('logs callback failure when timeout handler rejects', async () => {
    const { logger, entries } = createTestLogger();
    loggerEntries = entries;
    manager.dispose();
    manager = new SessionTimerManagerImpl(
      logger,
      async () => {},
      async () => {
        throw new Error('timeout failure');
      },
      async () => {},
    );

    manager.startTimeoutTimer(sessionId, 15);
    await delay(30);

    const errorEntry = loggerEntries.find((entry) => entry.level === 'error');
    expect(errorEntry?.message).to.equal('Timeout callback failed');
    expect((errorEntry?.data as { error?: string })?.error).to.equal('timeout failure');
  });
});

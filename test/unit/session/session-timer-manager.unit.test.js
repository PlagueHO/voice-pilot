"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_timer_manager_1 = require("../../src/../session/session-timer-manager");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createTestLogger() {
    const entries = [];
    const logger = {
        debug(message, data) {
            entries.push({ level: 'debug', message, data });
        },
        info(message, data) {
            entries.push({ level: 'debug', message, data });
        },
        warn(message, data) {
            entries.push({ level: 'warn', message, data });
        },
        error(message, data) {
            entries.push({ level: 'error', message, data });
        },
        setLevel() {
            /* noop */
        },
        dispose() {
            /* noop */
        },
    };
    return { logger, entries };
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function flushAsyncOperations() {
    await new Promise((resolve) => setImmediate(resolve));
}
(0, mocha_globals_1.suite)('Unit: SessionTimerManagerImpl', () => {
    const sessionId = 'session-123';
    let renewalInvocations;
    let timeoutInvocations;
    let heartbeatInvocations;
    let loggerEntries;
    let manager;
    (0, mocha_globals_1.beforeEach)(() => {
        renewalInvocations = [];
        timeoutInvocations = [];
        heartbeatInvocations = [];
        const { logger, entries } = createTestLogger();
        loggerEntries = entries;
        manager = new session_timer_manager_1.SessionTimerManagerImpl(logger, async (id) => {
            renewalInvocations.push(id);
        }, async (id) => {
            timeoutInvocations.push(id);
        }, async (id) => {
            heartbeatInvocations.push(id);
        }, undefined);
    });
    (0, mocha_globals_1.afterEach)(() => {
        manager.dispose();
    });
    (0, mocha_globals_1.test)('triggers renewal immediately when scheduled time is in the past', async () => {
        manager.startRenewalTimer(sessionId, Date.now() - 50);
        await flushAsyncOperations();
        (0, chai_setup_1.expect)(renewalInvocations).to.deep.equal([sessionId]);
        const warning = loggerEntries.find((entry) => entry.level === 'warn');
        (0, chai_setup_1.expect)(warning?.message).to.equal('Renewal timer scheduled in the past; triggering immediately');
    });
    (0, mocha_globals_1.test)('schedules renewal and reports next event metadata', async () => {
        const renewAt = Date.now() + 40;
        manager.startRenewalTimer(sessionId, renewAt);
        const status = manager.getTimerStatus(sessionId);
        (0, chai_setup_1.expect)(status.renewalTimer?.isActive).to.equal(true);
        (0, chai_setup_1.expect)(status.renewalTimer?.scheduledAt.getTime()).to.equal(renewAt);
        (0, chai_setup_1.expect)(status.renewalTimer?.timeRemainingMs).to.be.greaterThan(0);
        const next = manager.getNextScheduledEvent(sessionId);
        (0, chai_setup_1.expect)(next?.type).to.equal('renewal');
        await delay(60);
        (0, chai_setup_1.expect)(renewalInvocations).to.deep.equal([sessionId]);
        (0, chai_setup_1.expect)(manager.getTimerStatus(sessionId).renewalTimer?.isActive).to.equal(false);
    });
    (0, mocha_globals_1.test)('resetInactivityTimer restarts timeout countdown', async () => {
        manager.startTimeoutTimer(sessionId, 40);
        await delay(10);
        manager.resetInactivityTimer(sessionId);
        await delay(25);
        (0, chai_setup_1.expect)(timeoutInvocations).to.be.empty;
        await delay(30);
        (0, chai_setup_1.expect)(timeoutInvocations).to.deep.equal([sessionId]);
    });
    (0, mocha_globals_1.test)('heartbeat timer tracks execution cadence and metadata', async () => {
        manager.startHeartbeatTimer(sessionId, 15);
        await delay(50);
        (0, chai_setup_1.expect)(heartbeatInvocations.length).to.be.greaterThan(1);
        const status = manager.getTimerStatus(sessionId);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.isActive).to.equal(true);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.intervalMs).to.equal(15);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.lastExecutedAt).to.be.instanceOf(Date);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.nextExecutionAt).to.be.instanceOf(Date);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.timeRemainingMs).to.be.at.least(0);
        (0, chai_setup_1.expect)(status.heartbeatTimer?.timeRemainingMs).to.be.at.most(25);
    });
    (0, mocha_globals_1.test)('pause and resume timers preserve remaining durations', async () => {
        const renewDelayMs = 60;
        manager.startRenewalTimer(sessionId, Date.now() + renewDelayMs);
        manager.startTimeoutTimer(sessionId, 80);
        await delay(15);
        manager.pauseTimers(sessionId);
        const pausedStatus = manager.getTimerStatus(sessionId);
        (0, chai_setup_1.expect)(pausedStatus.renewalTimer?.isActive).to.equal(false);
        (0, chai_setup_1.expect)(pausedStatus.timeoutTimer?.isActive).to.equal(false);
        const remainingRenewal = pausedStatus.renewalTimer?.timeRemainingMs ?? 0;
        (0, chai_setup_1.expect)(remainingRenewal).to.be.greaterThan(0);
        manager.resumeTimers(sessionId);
        await delay(remainingRenewal + 10);
        (0, chai_setup_1.expect)(renewalInvocations).to.deep.equal([sessionId]);
        (0, chai_setup_1.expect)(timeoutInvocations).to.deep.equal([]);
        await delay(30);
        (0, chai_setup_1.expect)(timeoutInvocations).to.deep.equal([sessionId]);
    });
    (0, mocha_globals_1.test)('logs callback failure when timeout handler rejects', async () => {
        const { logger, entries } = createTestLogger();
        loggerEntries = entries;
        manager.dispose();
        manager = new session_timer_manager_1.SessionTimerManagerImpl(logger, async () => { }, async () => {
            throw new Error('timeout failure');
        }, async () => { }, undefined);
        manager.startTimeoutTimer(sessionId, 15);
        await delay(30);
        const errorEntry = loggerEntries.find((entry) => entry.level === 'error');
        (0, chai_setup_1.expect)(errorEntry?.message).to.equal('Timeout callback failed');
        (0, chai_setup_1.expect)(errorEntry?.data?.error).to.equal('timeout failure');
    });
});
//# sourceMappingURL=session-timer-manager.unit.test.js.map
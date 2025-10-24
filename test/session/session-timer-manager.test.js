"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const logger_1 = require("../../src/core/logger");
const session_timer_manager_1 = require("../../src/session/session-timer-manager");
class TestLogger extends logger_1.Logger {
    constructor() { super('SessionTimerTest'); }
    // Silence output during tests
    debug() { }
    info() { }
    warn() { }
    error() { }
}
describe('SessionTimerManagerImpl', () => {
    let renewal;
    let timeout;
    let heartbeat;
    let manager;
    beforeEach(() => {
        renewal = [];
        timeout = [];
        heartbeat = [];
        manager = new session_timer_manager_1.SessionTimerManagerImpl(new TestLogger(), async (id) => { renewal.push(id); }, async (id) => { timeout.push(id); }, async (id) => { heartbeat.push(id); }, undefined);
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
        const remaining = statusPaused.renewalTimer.timeRemainingMs;
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
//# sourceMappingURL=session-timer-manager.test.js.map
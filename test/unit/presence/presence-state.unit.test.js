"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const presence_1 = require("../../src/../types/presence");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const detailsBase = {
    retry: false,
    renewal: false,
};
(0, mocha_globals_1.suite)('Unit: presence state helpers', () => {
    (0, mocha_globals_1.test)('normalizePresenceState maps interrupted to listening and preserves other states', () => {
        const canonical = (0, presence_1.normalizePresenceState)('interrupted');
        (0, chai_setup_1.expect)(canonical).to.equal('listening');
        const states = [
            'idle',
            'listening',
            'processing',
            'waitingForCopilot',
            'speaking',
            'suspended',
            'error',
            'offline',
        ];
        for (const state of states) {
            (0, chai_setup_1.expect)((0, presence_1.normalizePresenceState)(state)).to.equal(state);
        }
    });
    (0, mocha_globals_1.test)('resolvePresenceDescriptor returns canonical descriptor for interrupted state', () => {
        const descriptor = (0, presence_1.resolvePresenceDescriptor)('interrupted');
        (0, chai_setup_1.expect)(descriptor.state).to.equal('listening');
        (0, chai_setup_1.expect)(descriptor.message).to.equal('● Listening');
        (0, chai_setup_1.expect)(descriptor.defaultDetails).to.deep.equal({ retry: false, renewal: false });
    });
    (0, mocha_globals_1.test)('isPresenceStateEqual returns true only when state, message, availability, and details match', () => {
        const base = {
            state: 'processing',
            sessionId: 'session',
            since: new Date().toISOString(),
            copilotAvailable: true,
            latencyMs: 25,
            message: '⋯ Thinking',
            details: { ...detailsBase },
        };
        const same = {
            ...base,
            details: { ...base.details },
        };
        (0, chai_setup_1.expect)((0, presence_1.isPresenceStateEqual)(base, same)).to.equal(true);
        const differentDetails = {
            ...base,
            details: { retry: true, renewal: false },
        };
        (0, chai_setup_1.expect)((0, presence_1.isPresenceStateEqual)(base, differentDetails)).to.equal(false);
        const differentMessage = {
            ...base,
            message: 'different',
        };
        (0, chai_setup_1.expect)((0, presence_1.isPresenceStateEqual)(base, differentMessage)).to.equal(false);
        const missing = undefined;
        (0, chai_setup_1.expect)((0, presence_1.isPresenceStateEqual)(base, missing)).to.equal(false);
    });
    (0, mocha_globals_1.test)('presence batch window constant remains within debounce threshold', () => {
        (0, chai_setup_1.expect)(presence_1.PRESENCE_BATCH_WINDOW_MS).to.be.greaterThan(0);
        (0, chai_setup_1.expect)(presence_1.PRESENCE_BATCH_WINDOW_MS).to.be.at.most(100);
    });
});
//# sourceMappingURL=presence-state.unit.test.js.map
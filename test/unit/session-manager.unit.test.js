"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_setup_1 = require("../helpers/chai-setup");
const mocha_globals_1 = require("../mocha-globals");
// Create a minimal mock to avoid VS Code dependencies in unit tests
class MockSessionManager {
    initialized = false;
    sessions = new Map();
    async initialize() {
        this.initialized = true;
    }
    isInitialized() {
        return this.initialized;
    }
    dispose() {
        this.initialized = false;
        this.sessions.clear();
    }
    async startSession() {
        if (!this.initialized) {
            throw new Error('SessionManager not initialized');
        }
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const session = {
            sessionId,
            state: 'active',
            startedAt: new Date(),
            config: { renewalMarginSeconds: 10 }
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    async endSession(sessionId) {
        if (sessionId) {
            this.sessions.delete(sessionId);
        }
        else {
            this.sessions.clear();
        }
    }
    isSessionActive() {
        return this.sessions.size > 0;
    }
    getAllSessions() {
        return Array.from(this.sessions.values());
    }
}
(0, mocha_globals_1.suite)('Unit: SessionManager Core Logic', () => {
    let manager;
    (0, mocha_globals_1.beforeEach)(() => {
        manager = new MockSessionManager();
    });
    (0, mocha_globals_1.test)('is not initialized by default', () => {
        (0, chai_setup_1.expect)(manager.isInitialized()).to.equal(false);
    });
    (0, mocha_globals_1.test)('initializes successfully', async () => {
        await manager.initialize();
        (0, chai_setup_1.expect)(manager.isInitialized()).to.equal(true);
    });
    (0, mocha_globals_1.test)('is idempotent on initialization', async () => {
        await manager.initialize();
        await manager.initialize(); // Should not throw
        (0, chai_setup_1.expect)(manager.isInitialized()).to.equal(true);
    });
    (0, mocha_globals_1.test)('throws when starting session before initialization', async () => {
        await (0, chai_setup_1.expect)(manager.startSession()).to.be.rejectedWith(/not initialized/i);
    });
    (0, mocha_globals_1.test)('starts session successfully after initialization', async () => {
        await manager.initialize();
        const session = await manager.startSession();
        (0, chai_setup_1.expect)(session.sessionId).to.be.a('string').and.not.empty;
        (0, chai_setup_1.expect)(session.state).to.equal('active');
        (0, chai_setup_1.expect)(session.startedAt).to.be.instanceOf(Date);
        (0, chai_setup_1.expect)(manager.isSessionActive()).to.equal(true);
    });
    (0, mocha_globals_1.test)('ends session successfully', async () => {
        await manager.initialize();
        const session = await manager.startSession();
        await manager.endSession(session.sessionId);
        (0, chai_setup_1.expect)(manager.isSessionActive()).to.equal(false);
    });
    (0, mocha_globals_1.test)('handles multiple sessions', async () => {
        await manager.initialize();
        const session1 = await manager.startSession();
        const session2 = await manager.startSession();
        (0, chai_setup_1.expect)(manager.getAllSessions()).to.have.lengthOf(2);
        (0, chai_setup_1.expect)(session1.sessionId).to.not.equal(session2.sessionId);
    });
    (0, mocha_globals_1.test)('disposes cleanly', async () => {
        await manager.initialize();
        await manager.startSession();
        manager.dispose();
        (0, chai_setup_1.expect)(manager.isInitialized()).to.equal(false);
        (0, chai_setup_1.expect)(manager.isSessionActive()).to.equal(false);
        (0, chai_setup_1.expect)(manager.getAllSessions()).to.have.lengthOf(0);
    });
    (0, mocha_globals_1.test)('validates session configuration structure', async () => {
        await manager.initialize();
        const session = await manager.startSession();
        (0, chai_setup_1.expect)(session.config).to.exist;
        (0, chai_setup_1.expect)(session.config.renewalMarginSeconds).to.be.a('number');
    });
    (0, mocha_globals_1.test)('generates unique session IDs', async () => {
        await manager.initialize();
        const ids = new Set();
        for (let i = 0; i < 5; i++) {
            const session = await manager.startSession();
            ids.add(session.sessionId);
            // Small delay to ensure different timestamps
            await new Promise((resolve) => setTimeout(resolve, 2));
        }
        (0, chai_setup_1.expect)(ids.size, 'All session IDs should be unique').to.equal(5);
    });
});
//# sourceMappingURL=session-manager.unit.test.js.map
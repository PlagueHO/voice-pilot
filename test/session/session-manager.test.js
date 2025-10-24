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
const session_manager_1 = require("../../src/session/session-manager");
describe('SessionManagerImpl - Backward Compatibility', () => {
    let manager;
    let mockLogger;
    beforeEach(() => {
        mockLogger = new logger_1.Logger('TestSessionManager');
        manager = new session_manager_1.SessionManagerImpl(undefined, undefined, undefined, mockLogger);
    });
    it('initializes once and is idempotent', async () => {
        // Mock dependencies for initialization
        manager.keyService = {
            isInitialized: () => true,
            onKeyRenewed: () => ({ dispose: () => { } }),
            onKeyExpired: () => ({ dispose: () => { } }),
            onAuthenticationError: () => ({ dispose: () => { } })
        };
        manager.configManager = {
            isInitialized: () => true
        };
        await manager.initialize();
        assert.ok(manager.isInitialized());
        await manager.initialize(); // second call should not throw
    });
    it('starts and ends a session', async () => {
        // Mock all required dependencies
        manager.keyService = {
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
            endSession: async () => { },
            onKeyRenewed: () => ({ dispose: () => { } }),
            onKeyExpired: () => ({ dispose: () => { } }),
            onAuthenticationError: () => ({ dispose: () => { } })
        };
        manager.configManager = {
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
        manager.keyService = {
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
            endSession: async () => { },
            onKeyRenewed: () => ({ dispose: () => { } }),
            onKeyExpired: () => ({ dispose: () => { } }),
            onAuthenticationError: () => ({ dispose: () => { } })
        };
        manager.configManager = {
            isInitialized: () => true
        };
        await manager.initialize();
        await manager.startSession();
        manager.dispose();
        assert.strictEqual(manager.isSessionActive(), false);
        assert.strictEqual(manager.isInitialized(), false);
    });
});
//# sourceMappingURL=session-manager.test.js.map
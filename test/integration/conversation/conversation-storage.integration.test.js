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
const chai_1 = require("chai");
const fsp = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const conversation_storage_service_1 = require("../../src/../services/conversation/conversation-storage-service");
const session_manager_1 = require("../../src/../session/session-manager");
const session_timer_manager_1 = require("../../src/../session/session-timer-manager");
const mocha_globals_1 = require("../../src/mocha-globals");
class TestSecretStorage {
    secrets = new Map();
    emitter = new vscode.EventEmitter();
    onDidChange = this.emitter.event;
    async get(key) {
        return this.secrets.get(key);
    }
    async store(key, value) {
        this.secrets.set(key, value);
        this.emitter.fire({ key });
    }
    async delete(key) {
        this.secrets.delete(key);
        this.emitter.fire({ key });
    }
    async keys() {
        return Array.from(this.secrets.keys());
    }
}
class PrivacyControllerStub {
    registrations = new Map();
    seconds = 3600;
    setRetentionSeconds(seconds) {
        this.seconds = seconds;
    }
    getRetentionSeconds(_category) {
        return this.seconds;
    }
    registerRetention(registration) {
        this.registrations.set(registration.id, registration);
        return new vscode.Disposable(() => {
            this.registrations.delete(registration.id);
        });
    }
    async issuePurge() {
        return {
            target: "all",
            status: "success",
            clearedCount: 0,
            retainedCount: 0,
        };
    }
}
function createTestLogger() {
    const entries = [];
    const logger = {
        info(message) {
            entries.push({ level: "info", message });
        },
        warn(message) {
            entries.push({ level: "warn", message });
        },
        error(message) {
            entries.push({ level: "error", message });
        },
        debug(message) {
            entries.push({ level: "debug", message });
        },
    };
    return { logger, entries };
}
(0, mocha_globals_1.suite)("Integration: Conversation storage handoff", () => {
    let tempDir;
    let restoreFs;
    let context;
    let secrets;
    let privacy;
    let conversationStorage;
    let sessionManager;
    (0, mocha_globals_1.beforeEach)(async () => {
        tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-conv-int-"));
        restoreFs = stubWorkspaceFs();
        secrets = new TestSecretStorage();
        privacy = new PrivacyControllerStub();
        const { logger } = createTestLogger();
        context = {
            storageUri: vscode.Uri.file(tempDir),
            secrets,
        };
        conversationStorage = new conversation_storage_service_1.ConversationStorageServiceImpl(context, privacy, logger);
        await conversationStorage.initialize();
        const keyServiceStub = createKeyServiceStub();
        const configStub = createConfigStub();
        const timerManager = new session_timer_manager_1.SessionTimerManagerImpl(logger, async () => undefined, async () => undefined, async () => undefined, undefined);
        sessionManager = new session_manager_1.SessionManagerImpl(keyServiceStub, timerManager, configStub, logger, privacy, undefined, undefined, undefined, conversationStorage);
        sessionManager.setConversationStorage(conversationStorage);
        await sessionManager.initialize();
    });
    (0, mocha_globals_1.afterEach)(async () => {
        sessionManager?.dispose();
        conversationStorage?.dispose();
        restoreFs?.();
        restoreFs = undefined;
        await fsp.rm(tempDir, { recursive: true, force: true });
    });
    (0, mocha_globals_1.test)("commits conversation snapshots during session end", async () => {
        const session = await sessionManager.startSession();
        const finalEventTimestamp = new Date().toISOString();
        await sessionManager.handleTranscriptForConversationStorage({
            type: "transcript-final",
            sessionId: session.sessionId,
            utteranceId: "utt-final",
            content: "Integration test message",
            confidence: 0.92,
            timestamp: finalEventTimestamp,
            metadata: {
                startOffsetMs: 0,
                chunkCount: 1,
                locale: "en-US",
                redactionsApplied: [],
            },
        });
        const conversationId = session.conversationId;
        await sessionManager.endSession(session.sessionId);
        const record = await conversationStorage.getRecord(conversationId);
        (0, chai_1.expect)(record).to.exist;
        (0, chai_1.expect)(record?.messages).to.have.length(1);
        (0, chai_1.expect)(record?.messages[0].content).to.equal("Integration test message");
        const snapshot = await conversationStorage.getSnapshot(conversationId);
        (0, chai_1.expect)(snapshot).to.be.undefined;
        const summaries = await conversationStorage.listRecords();
        (0, chai_1.expect)(summaries.items[0]?.messageCount).to.equal(1);
        (0, chai_1.expect)(sessionManager.conversationSnapshots.size).to.equal(0);
    });
});
function createKeyServiceStub() {
    let currentKey = {
        sessionId: "stub-session",
    };
    return {
        isInitialized: () => true,
        requestEphemeralKey: async () => ({
            success: true,
            expiresAt: new Date(Date.now() + 60000),
        }),
        getCurrentKey: () => currentKey,
        renewKey: async () => ({
            success: true,
            expiresAt: new Date(Date.now() + 60000),
        }),
        revokeCurrentKey: async () => undefined,
        endSession: async () => undefined,
        onKeyRenewed: () => ({ dispose() { } }),
        onKeyExpired: () => ({ dispose() { } }),
        onAuthenticationError: () => ({ dispose() { } }),
        isInitializedLifecycle: () => true,
    };
}
function createConfigStub() {
    return {
        isInitialized: () => true,
    };
}
function stubWorkspaceFs() {
    const originalDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, "fs");
    const original = originalDescriptor?.get
        ? originalDescriptor.get.call(vscode.workspace)
        : vscode.workspace.fs;
    const overrides = {
        async createDirectory(uri) {
            await fsp.mkdir(uri.fsPath, { recursive: true });
        },
        async writeFile(uri, content) {
            await fsp.mkdir(path.dirname(uri.fsPath), { recursive: true });
            await fsp.writeFile(uri.fsPath, Buffer.from(content));
        },
        async readFile(uri) {
            try {
                const buffer = await fsp.readFile(uri.fsPath);
                return new Uint8Array(buffer);
            }
            catch (error) {
                if (error?.code === "ENOENT") {
                    const notFound = new Error("File not found");
                    notFound.code = "FileNotFound";
                    notFound.name = "EntryNotFound";
                    throw notFound;
                }
                throw error;
            }
        },
        async delete(uri) {
            try {
                await fsp.rm(uri.fsPath, { recursive: true, force: false });
            }
            catch (error) {
                if (error?.code === "ENOENT") {
                    const notFound = new Error("File not found");
                    notFound.code = "FileNotFound";
                    notFound.name = "EntryNotFound";
                    throw notFound;
                }
                throw error;
            }
        },
        async readDirectory(uri) {
            try {
                const entries = await fsp.readdir(uri.fsPath, { withFileTypes: true });
                return entries.map((entry) => [
                    entry.name,
                    entry.isDirectory()
                        ? vscode.FileType.Directory
                        : entry.isFile()
                            ? vscode.FileType.File
                            : vscode.FileType.Unknown,
                ]);
            }
            catch (error) {
                if (error?.code === "ENOENT") {
                    return [];
                }
                throw error;
            }
        },
    };
    const fsAdapter = Object.assign(Object.create(null), original, overrides);
    if (originalDescriptor?.configurable) {
        Object.defineProperty(vscode.workspace, "fs", {
            configurable: true,
            get: () => fsAdapter,
        });
        return () => {
            Object.defineProperty(vscode.workspace, "fs", originalDescriptor);
        };
    }
    const patched = new Map();
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) {
            const existing = original[key];
            patched.set(key, existing);
            Object.defineProperty(original, key, {
                value,
                configurable: true,
                writable: true,
            });
        }
    }
    return () => {
        for (const [key, value] of patched) {
            Object.defineProperty(original, key, {
                value,
                configurable: true,
                writable: true,
            });
        }
    };
}
//# sourceMappingURL=conversation-storage.integration.test.js.map
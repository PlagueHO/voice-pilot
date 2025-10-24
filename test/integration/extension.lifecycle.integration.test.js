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
const vscode = __importStar(require("vscode"));
const ephemeral_key_service_1 = require("../../src/auth/ephemeral-key-service");
const configuration_manager_1 = require("../../src/config/configuration-manager");
const logger_1 = require("../../src/core/logger");
const session_manager_1 = require("../../src/session/session-manager");
const voice_control_panel_1 = require("../../src/ui/voice-control-panel");
const mocha_globals_1 = require("../mocha-globals");
(0, mocha_globals_1.suite)("Integration: Extension lifecycle", () => {
    let disposables;
    let context;
    (0, mocha_globals_1.beforeEach)(() => {
        disposables = [];
        context = {
            subscriptions: disposables,
            extensionUri: vscode.Uri.parse("file://test"),
            environmentVariableCollection: {},
            asAbsolutePath: (p) => p,
            storagePath: undefined,
            globalStoragePath: "",
            logPath: "",
            extensionPath: "",
            globalState: {
                get: () => undefined,
                update: async () => undefined,
                keys: () => [],
            },
            workspaceState: {
                get: () => undefined,
                update: async () => undefined,
                keys: () => [],
            },
            secrets: {
                get: async () => undefined,
                store: async () => undefined,
                delete: async () => undefined,
            },
        };
    });
    (0, mocha_globals_1.afterEach)(() => {
        disposables.forEach((d) => d.dispose());
    });
    (0, mocha_globals_1.test)("services initialize and dispose in correct order", async () => {
        const events = [];
        const logger = new logger_1.Logger("TestLogger");
        const config = new configuration_manager_1.ConfigurationManager(context, logger);
        const credentialManager = {
            isInitialized: () => true,
            getAzureOpenAIKey: async () => "test-key",
        };
        const keyService = new ephemeral_key_service_1.EphemeralKeyServiceImpl(credentialManager, config, logger);
        const originalFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    id: "session-test",
                    model: "gpt-4o-realtime-preview",
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    client_secret: {
                        value: "ephemeral-key-test",
                        expires_at: Math.floor(Date.now() / 1000) + 60,
                    },
                }),
            });
            const session = new session_manager_1.SessionManager(keyService, undefined, config, logger);
            const panel = new voice_control_panel_1.VoiceControlPanel(context);
            const originalPanelDispose = panel.dispose.bind(panel);
            panel.dispose = () => {
                events.push("panel");
                originalPanelDispose();
            };
            const originalSessionDispose = session.dispose.bind(session);
            session.dispose = () => {
                events.push("session");
                originalSessionDispose();
            };
            const originalKeyDispose = keyService.dispose.bind(keyService);
            keyService.dispose = () => {
                events.push("key");
                originalKeyDispose();
            };
            const originalConfigDispose = config.dispose.bind(config);
            config.dispose = () => {
                events.push("config");
                originalConfigDispose();
            };
            await config.initialize();
            (0, chai_1.expect)(config.isInitialized(), "Config should be initialized").to.be.true;
            await keyService.initialize();
            (0, chai_1.expect)(keyService.isInitialized(), "Key service should be initialized").to.be.true;
            (0, chai_1.expect)(session.keyService, "Session should have the keyService").to.equal(keyService);
            (0, chai_1.expect)(session.keyService.isInitialized(), "Session keyService should be initialized").to.be.true;
            await session.initialize();
            (0, chai_1.expect)(session.isInitialized(), "Session should be initialized").to.be.true;
            await panel.initialize();
            (0, chai_1.expect)(panel.isInitialized(), "Panel should be initialized").to.be.true;
            panel.dispose();
            session.dispose();
            keyService.dispose();
            config.dispose();
            (0, chai_1.expect)(events).to.deep.equal([
                "panel",
                "session",
                "key",
                "config",
            ]);
        }
        finally {
            globalThis.fetch = originalFetch;
        }
    });
    (0, mocha_globals_1.test)("panel can be shown and disposed", async () => {
        const logger = new logger_1.Logger("TestLogger2");
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        await panel.initialize();
        await panel.show();
        (0, chai_1.expect)(panel.isVisible(), "Panel should be visible after show").to.be.true;
        panel.dispose();
        (0, chai_1.expect)(panel.isVisible(), "Panel should not be visible after dispose").to.be.false;
    });
    (0, mocha_globals_1.test)("session manager tracks session state", async () => {
        const logger = new logger_1.Logger("TestLogger");
        const config = new configuration_manager_1.ConfigurationManager(context, logger);
        const credentialManager = {
            isInitialized: () => true,
            getAzureOpenAIKey: async () => "test-key",
        };
        const keyService = new ephemeral_key_service_1.EphemeralKeyServiceImpl(credentialManager, config, logger);
        const originalFetch = globalThis.fetch;
        try {
            globalThis.fetch = async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    id: "session-test",
                    model: "gpt-4o-realtime-preview",
                    expires_at: Math.floor(Date.now() / 1000) + 3600,
                    client_secret: {
                        value: "ephemeral-key-test",
                        expires_at: Math.floor(Date.now() / 1000) + 60,
                    },
                }),
            });
            await config.initialize();
            await keyService.initialize();
            (0, chai_1.expect)(config.isInitialized(), "Config should be initialized").to.be.true;
            (0, chai_1.expect)(keyService.isInitialized(), "Key service should be initialized").to.be.true;
            const session = new session_manager_1.SessionManager(keyService, undefined, config, logger);
            (0, chai_1.expect)(session.keyService, "Session should have the keyService").to.equal(keyService);
            (0, chai_1.expect)(session.keyService.isInitialized(), "Session keyService should be initialized").to.be.true;
            await session.initialize();
            (0, chai_1.expect)(session.isSessionActive(), "Session should not be active initially").to.be.false;
            (0, chai_1.expect)(session.isInitialized(), "Session manager should be initialized").to.be.true;
            session.dispose();
            keyService.dispose();
            config.dispose();
        }
        finally {
            globalThis.fetch = originalFetch;
        }
    });
});
//# sourceMappingURL=extension.lifecycle.integration.test.js.map
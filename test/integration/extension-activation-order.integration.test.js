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
const credential_manager_1 = require("../../src/auth/credential-manager");
const logger_1 = require("../../src/core/logger");
const extension_1 = require("../../src/extension");
const mocha_globals_1 = require("../mocha-globals");
const sanitizers_1 = require("../utils/sanitizers");
(0, mocha_globals_1.suite)("Integration: Activation Telemetry", () => {
    const disposables = [];
    const captured = [];
    const capturedWarnings = [];
    let context;
    let originalFetch;
    let originalShowInformationMessage;
    let originalGetAzureKey;
    let originalTestCredentialAccess;
    (0, mocha_globals_1.beforeEach)(() => {
        captured.length = 0;
        capturedWarnings.length = 0;
        const secretsStore = new Map();
        const subscriptions = [];
        context = {
            subscriptions,
            extensionUri: vscode.Uri.parse("file://integration-telemetry"),
            extensionPath: "",
            extensionMode: vscode.ExtensionMode.Test,
            environmentVariableCollection: {},
            globalStorageUri: vscode.Uri.parse("file://integration-telemetry/global"),
            logUri: vscode.Uri.parse("file://integration-telemetry/logs"),
            secrets: {
                get: async (key) => secretsStore.get(key),
                store: async (key, value) => {
                    secretsStore.set(key, value);
                },
                delete: async (key) => {
                    secretsStore.delete(key);
                },
            },
            workspaceState: {
                get: () => undefined,
                update: async () => undefined,
                keys: () => [],
            },
            globalState: {
                get: () => undefined,
                update: async () => undefined,
                keys: () => [],
            },
            asAbsolutePath: (p) => p,
        };
        const logDisposable = logger_1.Logger.onDidLog((entry) => {
            const sanitized = (0, sanitizers_1.sanitizeLogEntry)(entry);
            if (sanitized.level === "info" && sanitized.message.startsWith("Initializing")) {
                captured.push(sanitized.message);
            }
            if (sanitized.level === "warn" && sanitized.message.includes("Activation exceeded")) {
                capturedWarnings.push(sanitized.message);
            }
        });
        disposables.push(logDisposable);
        originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                id: "session-test",
                model: "gpt-realtime-test",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                client_secret: {
                    value: "ephemeral-key-test",
                    expires_at: Math.floor(Date.now() / 1000) + 60,
                },
            }),
        });
        originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async () => undefined;
        originalGetAzureKey = credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey;
        credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
            return "azure-openai-integration-test-key";
        };
        originalTestCredentialAccess =
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess;
        credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess = async function () {
            return {
                secretStorageAvailable: true,
                credentialsAccessible: true,
                errors: [],
            };
        };
    });
    (0, mocha_globals_1.afterEach)(async () => {
        captured.length = 0;
        capturedWarnings.length = 0;
        disposables.splice(0).forEach((d) => d.dispose());
        await (0, extension_1.deactivate)();
        globalThis.fetch = originalFetch;
        if (originalShowInformationMessage) {
            vscode.window.showInformationMessage =
                originalShowInformationMessage;
        }
        if (originalGetAzureKey) {
            credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
        }
        if (originalTestCredentialAccess) {
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess =
                originalTestCredentialAccess;
        }
    });
    (0, mocha_globals_1.test)("emits initialization telemetry in dependency order", async function () {
        this.timeout(15000);
        await (0, extension_1.activate)(context);
        const getIndex = (keyword) => captured.findIndex((message) => message.includes(keyword));
        const configIdx = getIndex("configuration manager");
        const authIdx = getIndex("ephemeral key service");
        const sessionIdx = getIndex("session manager");
        const uiIdx = getIndex("voice control panel");
        (0, chai_1.expect)(configIdx, "Expected configuration manager initialization log").to.be.greaterThan(-1);
        (0, chai_1.expect)(authIdx, "Expected ephemeral key service initialization log").to.be.greaterThan(-1);
        (0, chai_1.expect)(sessionIdx, "Expected session manager initialization log").to.be.greaterThan(-1);
        (0, chai_1.expect)(uiIdx, "Expected voice control panel initialization log").to.be.greaterThan(-1);
        (0, chai_1.expect)(configIdx, "Configuration should initialize before authentication").to.be.lessThan(authIdx);
        (0, chai_1.expect)(authIdx, "Authentication should initialize before session").to.be.lessThan(sessionIdx);
        (0, chai_1.expect)(sessionIdx, "Session should initialize before UI").to.be.lessThan(uiIdx);
        const warningCount = capturedWarnings.filter((message) => message.includes("Activation exceeded")).length;
        (0, chai_1.expect)(warningCount, "Activation should not exceed latency constraint").to.equal(0);
    });
});
//# sourceMappingURL=extension-activation-order.integration.test.js.map
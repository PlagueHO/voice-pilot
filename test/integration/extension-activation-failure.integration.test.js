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
const configuration_manager_1 = require("../../src/config/configuration-manager");
const logger_1 = require("../../src/core/logger");
const extension_1 = require("../../src/extension");
const mocha_globals_1 = require("../mocha-globals");
const sanitizers_1 = require("../utils/sanitizers");
(0, mocha_globals_1.suite)("Integration: Activation Failure Handling", () => {
    const captured = [];
    const disposables = [];
    let context;
    let originalFetch;
    let originalConfigInitialize;
    let originalShowInformationMessage;
    let originalShowErrorMessage;
    let originalGetAzureKey;
    let originalTestCredentialAccess;
    (0, mocha_globals_1.beforeEach)(() => {
        captured.length = 0;
        const secretsStore = new Map();
        const subscriptions = [];
        context = {
            subscriptions,
            extensionUri: vscode.Uri.parse("file://integration-failure"),
            extensionPath: "",
            extensionMode: vscode.ExtensionMode.Test,
            environmentVariableCollection: {},
            globalStorageUri: vscode.Uri.parse("file://integration-failure/global"),
            logUri: vscode.Uri.parse("file://integration-failure/logs"),
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
        const loggerDisposable = logger_1.Logger.onDidLog((entry) => {
            captured.push((0, sanitizers_1.sanitizeLogEntry)(entry));
        });
        disposables.push(loggerDisposable);
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
        originalConfigInitialize =
            configuration_manager_1.ConfigurationManager.prototype.initialize;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        vscode.window.showInformationMessage = async () => undefined;
        originalShowErrorMessage = vscode.window.showErrorMessage;
        vscode.window.showErrorMessage = async () => undefined;
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
        configuration_manager_1.ConfigurationManager.prototype.initialize =
            originalConfigInitialize ?? configuration_manager_1.ConfigurationManager.prototype.initialize;
        disposables.splice(0).forEach((disposable) => disposable.dispose());
        await (0, extension_1.deactivate)();
        globalThis.fetch = originalFetch;
        if (originalShowInformationMessage) {
            vscode.window.showInformationMessage =
                originalShowInformationMessage;
        }
        if (originalShowErrorMessage) {
            vscode.window.showErrorMessage = originalShowErrorMessage;
        }
        if (originalGetAzureKey) {
            credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
        }
        if (originalTestCredentialAccess) {
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess =
                originalTestCredentialAccess;
        }
    });
    (0, mocha_globals_1.test)("cleans up services when configuration initialization fails", async function () {
        this.timeout(10000);
        configuration_manager_1.ConfigurationManager.prototype.initialize = async function () {
            throw new Error("Simulated configuration failure");
        };
        let activationError;
        try {
            await (0, extension_1.activate)(context);
            chai_1.expect.fail("Activation should throw when configuration initialization fails");
        }
        catch (error) {
            activationError = error;
        }
        (0, chai_1.expect)(activationError, "Expected activation to reject with Error").to.be.instanceOf(Error);
        const failureLog = captured.find((entry) => entry.message.includes("VoicePilot activation failed"));
        (0, chai_1.expect)(failureLog, "Expected activation failure log entry").to.exist;
        const disposeLogs = captured.filter((entry) => entry.message.startsWith("Disposing"));
        (0, chai_1.expect)(disposeLogs.length, "Expected disposal logs during failure cleanup").to.be.greaterThan(0);
        const initializingLogs = captured.filter((entry) => entry.message.startsWith("Initializing"));
        (0, chai_1.expect)(initializingLogs.length, "Expected initialization attempts to be logged").to.be.greaterThan(0);
    });
});
//# sourceMappingURL=extension-activation-failure.integration.test.js.map
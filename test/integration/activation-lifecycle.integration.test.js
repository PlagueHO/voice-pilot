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
const lifecycle_telemetry_1 = require("../../src/telemetry/lifecycle-telemetry");
const mocha_globals_1 = require("../mocha-globals");
const manifest = require("../../../package.json");
const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`.toLowerCase();
const getVoicePilotExtension = () => {
    const direct = vscode.extensions.getExtension(EXTENSION_ID);
    if (direct) {
        return direct;
    }
    return vscode.extensions.all.find((extension) => extension.id.toLowerCase() === EXTENSION_ID);
};
(0, mocha_globals_1.suite)("Integration: Activation lifecycle telemetry", () => {
    let activatedExtension;
    let originalGetAzureKey;
    let originalTestCredentialAccess;
    let originalShowInformationMessage;
    let originalFetch;
    (0, mocha_globals_1.beforeEach)(() => {
        lifecycle_telemetry_1.lifecycleTelemetry.reset();
        activatedExtension = getVoicePilotExtension();
        (0, chai_1.expect)(activatedExtension, "VoicePilot extension should be discoverable").to.exist;
        originalGetAzureKey = credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey;
        originalTestCredentialAccess =
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalFetch = globalThis.fetch;
        credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
            return "azure-openai-test-key";
        };
        credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess = async function () {
            return {
                secretStorageAvailable: true,
                credentialsAccessible: true,
                errors: [],
            };
        };
        vscode.window.showInformationMessage = async () => undefined;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                id: "session-test",
                model: "gpt-realtime",
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                client_secret: {
                    value: "ephemeral-test",
                    expires_at: Math.floor(Date.now() / 1000) + 60,
                },
            }),
        });
    });
    (0, mocha_globals_1.afterEach)(async () => {
        globalThis.fetch = originalFetch;
        if (originalGetAzureKey) {
            credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
        }
        if (originalTestCredentialAccess) {
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess =
                originalTestCredentialAccess;
        }
        if (originalShowInformationMessage) {
            vscode.window.showInformationMessage =
                originalShowInformationMessage;
        }
        lifecycle_telemetry_1.lifecycleTelemetry.reset();
        await activatedExtension?.exports?.deactivate?.();
    });
    (0, mocha_globals_1.test)("emits configuration → authentication → session → UI order", async function () {
        this.timeout(15000);
        await activatedExtension.activate();
        const events = lifecycle_telemetry_1.lifecycleTelemetry
            .getEvents()
            .filter((event) => event.endsWith(".initialized"));
        (0, chai_1.expect)(events).to.deep.equal([
            "config.initialized",
            "auth.initialized",
            "session.initialized",
            "ui.initialized",
        ]);
    });
});
//# sourceMappingURL=activation-lifecycle.integration.test.js.map
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
const fs_1 = require("fs");
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const credential_manager_1 = require("../../src/auth/credential-manager");
const ephemeral_key_service_1 = require("../../src/auth/ephemeral-key-service");
const extension_1 = require("../../src/extension");
const lifecycle_telemetry_1 = require("../../src/telemetry/lifecycle-telemetry");
const mocha_globals_1 = require("../mocha-globals");
const sanitizers_1 = require("../utils/sanitizers");
const FIXTURE_ROOT = path.resolve(__dirname, "../../../test/fixtures/activation-failure");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const createTestContext = (namespace) => {
    const secretsStore = new Map();
    const subscriptions = [];
    return {
        subscriptions,
        extensionUri: vscode.Uri.parse(`file://${namespace}`),
        extensionPath: "",
        extensionMode: vscode.ExtensionMode.Test,
        environmentVariableCollection: {},
        globalStorageUri: vscode.Uri.parse(`file://${namespace}/global`),
        logUri: vscode.Uri.parse(`file://${namespace}/logs`),
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
};
(0, mocha_globals_1.suite)("Integration: Activation failure regressions", () => {
    let originalEphemeralInitialize;
    let originalGetAzureKey;
    let originalTestCredentialAccess;
    let originalShowInformationMessage;
    let originalShowErrorMessage;
    (0, mocha_globals_1.before)(() => {
        originalEphemeralInitialize =
            ephemeral_key_service_1.EphemeralKeyServiceImpl.prototype.initialize;
        originalGetAzureKey =
            credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey;
        originalTestCredentialAccess =
            credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess;
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowErrorMessage = vscode.window.showErrorMessage;
    });
    (0, mocha_globals_1.afterEach)(async () => {
        if (originalEphemeralInitialize) {
            ephemeral_key_service_1.EphemeralKeyServiceImpl.prototype.initialize =
                originalEphemeralInitialize;
        }
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
        if (originalShowErrorMessage) {
            vscode.window.showErrorMessage = originalShowErrorMessage;
        }
        lifecycle_telemetry_1.lifecycleTelemetry.reset();
        await (0, extension_1.deactivate)();
    });
    (0, mocha_globals_1.test)("cleans up when authentication upstream is unavailable", async function () {
        this.timeout(15000);
        lifecycle_telemetry_1.lifecycleTelemetry.reset();
        await (0, extension_1.deactivate)();
        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showErrorMessage = async () => undefined;
        const outageFixturePath = path.join(FIXTURE_ROOT, "session-error-response.json");
        const outageFixture = JSON.parse(await fs_1.promises.readFile(outageFixturePath, "utf8"));
        ephemeral_key_service_1.EphemeralKeyServiceImpl.prototype.initialize = async function () {
            throw new Error(`Authentication initialization failed: ${outageFixture.status}: ${outageFixture.error.message}`);
        };
        credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
            return "fake-key-for-regression";
        };
        credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess = async function () {
            return {
                secretStorageAvailable: true,
                credentialsAccessible: true,
                errors: [],
            };
        };
        const context = createTestContext("activation-failure-outage");
        const activationError = await (0, extension_1.activate)(context).catch((error) => error);
        (0, chai_1.expect)(activationError, "Activation should fail when authentication upstream is unavailable").to.be.instanceOf(Error);
        const sanitizedMessage = (0, sanitizers_1.sanitizeLogMessage)(activationError.message);
        (0, chai_1.expect)(sanitizedMessage).to.match(/Authentication initialization failed/i);
        const events = lifecycle_telemetry_1.lifecycleTelemetry.getEvents();
        (0, chai_1.expect)(events).to.include("activation.failed");
        (0, chai_1.expect)(events, "Session phase should not initialize during outage").to.not.include("session.initialized");
        (0, chai_1.expect)(events, "UI phase should not initialize during outage").to.not.include("ui.initialized");
    });
    (0, mocha_globals_1.test)("reports friendly failure when Azure credentials are missing", async function () {
        this.timeout(15000);
        lifecycle_telemetry_1.lifecycleTelemetry.reset();
        vscode.window.showInformationMessage = async () => undefined;
        vscode.window.showErrorMessage = async () => undefined;
        const hintPath = path.join(FIXTURE_ROOT, "no-credentials-hint.json");
        const hintFixture = JSON.parse(await fs_1.promises.readFile(hintPath, "utf8"));
        await (0, extension_1.deactivate)();
        ephemeral_key_service_1.EphemeralKeyServiceImpl.prototype.initialize = async function () {
            throw new Error(`Authentication initialization failed: ${hintFixture.expectedErrorSnippet}`);
        };
        credential_manager_1.CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
            return undefined;
        };
        credential_manager_1.CredentialManagerImpl.prototype.testCredentialAccess = async function () {
            return {
                secretStorageAvailable: true,
                credentialsAccessible: true,
                errors: [],
            };
        };
        const context = createTestContext("activation-failure-missing-creds");
        const activationError = await (0, extension_1.activate)(context).catch((error) => error);
        (0, chai_1.expect)(activationError, "Activation should fail when credentials are missing").to.be.instanceOf(Error);
        const sanitizedMessage = (0, sanitizers_1.sanitizeLogMessage)(activationError.message);
        (0, chai_1.expect)(sanitizedMessage).to.match(/Authentication initialization failed/i);
        const events = lifecycle_telemetry_1.lifecycleTelemetry.getEvents();
        (0, chai_1.expect)(events).to.include("activation.failed");
        (0, chai_1.expect)(events).to.not.include("auth.initialized");
        // Ensure logs communicate missing credential scenario via telemetry description
        const failureEvents = events.filter((event) => event === "activation.failed");
        (0, chai_1.expect)(failureEvents.length).to.be.at.least(1);
        // Validate the test fixture's guidance snippet is reflected in error message expectations
        (0, chai_1.expect)(sanitizedMessage).to.match(new RegExp(escapeRegExp(hintFixture.expectedErrorSnippet), "i"));
    });
});
//# sourceMappingURL=activation-failure.integration.test.js.map
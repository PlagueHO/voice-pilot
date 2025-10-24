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
exports.createExtensionContextStub = createExtensionContextStub;
const vscode = __importStar(require("vscode"));
/**
 * Creates an in-memory {@link vscode.Memento} implementation for use inside unit tests.
 *
 * @param store - Backing map that simulates VS Code's persisted state storage.
 * @returns A memento with synchronous read access and async update semantics matching VS Code.
 */
function createMemento(store) {
    const get = (key, defaultValue) => {
        if (store.has(key)) {
            return store.get(key);
        }
        return defaultValue;
    };
    const update = async (key, value) => {
        if (value === undefined || value === null) {
            store.delete(key);
            return;
        }
        store.set(key, value);
    };
    const keys = () => Array.from(store.keys());
    const memento = {
        get,
        update,
        keys,
        setKeysForSync: () => { },
    };
    return memento;
}
/**
 * Builds a lightweight {@link vscode.SecretStorage} stub backed by the provided map.
 *
 * @param store - Persistence layer that mimics secret storage behavior for tests.
 * @returns A secret storage implementation that supports get, store, delete, and change events.
 */
function createSecrets(store) {
    return {
        async get(key) {
            return store.get(key);
        },
        async store(key, value) {
            store.set(key, value);
        },
        async delete(key) {
            store.delete(key);
        },
        async keys() {
            return Array.from(store.keys());
        },
        onDidChange: () => ({ dispose() { } }),
    };
}
/**
 * Creates a VS Code {@link vscode.ExtensionContext} substitute tailored for unit testing.
 *
 * @remarks
 * The stub supplies sensible defaults for persistent storage, secret storage, and subscriptions while
 * allowing callers to override any property selectively via the `overrides` option.
 *
 * @param options - Optional configuration for URIs, storage roots, and property overrides.
 * @returns A fully populated extension context that mirrors the shape expected by production code.
 */
function createExtensionContextStub({ uri = "file://voicepilot-unit-test", storageBasePath = "/tmp/voicepilot/test", overrides = {}, } = {}) {
    const secretsStore = new Map();
    const workspaceStateStore = new Map();
    const globalStateStore = new Map();
    const subscriptions = [];
    const storageUri = vscode.Uri.parse(`${uri}/storage`);
    const globalStorageUri = vscode.Uri.parse(`${uri}/global`);
    const logUri = vscode.Uri.parse(`${uri}/logs`);
    const defaultExtensionMode = (vscode.ExtensionMode?.Test ?? 3);
    const extensionMode = overrides.extensionMode ?? defaultExtensionMode;
    const base = {
        subscriptions,
        extensionUri: vscode.Uri.parse(uri),
        extensionPath: storageBasePath,
        extensionMode,
        storageUri,
        storagePath: `${storageBasePath}/storage`,
        globalStorageUri,
        globalStoragePath: `${storageBasePath}/global`,
        logUri,
        logPath: `${storageBasePath}/logs`,
        environmentVariableCollection: overrides.environmentVariableCollection ??
            {},
        secrets: createSecrets(secretsStore),
        workspaceState: createMemento(workspaceStateStore),
        globalState: createMemento(globalStateStore),
        asAbsolutePath(relativePath) {
            if (/^\w+:\/\//.test(relativePath) || relativePath.startsWith("/")) {
                return relativePath;
            }
            return `${storageBasePath}/${relativePath}`;
        },
    };
    return {
        ...base,
        ...overrides,
        subscriptions: overrides.subscriptions ?? subscriptions,
    };
}
//# sourceMappingURL=extension-context.js.map
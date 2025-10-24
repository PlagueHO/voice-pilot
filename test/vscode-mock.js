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
exports.FileType = exports.LogLevel = exports.ExtensionContext = exports.EventEmitter = exports.Disposable = exports.Uri = exports.extensions = exports.commands = exports.workspace = exports.window = exports.OutputChannel = void 0;
// Mock VS Code API for unit tests
const fsp = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const normaliseFsPath = (input) => path.resolve(input);
const toUriPath = (fsPath) => {
    const normalised = normaliseFsPath(fsPath).split(path.sep).join(path.posix.sep);
    return normalised.startsWith("/") ? normalised : `/${normalised}`;
};
const toUriString = (fsPath) => `file://${toUriPath(fsPath)}`;
const createMockUri = (components) => {
    const scheme = components.scheme ?? "file";
    const fsPath = normaliseFsPath(components.fsPath);
    const uriPath = components.path ?? toUriPath(fsPath);
    const authority = components.authority ?? "";
    const query = components.query ?? "";
    const fragment = components.fragment ?? "";
    return {
        scheme,
        authority,
        path: uriPath,
        fsPath,
        query,
        fragment,
        toString: () => {
            if (scheme === "file") {
                return toUriString(fsPath);
            }
            const base = `${scheme}://${authority}${uriPath}`;
            const querySuffix = query ? `?${query}` : "";
            const fragmentSuffix = fragment ? `#${fragment}` : "";
            return `${base}${querySuffix}${fragmentSuffix}`;
        },
        toJSON: () => {
            if (scheme === "file") {
                return toUriString(fsPath);
            }
            const querySuffix = query ? `?${query}` : "";
            const fragmentSuffix = fragment ? `#${fragment}` : "";
            return `${scheme}://${authority}${uriPath}${querySuffix}${fragmentSuffix}`;
        },
        with: (changes) => createMockUri({
            scheme: changes.scheme ?? scheme,
            authority: changes.authority ?? authority,
            fsPath: changes.fsPath ?? fsPath,
            path: changes.path ?? uriPath,
            query: changes.query ?? query,
            fragment: changes.fragment ?? fragment,
        }),
    };
};
const createFileUri = (fsPath) => createMockUri({ fsPath });
const parseUri = (value) => {
    if (value.startsWith("file://")) {
        const withoutScheme = value.replace(/^file:\/\//, "");
        const decoded = decodeURIComponent(withoutScheme);
        return createFileUri(decoded);
    }
    try {
        const url = new URL(value);
        return createMockUri({
            scheme: url.protocol.replace(/:$/, ""),
            authority: url.host,
            path: url.pathname,
            fsPath: url.pathname,
            query: url.search.replace(/^\?/, ""),
            fragment: url.hash.replace(/^#/, ""),
        });
    }
    catch {
        return createFileUri(value);
    }
};
const ensureUint8Array = (buffer) => buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
const OutputChannel = class {
    appendLine(value) { }
    append(value) { }
    clear() { }
    show() { }
    hide() { }
    dispose() { }
};
exports.OutputChannel = OutputChannel;
exports.window = {
    createOutputChannel: (name) => new exports.OutputChannel(),
    showErrorMessage: (message) => Promise.resolve(undefined),
    showWarningMessage: (message) => Promise.resolve(undefined),
    showInformationMessage: (message) => Promise.resolve(undefined),
};
exports.workspace = {
    onDidChangeConfiguration: () => ({ dispose: () => { } }),
    getConfiguration: () => ({
        get: () => undefined,
        has: () => false,
        inspect: () => undefined,
        update: () => Promise.resolve(),
    }),
    workspaceFolders: [],
    fs: {
        async createDirectory(uri) {
            await fsp.mkdir(uri.fsPath, { recursive: true });
        },
        async writeFile(uri, content) {
            await fsp.mkdir(path.dirname(uri.fsPath), { recursive: true });
            await fsp.writeFile(uri.fsPath, Buffer.from(content));
        },
        async readFile(uri) {
            const data = await fsp.readFile(uri.fsPath);
            return ensureUint8Array(data);
        },
        async delete(uri, options) {
            await fsp.rm(uri.fsPath, { recursive: options?.recursive ?? false, force: true });
        },
        async readDirectory(uri) {
            try {
                const directory = await fsp.readdir(uri.fsPath, { withFileTypes: true });
                return directory.map((entry) => [
                    entry.name,
                    entry.isDirectory()
                        ? exports.FileType.Directory
                        : entry.isFile()
                            ? exports.FileType.File
                            : exports.FileType.Unknown,
                ]);
            }
            catch (error) {
                if (error?.code === "ENOENT") {
                    return [];
                }
                throw error;
            }
        },
    },
};
exports.commands = {
    registerCommand: () => ({ dispose: () => { } }),
    executeCommand: () => Promise.resolve(),
};
exports.extensions = {
    getExtension: () => undefined,
};
exports.Uri = {
    parse: (value) => parseUri(value),
    file: (fsPath) => createFileUri(fsPath),
    joinPath: (base, ...segments) => createFileUri(path.join(base.fsPath, ...segments)),
};
const Disposable = class {
    callOnDispose;
    disposables;
    constructor(onDispose) {
        if (Array.isArray(onDispose)) {
            this.disposables = onDispose;
            this.callOnDispose = undefined;
        }
        else {
            this.callOnDispose = onDispose;
            this.disposables = undefined;
        }
    }
    dispose() {
        if (typeof this.callOnDispose === "function") {
            try {
                this.callOnDispose();
            }
            catch {
                // Ignore disposal errors in the mock.
            }
            return;
        }
        if (!this.disposables) {
            return;
        }
        for (const disposable of this.disposables) {
            try {
                disposable.dispose();
            }
            catch {
                // Ignore disposal errors in the mock.
            }
        }
    }
    [Symbol.dispose]() {
        this.dispose();
    }
    static from(...disposables) {
        return new exports.Disposable(disposables);
    }
};
exports.Disposable = Disposable;
const EventEmitter = class {
    event = () => ({ dispose: () => { } });
    fire() { }
    dispose() { }
};
exports.EventEmitter = EventEmitter;
const ExtensionContext = class {
    subscriptions = [];
    extensionUri = exports.Uri.parse("file://test");
    globalState = {
        get: () => undefined,
        update: () => Promise.resolve(),
    };
    workspaceState = {
        get: () => undefined,
        update: () => Promise.resolve(),
    };
    secrets = {
        get: () => Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
    };
};
exports.ExtensionContext = ExtensionContext;
exports.LogLevel = {
    Trace: 0,
    Debug: 1,
    Info: 2,
    Warning: 3,
    Error: 4,
    Critical: 5,
    Off: 6,
};
exports.FileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
};
//# sourceMappingURL=vscode-mock.js.map
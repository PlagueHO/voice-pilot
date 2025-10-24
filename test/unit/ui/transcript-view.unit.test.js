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
const vscode = __importStar(require("vscode"));
const transcript_view_1 = require("../../src/../ui/transcript-view");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createPanelStub() {
    const state = {
        html: '',
        disposed: false,
    };
    const stub = {
        webview: {
            get html() {
                return state.html;
            },
            set html(value) {
                state.html = value;
            },
        },
        onDidDispose(handler) {
            state.disposeHandler = handler;
            return { dispose() { } };
        },
        triggerDispose() {
            state.disposed = true;
            state.disposeHandler?.();
        },
        get disposed() {
            return state.disposed;
        },
    };
    const api = {
        webview: stub.webview,
        onDidDispose: stub.onDidDispose,
    };
    return { api, stub };
}
(0, mocha_globals_1.suite)('Unit: TranscriptView', () => {
    const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
    let createPanelCalls = 0;
    let lastPanelStub;
    let viewColumnPatched = false;
    (0, mocha_globals_1.beforeEach)(() => {
        if (!(vscode.ViewColumn)) {
            Object.defineProperty(vscode, 'ViewColumn', {
                configurable: true,
                enumerable: true,
                writable: true,
                value: { Beside: 2 },
            });
            viewColumnPatched = true;
        }
        createPanelCalls = 0;
        lastPanelStub = undefined;
        vscode.window.createWebviewPanel = (_viewType, _title, _showOptions, _options) => {
            createPanelCalls += 1;
            const { api, stub } = createPanelStub();
            lastPanelStub = stub;
            return api;
        };
    });
    (0, mocha_globals_1.afterEach)(() => {
        vscode.window.createWebviewPanel = originalCreateWebviewPanel;
        if (viewColumnPatched) {
            delete vscode.ViewColumn;
            viewColumnPatched = false;
        }
        createPanelCalls = 0;
        lastPanelStub = undefined;
    });
    (0, mocha_globals_1.test)('creates webview panel during construction and seeds initial markup', () => {
        const view = new transcript_view_1.TranscriptView();
        (0, chai_setup_1.expect)(createPanelCalls).to.equal(1);
        const panel = lastPanelStub;
        (0, chai_setup_1.expect)(panel).to.not.be.undefined;
        (0, chai_setup_1.expect)(panel?.webview.html).to.contain('<h1>Transcript</h1>');
        (0, chai_setup_1.expect)(panel?.disposed).to.equal(false);
        // Sanity check: update should append content
        view.updateTranscript('First message');
        (0, chai_setup_1.expect)(panel?.webview.html).to.contain('<div class="message">First message</div>');
    });
    (0, mocha_globals_1.test)('updateTranscript appends new messages to existing markup', () => {
        const view = new transcript_view_1.TranscriptView();
        const panel = lastPanelStub;
        (0, chai_setup_1.expect)(panel).to.not.be.undefined;
        view.updateTranscript('Hello world');
        view.updateTranscript('Another line');
        const html = panel.webview.html;
        const firstMatches = html.match(/<div class="message">Hello world<\/div>/g) ?? [];
        const secondMatches = html.match(/<div class="message">Another line<\/div>/g) ?? [];
        (0, chai_setup_1.expect)(firstMatches).to.have.length(1);
        (0, chai_setup_1.expect)(secondMatches).to.have.length(1);
    });
    (0, mocha_globals_1.test)('disposal clears panel reference and subsequent updates do not mutate html', () => {
        const view = new transcript_view_1.TranscriptView();
        const panel = lastPanelStub;
        view.updateTranscript('Before dispose');
        const beforeDisposeHtml = panel.webview.html;
        panel.triggerDispose();
        (0, chai_setup_1.expect)(panel.disposed).to.equal(true);
        view.updateTranscript('After dispose');
        (0, chai_setup_1.expect)(panel.webview.html).to.equal(beforeDisposeHtml);
        (0, chai_setup_1.expect)(createPanelCalls).to.equal(1);
    });
});
//# sourceMappingURL=transcript-view.unit.test.js.map
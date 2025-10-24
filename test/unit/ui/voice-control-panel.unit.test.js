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
const panelTemplate = __importStar(require("../../src/../ui/templates/voice-control-panel.html"));
const voice_control_panel_1 = require("../../src/../ui/voice-control-panel");
const voice_control_state_1 = require("../../src/../ui/voice-control-state");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const extension_context_1 = require("../../src/utils/extension-context");
function createWebviewViewStub() {
    const posted = [];
    const messageHandlers = [];
    const visibilityHandlers = [];
    const disposeHandlers = [];
    const state = {
        visible: false,
    };
    const webview = {
        html: "",
        options: {},
        cspSource: "vscode-resource://voicepilot-test",
        asWebviewUri(uri) {
            return uri;
        },
        postMessage: async (message) => {
            posted.push(message);
            return true;
        },
        onDidReceiveMessage(handler) {
            messageHandlers.push(handler);
            return {
                dispose() {
                    const index = messageHandlers.indexOf(handler);
                    if (index >= 0) {
                        messageHandlers.splice(index, 1);
                    }
                },
            };
        },
    };
    const view = {
        get visible() {
            return state.visible;
        },
        webview,
        title: "Voice Control",
        show(preserveFocus) {
            state.visible = true;
            visibilityHandlers.forEach((handler) => handler());
        },
        onDidChangeVisibility(handler) {
            visibilityHandlers.push(handler);
            return {
                dispose() {
                    const index = visibilityHandlers.indexOf(handler);
                    if (index >= 0) {
                        visibilityHandlers.splice(index, 1);
                    }
                },
            };
        },
        onDidDispose(handler) {
            disposeHandlers.push(handler);
            return {
                dispose() {
                    const index = disposeHandlers.indexOf(handler);
                    if (index >= 0) {
                        disposeHandlers.splice(index, 1);
                    }
                },
            };
        },
    };
    return {
        view,
        postMessages: posted,
        triggerMessage(message) {
            messageHandlers.forEach((handler) => handler(message));
        },
        triggerVisibility(visible) {
            state.visible = visible;
            visibilityHandlers.forEach((handler) => handler());
        },
        triggerDispose() {
            disposeHandlers.forEach((handler) => handler());
        },
    };
}
async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}
(0, mocha_globals_1.suite)("Unit: VoiceControlPanel", () => {
    const originalRegisterProvider = vscode.window.registerWebviewViewProvider;
    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalRender = panelTemplate.renderVoiceControlPanelHtml;
    let registerInvocations;
    (0, mocha_globals_1.beforeEach)(() => {
        registerInvocations = [];
        panelTemplate.renderVoiceControlPanelHtml = () => "<html>stub</html>";
        vscode.window.registerWebviewViewProvider = (viewType, provider, options) => {
            registerInvocations.push({ viewType, provider, options });
            return { dispose() { } };
        };
        const noopExecuteCommand = async () => undefined;
        vscode.commands.executeCommand = noopExecuteCommand;
    });
    (0, mocha_globals_1.afterEach)(() => {
        panelTemplate.renderVoiceControlPanelHtml = originalRender;
        vscode.window.registerWebviewViewProvider =
            originalRegisterProvider;
        vscode.commands.executeCommand = originalExecuteCommand;
    });
    (0, mocha_globals_1.test)("initialize registers the panel provider exactly once", async () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        await panel.initialize();
        await panel.initialize();
        (0, chai_setup_1.expect)(panel.isInitialized()).to.equal(true);
        (0, chai_setup_1.expect)(registerInvocations).to.have.length(1);
        (0, chai_setup_1.expect)(registerInvocations[0]?.viewType).to.equal(voice_control_panel_1.VoiceControlPanel.viewType);
        panel.dispose();
        (0, chai_setup_1.expect)(panel.isInitialized()).to.equal(false);
    });
    (0, mocha_globals_1.test)("dispose clears handlers and pending state", async () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        await panel.initialize();
        const actionDisposable = panel.onAction(() => { });
        const feedbackDisposable = panel.onFeedback(() => { });
        const audioDisposable = panel.onAudioFeedbackEvent(() => { });
        panel.sendAudioFeedbackControl({
            type: "audioFeedback.control",
            payload: {
                command: "play",
                handleId: "handle-1",
                cueId: "session.start",
                category: "session",
                duckStrategy: "none",
                accessibilityProfile: "standard",
                gain: 1,
                fadeOutMs: 0,
            },
        });
        panel.sendAudioFeedbackState({ degraded: false });
        panel.dispose();
        actionDisposable.dispose();
        feedbackDisposable.dispose();
        audioDisposable.dispose();
        const internal = panel;
        (0, chai_setup_1.expect)(panel.isInitialized()).to.equal(false);
        (0, chai_setup_1.expect)(internal.actionHandlers.size).to.equal(0);
        (0, chai_setup_1.expect)(internal.feedbackHandlers.size).to.equal(0);
        (0, chai_setup_1.expect)(internal.audioFeedbackHandlers.size).to.equal(0);
        (0, chai_setup_1.expect)(internal.pendingMessages).to.have.length(0);
    });
    (0, mocha_globals_1.test)("reveal executes voicepilot view command when view is not yet created", async () => {
        const executed = [];
        const executeCommandStub = async (command, ...args) => {
            executed.push({ command, args });
            return undefined;
        };
        vscode.commands.executeCommand =
            executeCommandStub;
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        await panel.reveal();
        (0, chai_setup_1.expect)(executed).to.have.length(1);
        (0, chai_setup_1.expect)(executed[0]?.command).to.equal("workbench.view.extension.voicepilot");
        (0, chai_setup_1.expect)(panel.isVisible()).to.equal(true);
    });
    (0, mocha_globals_1.test)("updateSession clears fallback state when session ends", () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        const { view, postMessages } = createWebviewViewStub();
        panel.setFallbackState(true, "Network issue");
        panel.resolveWebviewView(view);
        panel.updateSession({ sessionId: null, status: "ready" });
        const internal = panel;
        (0, chai_setup_1.expect)(internal.state.fallbackActive).to.equal(false);
        (0, chai_setup_1.expect)(internal.state.statusMode).to.be.undefined;
        (0, chai_setup_1.expect)(internal.state.statusDetail).to.be.undefined;
        const lastMessage = postMessages.at(-1);
        (0, chai_setup_1.expect)(lastMessage?.type).to.equal("session.update");
        if (lastMessage?.type === "session.update") {
            (0, chai_setup_1.expect)(lastMessage.fallbackActive).to.equal(false);
        }
    });
    (0, mocha_globals_1.test)("appendTranscript generates identifiers and emits truncation notice", () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        const stub = createWebviewViewStub();
        const internal = panel;
        internal.state.transcript = Array.from({ length: voice_control_state_1.MAX_TRANSCRIPT_ENTRIES }, (_, index) => ({
            entryId: `seed-${index}`,
            speaker: "user",
            content: `Seed ${index}`,
            timestamp: new Date(index + 1).toISOString(),
        }));
        internal.state.truncated = false;
        panel.resolveWebviewView(stub.view);
        const pendingEntry = {
            speaker: "voicepilot",
            content: "Latest message",
            partial: true,
        };
        panel.appendTranscript(pendingEntry);
        const nextState = internal.state;
        const appended = nextState.transcript.at(-1);
        (0, chai_setup_1.expect)(nextState.transcript).to.have.length(voice_control_state_1.MAX_TRANSCRIPT_ENTRIES);
        (0, chai_setup_1.expect)(nextState.truncated).to.equal(true);
        (0, chai_setup_1.expect)(appended?.entryId).to.be.a("string");
        (0, chai_setup_1.expect)(appended?.content).to.equal("Latest message");
        const recentMessages = stub.postMessages.slice(-2);
        (0, chai_setup_1.expect)(recentMessages[0]?.type).to.equal("transcript.append");
        (0, chai_setup_1.expect)(recentMessages[1]?.type).to.equal("transcript.truncated");
    });
    (0, mocha_globals_1.test)("panel action handlers acknowledge successful completion", async () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        const stub = createWebviewViewStub();
        const actions = [];
        panel.onAction((action) => {
            actions.push(action);
        });
        panel.resolveWebviewView(stub.view);
        stub.triggerMessage({ type: "panel.action", action: "start" });
        await flushMicrotasks();
        const internal = panel;
        (0, chai_setup_1.expect)(actions).to.deep.equal(["start"]);
        (0, chai_setup_1.expect)(internal.state.pendingAction).to.equal(null);
    });
    (0, mocha_globals_1.test)("panel action errors surface user-facing banner", async () => {
        const context = (0, extension_context_1.createExtensionContextStub)();
        const panel = new voice_control_panel_1.VoiceControlPanel(context);
        const stub = createWebviewViewStub();
        panel.onAction(async () => {
            throw new Error("boom");
        });
        panel.resolveWebviewView(stub.view);
        stub.triggerMessage({ type: "panel.action", action: "stop" });
        await flushMicrotasks();
        const internal = panel;
        (0, chai_setup_1.expect)(internal.state.errorBanner?.code).to.equal("panel-action-failed");
        (0, chai_setup_1.expect)(internal.state.status).to.equal("error");
        (0, chai_setup_1.expect)(internal.state.pendingAction).to.equal(null);
    });
});
//# sourceMappingURL=voice-control-panel.unit.test.js.map
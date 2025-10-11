import * as vscode from "vscode";
import * as panelTemplate from "../../../ui/templates/voice-control-panel.html";
import { VoiceControlPanel } from "../../../ui/voice-control-panel";
import type {
  PanelOutboundMessage,
  TranscriptEntry,
  VoiceControlPanelState,
} from "../../../ui/voice-control-state";
import { MAX_TRANSCRIPT_ENTRIES } from "../../../ui/voice-control-state";
import { expect } from "../../helpers/chai-setup";
import { afterEach, beforeEach, suite, test } from "../../mocha-globals";
import { createExtensionContextStub } from "../../utils/extension-context";

type RegisterWebviewOptions = Parameters<
  typeof vscode.window.registerWebviewViewProvider
>[2];

interface WebviewViewStub {
  view: vscode.WebviewView;
  postMessages: PanelOutboundMessage[];
  triggerMessage(message: unknown): void;
  triggerVisibility(visible: boolean): void;
  triggerDispose(): void;
}

function createWebviewViewStub(): WebviewViewStub {
  const posted: PanelOutboundMessage[] = [];
  const messageHandlers: Array<(message: unknown) => void> = [];
  const visibilityHandlers: Array<() => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const state = {
    visible: false,
  };

  const webview = {
    html: "",
    options: {} as vscode.WebviewOptions,
    cspSource: "vscode-resource://voicepilot-test",
    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return uri;
    },
    postMessage: async (message: unknown): Promise<boolean> => {
      posted.push(message as PanelOutboundMessage);
      return true;
    },
    onDidReceiveMessage(handler: (message: unknown) => void): vscode.Disposable {
      messageHandlers.push(handler);
      return {
        dispose() {
          const index = messageHandlers.indexOf(handler);
          if (index >= 0) {
            messageHandlers.splice(index, 1);
          }
        },
      } as vscode.Disposable;
    },
  } as unknown as vscode.Webview;

  const view = {
    get visible(): boolean {
      return state.visible;
    },
    webview,
    title: "Voice Control",
    show(preserveFocus?: boolean): void {
      state.visible = true;
      visibilityHandlers.forEach((handler) => handler());
    },
    onDidChangeVisibility(handler: () => void): vscode.Disposable {
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
    onDidDispose(handler: () => void): vscode.Disposable {
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
  } as unknown as vscode.WebviewView;

  return {
    view,
    postMessages: posted,
    triggerMessage(message: unknown) {
      messageHandlers.forEach((handler) => handler(message));
    },
    triggerVisibility(visible: boolean) {
      state.visible = visible;
      visibilityHandlers.forEach((handler) => handler());
    },
    triggerDispose() {
      disposeHandlers.forEach((handler) => handler());
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

suite("Unit: VoiceControlPanel", () => {
  const originalRegisterProvider = vscode.window.registerWebviewViewProvider;
  const originalExecuteCommand = vscode.commands.executeCommand;
  const originalRender = panelTemplate.renderVoiceControlPanelHtml;

  let registerInvocations: Array<{
    viewType: string;
    provider: vscode.WebviewViewProvider;
    options?: RegisterWebviewOptions;
  }>;

  beforeEach(() => {
    registerInvocations = [];
    (panelTemplate as { renderVoiceControlPanelHtml: typeof originalRender }).renderVoiceControlPanelHtml = () =>
      "<html>stub</html>";

    (vscode.window as unknown as {
      registerWebviewViewProvider: typeof vscode.window.registerWebviewViewProvider;
    }).registerWebviewViewProvider = (
      viewType: string,
      provider: vscode.WebviewViewProvider,
      options?: RegisterWebviewOptions,
    ) => {
      registerInvocations.push({ viewType, provider, options });
      return { dispose() {} } as vscode.Disposable;
    };

    const noopExecuteCommand: typeof vscode.commands.executeCommand = async <T>(): Promise<T> =>
      undefined as T;

    (vscode.commands as unknown as {
      executeCommand: typeof vscode.commands.executeCommand;
    }).executeCommand = noopExecuteCommand;
  });

  afterEach(() => {
    (panelTemplate as { renderVoiceControlPanelHtml: typeof originalRender }).renderVoiceControlPanelHtml = originalRender;
    (vscode.window as unknown as { registerWebviewViewProvider: typeof vscode.window.registerWebviewViewProvider }).registerWebviewViewProvider =
      originalRegisterProvider;
    (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand = originalExecuteCommand;
  });

  test("initialize registers the panel provider exactly once", async () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);

    await panel.initialize();
    await panel.initialize();

    expect(panel.isInitialized()).to.equal(true);
    expect(registerInvocations).to.have.length(1);
    expect(registerInvocations[0]?.viewType).to.equal(VoiceControlPanel.viewType);

    panel.dispose();
    expect(panel.isInitialized()).to.equal(false);
  });

  test("dispose clears handlers and pending state", async () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);
    await panel.initialize();

    const actionDisposable = panel.onAction(() => {});
    const feedbackDisposable = panel.onFeedback(() => {});
    const audioDisposable = panel.onAudioFeedbackEvent(() => {});

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

    const internal = panel as unknown as {
      actionHandlers: Set<unknown>;
      feedbackHandlers: Set<unknown>;
      audioFeedbackHandlers: Set<unknown>;
      pendingMessages: PanelOutboundMessage[];
    };

    expect(panel.isInitialized()).to.equal(false);
    expect(internal.actionHandlers.size).to.equal(0);
    expect(internal.feedbackHandlers.size).to.equal(0);
    expect(internal.audioFeedbackHandlers.size).to.equal(0);
    expect(internal.pendingMessages).to.have.length(0);
  });

  test("reveal executes voicepilot view command when view is not yet created", async () => {
    const executed: Array<{ command: string; args: unknown[] }> = [];
    const executeCommandStub: typeof vscode.commands.executeCommand = async <T>(
      command: string,
      ...args: unknown[]
    ): Promise<T> => {
      executed.push({ command, args });
      return undefined as T;
    };

    (vscode.commands as unknown as { executeCommand: typeof vscode.commands.executeCommand }).executeCommand =
      executeCommandStub;

    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);

    await panel.reveal();

    expect(executed).to.have.length(1);
    expect(executed[0]?.command).to.equal("workbench.view.extension.voicepilot");
    expect(panel.isVisible()).to.equal(true);
  });

  test("updateSession clears fallback state when session ends", () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);
    const { view, postMessages } = createWebviewViewStub();

    panel.setFallbackState(true, "Network issue");
    panel.resolveWebviewView(view);

    panel.updateSession({ sessionId: null, status: "ready" });

    const internal = panel as unknown as { state: VoiceControlPanelState };

    expect(internal.state.fallbackActive).to.equal(false);
    expect(internal.state.statusMode).to.be.undefined;
    expect(internal.state.statusDetail).to.be.undefined;

    const lastMessage = postMessages.at(-1);
    expect(lastMessage?.type).to.equal("session.update");
    if (lastMessage?.type === "session.update") {
      expect(lastMessage.fallbackActive).to.equal(false);
    }
  });

  test("appendTranscript generates identifiers and emits truncation notice", () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);
    const stub = createWebviewViewStub();

    const internal = panel as unknown as { state: VoiceControlPanelState };
    internal.state.transcript = Array.from({ length: MAX_TRANSCRIPT_ENTRIES }, (_, index) => ({
      entryId: `seed-${index}`,
      speaker: "user" as TranscriptEntry["speaker"],
      content: `Seed ${index}`,
      timestamp: new Date(index + 1).toISOString(),
    }));
    internal.state.truncated = false;

    panel.resolveWebviewView(stub.view);

    const pendingEntry = {
      speaker: "voicepilot",
      content: "Latest message",
      partial: true,
    } as unknown as TranscriptEntry;

    panel.appendTranscript(pendingEntry);

    const nextState = internal.state;
    const appended = nextState.transcript.at(-1);

    expect(nextState.transcript).to.have.length(MAX_TRANSCRIPT_ENTRIES);
    expect(nextState.truncated).to.equal(true);
    expect(appended?.entryId).to.be.a("string");
    expect(appended?.content).to.equal("Latest message");

    const recentMessages = stub.postMessages.slice(-2);
    expect(recentMessages[0]?.type).to.equal("transcript.append");
    expect(recentMessages[1]?.type).to.equal("transcript.truncated");
  });

  test("panel action handlers acknowledge successful completion", async () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);
    const stub = createWebviewViewStub();

    const actions: string[] = [];
    panel.onAction((action) => {
      actions.push(action);
    });

    panel.resolveWebviewView(stub.view);

    stub.triggerMessage({ type: "panel.action", action: "start" });

    await flushMicrotasks();

    const internal = panel as unknown as { state: VoiceControlPanelState };
    expect(actions).to.deep.equal(["start"]);
    expect(internal.state.pendingAction).to.equal(null);
  });

  test("panel action errors surface user-facing banner", async () => {
    const context = createExtensionContextStub();
    const panel = new VoiceControlPanel(context);
    const stub = createWebviewViewStub();

    panel.onAction(async () => {
      throw new Error("boom");
    });

    panel.resolveWebviewView(stub.view);

    stub.triggerMessage({ type: "panel.action", action: "stop" });

    await flushMicrotasks();

    const internal = panel as unknown as { state: VoiceControlPanelState };
    expect(internal.state.errorBanner?.code).to.equal("panel-action-failed");
    expect(internal.state.status).to.equal("error");
    expect(internal.state.pendingAction).to.equal(null);
  });
});

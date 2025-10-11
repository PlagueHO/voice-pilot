import * as vscode from 'vscode';
import { TranscriptView } from '../../../ui/transcript-view';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

type PanelStub = {
  webview: {
    html: string;
  };
  onDidDispose: (handler: () => void) => vscode.Disposable;
  triggerDispose: () => void;
  disposed: boolean;
};

type CreatePanelStubResult = {
  api: vscode.WebviewPanel;
  stub: PanelStub;
};

function createPanelStub(): CreatePanelStubResult {
  const state: { html: string; disposed: boolean; disposeHandler?: () => void } = {
    html: '',
    disposed: false,
  };

  const stub: PanelStub = {
    webview: {
      get html() {
        return state.html;
      },
      set html(value: string) {
        state.html = value;
      },
    },
    onDidDispose(handler: () => void) {
      state.disposeHandler = handler;
      return { dispose() {/* noop */} };
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
  } as unknown as vscode.WebviewPanel;

  return { api, stub };
}

suite('Unit: TranscriptView', () => {
  const originalCreateWebviewPanel = vscode.window.createWebviewPanel;
  const originalViewColumnDescriptor = Object.getOwnPropertyDescriptor(vscode, 'ViewColumn');
  let createPanelCalls = 0;
  let lastPanelStub: PanelStub | undefined;

  beforeEach(() => {
    const currentViewColumn =
      originalViewColumnDescriptor?.get?.call(vscode) ?? originalViewColumnDescriptor?.value ?? (vscode as any).ViewColumn;
    if (!currentViewColumn) {
      Object.defineProperty(vscode, 'ViewColumn', {
        configurable: true,
        value: { Beside: 2 },
      });
    } else if (typeof currentViewColumn === 'object' && currentViewColumn && !(currentViewColumn as any).Beside) {
      Object.defineProperty(vscode, 'ViewColumn', {
        configurable: true,
        value: { ...(currentViewColumn as Record<string, unknown>), Beside: 2 },
      });
    }
    createPanelCalls = 0;
    lastPanelStub = undefined;
    (vscode.window as any).createWebviewPanel = (
      _viewType: string,
      _title: string,
      _showOptions: vscode.ViewColumn,
      _options: vscode.WebviewPanelOptions,
    ) => {
      createPanelCalls += 1;
      const { api, stub } = createPanelStub();
      lastPanelStub = stub;
      return api;
    };
  });

  afterEach(() => {
    (vscode.window as any).createWebviewPanel = originalCreateWebviewPanel;
    if (originalViewColumnDescriptor) {
      Object.defineProperty(vscode, 'ViewColumn', originalViewColumnDescriptor);
    } else {
      delete (vscode as any).ViewColumn;
    }
    createPanelCalls = 0;
    lastPanelStub = undefined;
  });

  test('creates webview panel during construction and seeds initial markup', () => {
    const view = new TranscriptView();

    expect(createPanelCalls).to.equal(1);
    const panel = lastPanelStub;
    expect(panel).to.not.be.undefined;
    expect(panel?.webview.html).to.contain('<h1>Transcript</h1>');
    expect(panel?.disposed).to.equal(false);

    // Sanity check: update should append content
    view.updateTranscript('First message');
    expect(panel?.webview.html).to.contain('<div class="message">First message</div>');
  });

  test('updateTranscript appends new messages to existing markup', () => {
    const view = new TranscriptView();
    const panel = lastPanelStub;
    expect(panel).to.not.be.undefined;

    view.updateTranscript('Hello world');
    view.updateTranscript('Another line');

  const html = panel!.webview.html;
  const firstMatches = html.match(/<div class="message">Hello world<\/div>/g) ?? [];
  const secondMatches = html.match(/<div class="message">Another line<\/div>/g) ?? [];
  expect(firstMatches).to.have.length(1);
  expect(secondMatches).to.have.length(1);
  });

  test('disposal clears panel reference and subsequent updates do not mutate html', () => {
    const view = new TranscriptView();
    const panel = lastPanelStub!;

    view.updateTranscript('Before dispose');
    const beforeDisposeHtml = panel.webview.html;

    panel.triggerDispose();
    expect(panel.disposed).to.equal(true);

    view.updateTranscript('After dispose');
    expect(panel.webview.html).to.equal(beforeDisposeHtml);
    expect(createPanelCalls).to.equal(1);
  });
});

import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';
import { TurnEventDiagnostics } from '../types/conversation';

interface StatusUpdateOptions {
  diagnostics?: TurnEventDiagnostics;
  mode?: string;
  fallback?: boolean;
  detail?: string;
}

export class VoiceControlPanel implements ServiceInitializable {
  private initialized = false;
  private panel: vscode.WebviewPanel | undefined;
  private currentStatus = 'Idle';
  private currentDiagnostics: TurnEventDiagnostics | undefined;
  private currentMode: string | undefined;
  private fallbackActive = false;
  private fallbackReason: string | undefined;
  private currentDetail: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
    this.initialized = false;
  }

  async show(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceControlPanel not initialized');
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'voicepilotConversation',
        'VoicePilot Conversation',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      this.panel.webview.html = this.render();
    }

    this.panel.reveal(vscode.ViewColumn.One);
    this.postStatusUpdate();
  }

  updateTurnStatus(status: string, options?: StatusUpdateOptions): void {
    this.currentStatus = status;
    if (options?.diagnostics !== undefined) {
      this.currentDiagnostics = options.diagnostics;
    }
    if (options?.mode !== undefined) {
      this.currentMode = options.mode;
    }
    if (options?.fallback !== undefined) {
      this.fallbackActive = options.fallback;
    }
    if (options?.detail !== undefined) {
      this.currentDetail = options.detail;
    }

    this.postStatusUpdate();
  }

  updateDiagnostics(diagnostics: TurnEventDiagnostics | undefined): void {
    this.currentDiagnostics = diagnostics;
    this.postStatusUpdate();
  }

  setFallbackState(active: boolean, reason?: string): void {
    this.fallbackActive = active;
    this.fallbackReason = reason;
    this.postStatusUpdate();
  }

  isVisible(): boolean {
    return !!this.panel;
  }

  private postStatusUpdate(): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage({
      type: 'status',
      status: this.currentStatus,
      mode: this.currentMode,
      fallback: this.fallbackActive,
      fallbackReason: this.fallbackReason,
      detail: this.currentDetail,
      diagnostics: this.currentDiagnostics
    });
  }

  private render(): string {
    const nonce = this.getNonce();
    const diagnosticsList = this.currentDiagnostics
      ? this.formatDiagnostics(this.currentDiagnostics)
      : '<li>Waiting for telemetry…</li>';
    const modeLabel = this.currentMode ? `Mode: ${this.currentMode}` : 'Mode: —';
    const statusClass = this.fallbackActive ? 'status warn' : 'status';
    const fallbackBadge = this.fallbackActive
      ? `<span class="badge">${this.fallbackReason ?? 'Server fallback active'}</span>`
      : '';
    const detailBlock = this.currentDetail
      ? `<div id="detail" class="meta detail">${this.currentDetail}</div>`
      : '<div id="detail" class="meta detail"></div>';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>VoicePilot</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
    h2 { margin-top: 0; }
    .status { font-size: 1.4rem; font-weight: 600; margin: 12px 0; }
    .status.warn { color: var(--vscode-notificationsWarningIcon-foreground); }
    .meta { color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .meta.detail { margin-top: 8px; min-height: 18px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 999px; background: var(--vscode-notificationsWarningIcon-foreground); color: var(--vscode-editor-background); font-size: 0.75rem; }
    ul { padding-left: 16px; }
    li { margin-bottom: 4px; }
  </style>
</head>
<body>
  <h2>VoicePilot</h2>
  <div id="mode" class="meta">${modeLabel}</div>
  <div id="status" class="${statusClass}">${this.currentStatus}</div>
  <div id="fallback" class="meta">${fallbackBadge}</div>
  ${detailBlock}
  <h3>Diagnostics</h3>
  <ul id="diagnostics">${diagnosticsList}</ul>
  <script nonce="${nonce}">
    const statusEl = document.getElementById('status');
    const modeEl = document.getElementById('mode');
    const fallbackEl = document.getElementById('fallback');
    const detailEl = document.getElementById('detail');
    const diagnosticsEl = document.getElementById('diagnostics');

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.type !== 'status') {
        return;
      }

      if (typeof message.status === 'string') {
        statusEl.textContent = message.status;
      }

      if (typeof message.fallback === 'boolean') {
        statusEl.classList.toggle('warn', message.fallback);
        if (message.fallback) {
          const badgeText = message.fallbackReason || 'Server fallback active';
          fallbackEl.innerHTML = '<span class="badge">' + badgeText + '</span>';
        } else {
          fallbackEl.innerHTML = '';
        }
      }

      if (typeof message.mode === 'string' && message.mode.length > 0) {
        modeEl.textContent = 'Mode: ' + message.mode;
      } else {
        modeEl.textContent = 'Mode: —';
      }

      if (typeof message.detail === 'string' && message.detail.length > 0) {
        detailEl.textContent = message.detail;
      } else {
        detailEl.textContent = '';
      }

      renderDiagnostics(message.diagnostics);
    });

    function renderDiagnostics(diag) {
      if (!diag) {
        diagnosticsEl.innerHTML = '<li>Waiting for telemetry…</li>';
        return;
      }

      const items = [];
      if (typeof diag.interruptionLatencyMs === 'number') {
        items.push('Interruption latency: ' + diag.interruptionLatencyMs.toFixed(0) + ' ms');
      }
      if (typeof diag.interruptionCount === 'number') {
        items.push('Interruptions observed: ' + diag.interruptionCount);
      }
      if (typeof diag.cooldownActive === 'boolean') {
        items.push('Cooldown active: ' + (diag.cooldownActive ? 'Yes' : 'No'));
      }
      if (typeof diag.fallbackActive === 'boolean') {
        items.push('Fallback active: ' + (diag.fallbackActive ? 'Yes' : 'No'));
      }

      if (items.length === 0) {
        diagnosticsEl.innerHTML = '<li>No diagnostics available.</li>';
        return;
      }

      diagnosticsEl.innerHTML = items.map(text => '<li>' + text + '</li>').join('');
    }

    renderDiagnostics(${this.currentDiagnostics ? JSON.stringify(this.currentDiagnostics) : 'undefined'});
  </script>
</body>
</html>`;
  }

  private formatDiagnostics(diag: TurnEventDiagnostics): string {
    const entries: string[] = [];
    if (typeof diag.interruptionLatencyMs === 'number') {
      entries.push(`<li>Interruption latency: ${diag.interruptionLatencyMs.toFixed(0)} ms</li>`);
    }
    if (typeof diag.interruptionCount === 'number') {
      entries.push(`<li>Interruptions observed: ${diag.interruptionCount}</li>`);
    }
    if (typeof diag.cooldownActive === 'boolean') {
      entries.push(`<li>Cooldown active: ${diag.cooldownActive ? 'Yes' : 'No'}</li>`);
    }
    if (typeof diag.fallbackActive === 'boolean') {
      entries.push(`<li>Fallback active: ${diag.fallbackActive ? 'Yes' : 'No'}</li>`);
    }
    if (entries.length === 0) {
      entries.push('<li>No diagnostics available.</li>');
    }
    return entries.join('');
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 16; i++) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
  }
}

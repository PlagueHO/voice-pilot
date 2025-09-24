import * as vscode from 'vscode';
import { TurnDetectionDiagnostics } from '../audio/turn-detection-coordinator';
import { ServiceInitializable } from '../core/service-initializable';

export class VoiceControlPanel implements ServiceInitializable {
  private initialized = false;
  private panel: vscode.WebviewPanel | undefined;
  private currentStatus = 'Idle';
  private currentDiagnostics: TurnDetectionDiagnostics | undefined;
  private currentMode: string | undefined;
  private fallbackActive = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // TODO: Preload resources or state
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
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
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.html = this.render();
      this.postStatusUpdate();
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postStatusUpdate();
    }
  }

  updateTurnStatus(status: string, options?: { diagnostics?: TurnDetectionDiagnostics; mode?: string; fallback?: boolean }): void {
    this.currentStatus = status;
    this.currentDiagnostics = options?.diagnostics;
    this.currentMode = options?.mode;
    this.fallbackActive = options?.fallback ?? false;
    this.postStatusUpdate();
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
      diagnostics: this.currentDiagnostics
    });
  }

  private render(): string {
    const nonce = this.getNonce();
    const diagnostics = this.currentDiagnostics;
    const diagnosticsList = diagnostics
      ? this.formatDiagnostics(diagnostics)
      : '<li>Waiting for telemetry…</li>';
    const modeLabel = this.currentMode ? `Mode: ${this.currentMode}` : 'Mode: —';
    const fallbackText = this.fallbackActive ? 'Server fallback active' : '';
    const fallbackClass = this.fallbackActive ? 'warn' : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>VoicePilot</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; }
    h2 { margin-top: 0; }
    .status {
      font-size: 1.4rem;
      font-weight: 600;
      margin: 12px 0;
    }
    .status.warn { color: var(--vscode-notificationsWarningIcon-foreground); }
    .meta { color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .badge { display: inline-block; padding: 4px 8px; border-radius: 999px; background: var(--vscode-notificationsWarningIcon-foreground); color: var(--vscode-editor-background); font-size: 0.75rem; }
    ul { padding-left: 16px; }
    li { margin-bottom: 4px; }
  </style>
</head>
<body>
  <h2>VoicePilot</h2>
  <div id="mode" class="meta">${modeLabel}</div>
  <div id="status" class="status ${fallbackClass}">${this.currentStatus}</div>
  <div id="fallback" class="meta">${fallbackText ? `<span class="badge">${fallbackText}</span>` : ''}</div>
  <h3>Diagnostics</h3>
  <ul id="diagnostics">${diagnosticsList}</ul>
  <script nonce="${nonce}">
    const statusEl = document.getElementById('status');
    const modeEl = document.getElementById('mode');
    const fallbackEl = document.getElementById('fallback');
    const diagnosticsEl = document.getElementById('diagnostics');

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message || message.type !== 'status') {
        return;
      }
      if (message.status) {
        statusEl.textContent = message.status;
      }
      if (typeof message.fallback === 'boolean') {
        statusEl.classList.toggle('warn', message.fallback);
        fallbackEl.innerHTML = message.fallback ? '<span class="badge">Server fallback active</span>' : '';
      }
      if (message.mode) {
        modeEl.textContent = 'Mode: ' + message.mode;
      } else {
        modeEl.textContent = 'Mode: —';
      }
      renderDiagnostics(message.diagnostics);
    });

    function renderDiagnostics(diag) {
      if (!diag) {
        diagnosticsEl.innerHTML = '<li>Waiting for telemetry…</li>';
        return;
      }
      const items = [];
      if (typeof diag.avgStartLatencyMs === 'number') {
        items.push('Start latency: ' + diag.avgStartLatencyMs.toFixed(1) + ' ms');
      }
      if (typeof diag.avgStopLatencyMs === 'number') {
        items.push('Stop latency: ' + diag.avgStopLatencyMs.toFixed(1) + ' ms');
      }
      if (typeof diag.missedEvents === 'number') {
        items.push('Missed events: ' + diag.missedEvents);
      }
      if (items.length === 0) {
        diagnosticsEl.innerHTML = '<li>No diagnostics available.</li>';
        return;
      }
      diagnosticsEl.innerHTML = items.map(text => '<li>' + text + '</li>').join('');
    }

    // Render initial diagnostics in case the extension injected content before scripts load
    renderDiagnostics(${diagnostics ? JSON.stringify(diagnostics) : 'undefined'});
  </script>
</body>
</html>`;
  }

  private formatDiagnostics(diag: TurnDetectionDiagnostics): string {
    const entries: string[] = [];
    if (typeof diag.avgStartLatencyMs === 'number') {
      entries.push(`<li>Start latency: ${diag.avgStartLatencyMs.toFixed(1)} ms</li>`);
    }
    if (typeof diag.avgStopLatencyMs === 'number') {
      entries.push(`<li>Stop latency: ${diag.avgStopLatencyMs.toFixed(1)} ms</li>`);
    }
    if (typeof diag.missedEvents === 'number') {
      entries.push(`<li>Missed events: ${diag.missedEvents}</li>`);
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

  isVisible(): boolean {
    return !!this.panel;
  }
}

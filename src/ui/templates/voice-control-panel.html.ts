import * as vscode from 'vscode';
import { PanelStatus, VoiceControlPanelState } from '../voice-control-state';

/**
 * Configuration options used to render the VoicePilot control panel webview.
 * @property webview - The target VS Code webview used for resource resolution.
 * @property extensionUri - Root URI of the extension for locating bundled assets.
 * @property state - Current panel state used to populate dynamic content.
 * @property nonce - CSP nonce applied to script tags for execution permission.
 */
interface RenderOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  state: VoiceControlPanelState;
  nonce: string;
}

const CONNECT_SOURCES = [
  "https://*.openai.azure.com",
  "https://*.azure.com",
  "wss://*.openai.azure.com",
  "wss://*.azure.com"
];

/**
 * Derives a human-friendly status label for a given panel lifecycle state.
 * @param status - Current panel status value.
 * @returns Localized label describing the status to users.
 */
function statusLabel(status: PanelStatus): string {
  switch (status) {
    case 'listening':
      return 'Listening';
    case 'thinking':
      return 'Thinking';
    case 'speaking':
      return 'Speaking';
    case 'error':
      return 'Error';
    case 'copilot-unavailable':
      return 'Copilot Unavailable';
    case 'ready':
    default:
      return 'Ready';
  }
}

/**
 * Formats session metadata for the status card, including start time and elapsed duration.
 * @param state - Panel state containing session identifiers and timing data.
 * @returns Readable session summary or a fallback when no session is active.
 */
function formatSessionMeta(state: VoiceControlPanelState): string {
  if (!state.sessionId) {
    return 'No active session';
  }
  const started = state.sessionStartedAt ? new Date(state.sessionStartedAt).toLocaleTimeString() : 'Unknown start';
  const elapsed = typeof state.elapsedSeconds === 'number' ? `${state.elapsedSeconds}s` : '—';
  return `Session ${state.sessionId.slice(0, 8)} · Started ${started} · Elapsed ${elapsed}`;
}

/**
 * Determines the primary action button label based on session activity.
 * @param state - Panel state used to evaluate session activity and status.
 * @returns Action label instructing the user to start or end a conversation.
 */
function primaryActionLabel(state: VoiceControlPanelState): string {
  const activeStatuses: PanelStatus[] = ['listening', 'thinking', 'speaking'];
  return state.sessionId && activeStatuses.includes(state.status) ? 'End Conversation' : 'Start Conversation';
}

/**
 * Renders the complete VoicePilot control panel HTML for embedding in a webview.
 * @param options - Context required to produce a CSP-compliant document tailored to the current state.
 * @returns Serialized HTML template for the voice control panel.
 */
export function renderVoiceControlPanelHtml(options: RenderOptions): string {
  const { webview, extensionUri, state, nonce } = options;
  const mediaRoot = vscode.Uri.joinPath(extensionUri, 'media');
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'voice-control-panel.js'));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `connect-src ${CONNECT_SOURCES.join(' ')} ${webview.cspSource}`
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VoicePilot</title>
    <style>
      :root {
        color-scheme: light dark;
      }
      body {
        margin: 0;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
      }
      .vp-root {
        display: flex;
        flex-direction: column;
        height: 100vh;
        box-sizing: border-box;
        padding: 12px;
        gap: 12px;
      }
      .vp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .vp-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 1.1rem;
      }
      .vp-status {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px 12px;
        border-radius: 8px;
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-editorWidget-border);
      }
      .vp-status[data-state="listening"] {
        border-color: var(--vscode-testing-iconQueued);
      }
      .vp-status[data-state="thinking"] {
        border-color: var(--vscode-charts-orange);
      }
      .vp-status[data-state="speaking"] {
        border-color: var(--vscode-charts-green);
      }
      .vp-status[data-state="error"] {
        border-color: var(--vscode-editorError-foreground);
      }
      .vp-status-title {
        font-weight: 600;
      }
      .vp-session-meta {
        font-size: 0.85rem;
        color: var(--vscode-descriptionForeground);
      }
      .vp-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 12px;
        border-radius: 6px;
        background: var(--vscode-statusBarItem-warningBackground);
        color: var(--vscode-statusBarItem-warningForeground);
      }
      .vp-banner[hidden] {
        display: none;
      }
      .vp-transcript-container {
        flex: 1 1 auto;
        overflow-y: auto;
        border-radius: 8px;
        border: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
        padding: 12px;
      }
      .vp-transcript {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .vp-entry {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 4px 12px;
      }
      .vp-entry-speaker {
        font-weight: 600;
        color: var(--vscode-descriptionForeground);
      }
      .vp-entry-content {
        line-height: 1.4;
        white-space: pre-wrap;
      }
      .vp-entry[data-partial="true"] .vp-entry-content::after {
        content: ' …';
        opacity: 0.6;
      }
      .vp-footer {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .vp-primary {
        padding: 10px 16px;
        border-radius: 6px;
        border: none;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .vp-primary:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .vp-meta-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.85rem;
        color: var(--vscode-descriptionForeground);
      }
      .vp-mic-indicator[data-state="capturing"]::before {
        content: '●';
        color: var(--vscode-charts-green);
        margin-right: 6px;
      }
      .vp-mic-indicator[data-state="muted"]::before {
        content: '●';
        color: var(--vscode-charts-orange);
        margin-right: 6px;
      }
      .vp-mic-indicator[data-state="permission-denied"]::before {
        content: '●';
        color: var(--vscode-editorError-foreground);
        margin-right: 6px;
      }
      .vp-mic-indicator[data-state="idle"]::before {
        content: '●';
        color: var(--vscode-descriptionForeground);
        margin-right: 6px;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .vp-hint {
        font-size: 0.8rem;
        color: var(--vscode-descriptionForeground);
      }
      button.vp-icon-button {
        background: none;
        border: none;
        cursor: pointer;
        color: inherit;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
      }
      button.vp-icon-button:hover {
        background: var(--vscode-toolbar-hoverBackground);
      }
    </style>
  </head>
  <body>
    <div class="vp-root" data-status="${state.status}">
      <div class="vp-header">
        <div class="vp-title" aria-live="off">
          <span role="img" aria-hidden="true">🎤</span>
          <span>VoicePilot</span>
        </div>
        <div>
          <button id="vp-settings" class="vp-icon-button" title="Open VoicePilot settings" aria-label="Open VoicePilot settings">⚙️</button>
        </div>
      </div>
      <section id="vp-status" class="vp-status" data-state="${state.status}" aria-live="polite">
        <span id="vp-status-text" class="vp-status-title">${statusLabel(state.status)}</span>
        <span id="vp-session-meta" class="vp-session-meta">${formatSessionMeta(state)}</span>
      </section>
      <div id="vp-error-banner" class="vp-banner" hidden>
        <span id="vp-error-text">Error</span>
        <button id="vp-retry" class="vp-icon-button">Retry</button>
      </div>
      <div id="vp-copilot-banner" class="vp-banner" hidden>
        <span>GitHub Copilot Chat is required for full functionality.</span>
        <button id="vp-install-copilot" class="vp-icon-button">Install</button>
      </div>
      <div class="vp-meta-row">
        <span id="vp-mic" class="vp-mic-indicator" data-state="${state.microphoneStatus}">Microphone: ${state.microphoneStatus}</span>
        <span id="vp-countdown" class="vp-countdown">${
          typeof state.renewalCountdownSeconds === 'number'
            ? `Renewal in ${state.renewalCountdownSeconds}s`
            : ''
        }</span>
      </div>
      <div class="vp-transcript-container" role="region" aria-live="off" aria-label="Conversation transcript">
        <ul id="vp-transcript" class="vp-transcript" role="list"></ul>
        <div id="vp-transcript-truncated" class="vp-hint" hidden>Older entries hidden for brevity.</div>
      </div>
      <div class="vp-footer">
        <button id="vp-primary-action" class="vp-primary">${primaryActionLabel(state)}</button>
      </div>
      <div id="vp-live-region" class="sr-only" aria-live="polite"></div>
    </div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}

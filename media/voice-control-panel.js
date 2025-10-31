import { createAudioFeedbackPlayer } from './audio-feedback-player.js';
import { sanitizeHtml } from './sanitize-html.js';

const vscode = acquireVsCodeApi();
const renderStart = performance.now();
let telemetrySent = false;

const state = {
  status: 'ready',
  sessionId: undefined,
  sessionStartedAt: undefined,
  elapsedSeconds: undefined,
  renewalCountdownSeconds: undefined,
  transcript: [],
  copilotAvailable: true,
  microphoneStatus: 'idle',
  errorBanner: undefined,
  truncated: false,
  pendingAction: null
};

const dom = {
  statusSection: document.getElementById('vp-status'),
  statusText: document.getElementById('vp-status-text'),
  sessionMeta: document.getElementById('vp-session-meta'),
  micIndicator: document.getElementById('vp-mic'),
  countdown: document.getElementById('vp-countdown'),
  transcriptList: document.getElementById('vp-transcript'),
  transcriptTruncated: document.getElementById('vp-transcript-truncated'),
  primaryAction: document.getElementById('vp-primary-action'),
  errorBanner: document.getElementById('vp-error-banner'),
  errorText: document.getElementById('vp-error-text'),
  retryButton: document.getElementById('vp-retry'),
  copilotBanner: document.getElementById('vp-copilot-banner'),
  installCopilot: document.getElementById('vp-install-copilot'),
  liveRegion: document.getElementById('vp-live-region'),
  settingsButton: document.getElementById('vp-settings')
};

const audioFeedback = createAudioFeedbackPlayer({
  postMessage: (message) => vscode.postMessage(message)
});

function announce(message) {
  if (!dom.liveRegion) {
    return;
  }
  dom.liveRegion.textContent = '';
  setTimeout(() => {
    dom.liveRegion.textContent = message;
  }, 25);
}

function sanitize(text) {
  return sanitizeHtml(text ?? '');
}

function renderStatus() {
  if (!dom.statusSection || !dom.statusText) {
    return;
  }
  dom.statusSection.dataset.state = state.status;
  dom.statusText.textContent = statusLabel(state.status);
  dom.sessionMeta.textContent = formatSessionMeta();
  announce(dom.statusText.textContent);
}

function renderMic() {
  if (!dom.micIndicator) {
    return;
  }
  dom.micIndicator.dataset.state = state.microphoneStatus;
  dom.micIndicator.textContent = `Microphone: ${friendlyMicLabel(state.microphoneStatus)}`;
}

function renderCountdown() {
  if (!dom.countdown) {
    return;
  }
  dom.countdown.textContent = typeof state.renewalCountdownSeconds === 'number'
    ? `Renewal in ${state.renewalCountdownSeconds}s`
    : '';
}

function renderTranscript() {
  if (!dom.transcriptList) {
    return;
  }
  dom.transcriptList.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.transcript.forEach(entry => {
    const item = document.createElement('li');
    item.className = 'vp-entry';
    item.dataset.partial = entry.partial ? 'true' : 'false';
    item.dataset.entryId = entry.entryId;

    const speaker = document.createElement('span');
    speaker.className = 'vp-entry-speaker';
    speaker.textContent = speakerLabel(entry.speaker);
    item.appendChild(speaker);

    const content = document.createElement('span');
    content.className = 'vp-entry-content';
    content.innerHTML = sanitize(entry.content ?? '');
    item.appendChild(content);

    fragment.appendChild(item);
  });
  dom.transcriptList.appendChild(fragment);

  if (dom.transcriptTruncated) {
    dom.transcriptTruncated.hidden = !state.truncated;
  }

  if (state.transcript.length > 0) {
    dom.transcriptList.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }
}

function removeTranscript(entryId) {
  state.transcript = state.transcript.filter(entry => entry.entryId !== entryId);
  if (!dom.transcriptList) {
    return;
  }
  const node = dom.transcriptList.querySelector(`li[data-entry-id="${entryId}"]`);
  node?.remove();
}

function renderErrorBanner() {
  if (!dom.errorBanner || !dom.errorText) {
    return;
  }
  if (state.errorBanner) {
    dom.errorBanner.hidden = false;
    dom.errorText.textContent = `${state.errorBanner.summary}${state.errorBanner.remediation ? ` · ${state.errorBanner.remediation}` : ''}`;
  } else {
    dom.errorBanner.hidden = true;
    dom.errorText.textContent = '';
  }
}

function renderCopilotBanner() {
  if (!dom.copilotBanner) {
    return;
  }
  dom.copilotBanner.hidden = state.copilotAvailable;
  if (!state.copilotAvailable) {
    announce('GitHub Copilot Chat not installed. Install to enable full capability.');
  }
}

function renderPrimaryAction() {
  if (!dom.primaryAction) {
    return;
  }
  const label = computePrimaryLabel();
  dom.primaryAction.textContent = label;
  dom.primaryAction.disabled = Boolean(state.pendingAction);
}

function computePrimaryLabel() {
  const activeStatuses = ['listening', 'thinking', 'speaking'];
  if (state.sessionId && activeStatuses.includes(state.status)) {
    return 'End Conversation';
  }
  return 'Start Conversation';
}

function formatSessionMeta() {
  if (!state.sessionId) {
    return 'No active session';
  }
  const started = state.sessionStartedAt ? new Date(state.sessionStartedAt).toLocaleTimeString() : 'Unknown start';
  const elapsed = typeof state.elapsedSeconds === 'number' ? `${state.elapsedSeconds}s elapsed` : 'Elapsed time unavailable';
  return `Session ${state.sessionId.slice(0, 8)} · Started ${started} · ${elapsed}`;
}

function statusLabel(status) {
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
    default:
      return 'Ready';
  }
}

function speakerLabel(speaker) {
  switch (speaker) {
    case 'user':
      return '👤 User';
    case 'copilot':
      return '🤖 Copilot';
    default:
      return '🎤 Agent Voice';
  }
}

function friendlyMicLabel(status) {
  switch (status) {
    case 'capturing':
      return 'Capturing';
    case 'muted':
      return 'Muted';
    case 'permission-denied':
      return 'Permission denied';
    default:
      return 'Idle';
  }
}

function applyTranscript(entry) {
  const idx = state.transcript.findIndex(item => item.entryId === entry.entryId);
  if (idx >= 0) {
    state.transcript[idx] = { ...state.transcript[idx], ...entry };
  } else {
    state.transcript.push(entry);
  }
  if (state.transcript.length > 50) {
    state.transcript = state.transcript.slice(state.transcript.length - 50);
    state.truncated = true;
  }
}

function commitTranscript(entryId, content, confidence) {
  const idx = state.transcript.findIndex(item => item.entryId === entryId);
  if (idx < 0) {
    return;
  }
  state.transcript[idx] = {
    ...state.transcript[idx],
    content,
    confidence,
    partial: false
  };
}

function setPrimaryAction(action) {
  state.pendingAction = action;
  renderPrimaryAction();
}

function handlePrimaryActionClick() {
  const activeStatuses = ['listening', 'thinking', 'speaking'];
  const action = state.sessionId && activeStatuses.includes(state.status) ? 'stop' : 'start';
  setPrimaryAction(action);
  vscode.postMessage({ type: 'panel.action', action });
}

function handleSettingsClick() {
  vscode.postMessage({ type: 'panel.action', action: 'configure' });
}

function handleRetryClick() {
  setPrimaryAction('start');
  vscode.postMessage({ type: 'panel.action', action: 'start' });
}

function handleInstallCopilot() {
  vscode.postMessage({ type: 'panel.action', action: 'configure' });
}

function applySessionUpdate(message) {
  if (typeof message.sessionId !== 'undefined') {
    state.sessionId = message.sessionId || undefined;
  }
  if (typeof message.status === 'string') {
    state.status = message.status;
  }
  if (typeof message.sessionStartedAt === 'string') {
    state.sessionStartedAt = message.sessionStartedAt;
  } else if (message.sessionStartedAt === null) {
    state.sessionStartedAt = undefined;
  }
  if (typeof message.elapsedSeconds === 'number') {
    state.elapsedSeconds = message.elapsedSeconds;
  }
  if (typeof message.renewalCountdownSeconds === 'number') {
    state.renewalCountdownSeconds = message.renewalCountdownSeconds;
  }
  if (message.error) {
    state.errorBanner = message.error;
  } else {
    state.errorBanner = undefined;
  }
  state.pendingAction = null;
  renderStatus();
  renderCountdown();
  renderErrorBanner();
  renderPrimaryAction();
}

function applyInitialize(initialState) {
  Object.assign(state, initialState);
  renderStatus();
  renderMic();
  renderCountdown();
  renderTranscript();
  renderErrorBanner();
  renderCopilotBanner();
  renderPrimaryAction();
}

function emitRenderTelemetry(reason = 'panel.ready') {
  if (telemetrySent) {
    return;
  }
  telemetrySent = true;
  const durationMs = performance.now() - renderStart;
  vscode.postMessage({
    type: 'panel.feedback',
    kind: 'telemetry',
    detail: {
      event: reason,
      durationMs
    }
  });
}

window.addEventListener('message', event => {
  const message = event.data;
  if (!message || typeof message.type !== 'string') {
    return;
  }

  switch (message.type) {
    case 'panel.initialize':
      applyInitialize(message.state);
      break;
    case 'session.update':
      applySessionUpdate(message);
      break;
    case 'transcript.append':
      applyTranscript(message.entry);
      renderTranscript();
      break;
    case 'transcript.commit':
      commitTranscript(message.entryId, message.content, message.confidence);
      renderTranscript();
      break;
    case 'transcript.remove':
      removeTranscript(message.entryId);
      break;
    case 'transcript.truncated':
      state.truncated = true;
      if (dom.transcriptTruncated) {
        dom.transcriptTruncated.hidden = false;
      }
      break;
    case 'audio.status':
      state.microphoneStatus = message.microphoneStatus;
      renderMic();
      break;
    case 'copilot.availability':
      state.copilotAvailable = message.available;
      renderCopilotBanner();
      break;
    case 'audioFeedback.control':
      audioFeedback.handleControl(message);
      break;
    case 'audioFeedback.state':
      audioFeedback.updateState(message.payload);
      if (message.payload?.degraded) {
        announce('Audio feedback temporarily unavailable');
      } else {
        announce('Audio feedback restored');
      }
      break;
    default:
      break;
  }
});

if (dom.primaryAction) {
  dom.primaryAction.addEventListener('click', handlePrimaryActionClick);
}
if (dom.retryButton) {
  dom.retryButton.addEventListener('click', handleRetryClick);
}
if (dom.installCopilot) {
  dom.installCopilot.addEventListener('click', handleInstallCopilot);
}
if (dom.settingsButton) {
  dom.settingsButton.addEventListener('click', handleSettingsClick);
}

window.addEventListener('unload', () => {
  audioFeedback.dispose();
});

renderStatus();
renderMic();
renderCountdown();
renderTranscript();
renderCopilotBanner();
renderPrimaryAction();
requestAnimationFrame(() => emitRenderTelemetry());

---
title: UI Sidebar Panel & Layout
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
tags: [design, ui, webview, accessibility, vscode]
---

<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the VoicePilot sidebar panel that delivers the primary conversational user interface inside VS Code. It covers the layout, interaction model, status semantics, accessibility expectations, and integration contracts that allow the panel to coordinate with session management, audio pipeline, and Copilot-aware services while respecting extension lifecycle guarantees.

## 1. Purpose & Scope

The specification establishes authoritative requirements for the VoicePilot sidebar panel (`voicepilot.voiceControl`) including:

- Activity bar container and webview lifecycle defined in SP-001 (extension activation) with lazy initialization.
- Session-aware state presentation and controls coordinated with SP-005 (session management & renewal).
- Audio pipeline feedback and microphone permission handling consistent with SP-007 (audio capture).
- Graceful Copilot availability feedback aligned with design guidelines in `docs/design/UI.md` and `docs/design/COMPONENTS.md`.
- Security posture and CSP boundaries referencing Azure OpenAI realtime integration material in `docs/design/COMPONENTS.md` and TECHNICAL-REFERENCE-INDEX.

**Intended Audience**: Extension UI engineers, QA engineers, accessibility reviewers, and design stakeholders.

**Assumptions**:

- Extension controller, session manager, and audio services expose the interfaces defined in SP-001, SP-005, and SP-007.
- GitHub Copilot Chat extension may or may not be installed at runtime.
- VS Code webview APIs and messaging infrastructure are available; no direct DOM access exists from the extension host.
- VoicePilot relies on Azure OpenAI realtime transport for conversational flow; degraded mode must be communicated when unavailable.

## 2. Definitions

- **Voice Control Panel**: Webview-backed sidebar registered under `voicepilot.voiceControl` providing conversational UI.
- **Conversation State Indicator**: Visual element reflecting session state (Ready, Listening, Thinking, Speaking, Error, Copilot Unavailable).
- **Transcript Stream**: Scrollable conversation history with speaker attribution and streaming deltas.
- **Degraded Copilot Mode**: UI mode activated when GitHub Copilot Chat APIs are unavailable; panel offers install guidance.
- **Session Banner**: Inline surface showing active session metadata (elapsed time, renewal status).
- **Panel Action Button**: Primary control toggling between “Start Conversation” and “End Conversation”.
- **Accessibility Announcer**: ARIA live region broadcasting status changes for assistive technology.
- **Panel Message**: Structured payload exchanged between extension host and webview for state synchronization.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Panel SHALL register as a webview view provider with ID `voicepilot.voiceControl` and initialize lazily after extension activation.
- **REQ-002**: Panel SHALL render the activity bar icon states defined in `docs/design/UI.md`, including inactive, active, listening, speaking, thinking, and error.
- **REQ-003**: Panel SHALL expose a header with status indicator, settings affordance, and session summary sourced from SessionManager events (SP-005).
- **REQ-004**: Panel SHALL provide a primary action button that toggles between “Start Conversation” and “End Conversation” based on active session state.
- **REQ-005**: Panel SHALL stream transcript entries with speaker attribution (👤 User, 🎤 VoicePilot, 🤖 Copilot) and support incremental updates.
- **REQ-006**: Panel SHALL display WebRTC/audio feedback (listening, thinking, speaking) derived from Audio Capture Pipeline metrics (SP-007) without exposing raw device identifiers.
- **REQ-007**: Panel SHALL surface a degraded Copilot banner when `voicepilot.copilotAvailable` context key is false, including CTA to install Copilot Chat.
- **REQ-008**: Panel SHALL persist the last 50 transcript entries per session in memory for quick redisplay; older entries MAY be truncated with user notification.
- **REQ-009**: Panel SHALL respect VS Code theme tokens, supporting light, dark, and high-contrast themes without manual overrides.
- **SEC-001**: Panel webview SHALL enforce a CSP that restricts scripts to inline hash-based bundles and connects only to approved Azure OpenAI domains listed in TECHNICAL-REFERENCE-INDEX.
- **SEC-002**: Panel SHALL sanitise all inbound transcript text using DOMPurify (or equivalent) before rendering to mitigate HTML/JS injection.
- **CON-001**: Panel initial load time MUST be less than 1.5 seconds on reference hardware (VS Code baseline) after activation event.
- **CON-002**: Panel MUST operate without persistent storage dependencies; all session data SHALL be kept in-memory per VS Code instance.
- **CON-003**: Panel MUST not request microphone access directly; it SHALL delegate to Audio Capture webview client per SP-007 messaging contracts.
- **GUD-001**: Follow modular component structure (`VoiceControlPanel.ts`, dedicated message handlers, presentational components) to align with project architecture.
- **GUD-002**: Provide structured logging (debug level) for user actions, state transitions, and error surfaces using shared logger.
- **GUD-003**: Use VS Code `setState` for minimal persistence (e.g., scroll position) while avoiding large payloads.
- **PAT-001**: Apply MVVM-style separation between message-handling controller and presentation layer to enable testing.
- **PAT-002**: Use state reducer pattern to process incoming messages and derive derived UI state.
- **ACC-001**: Panel SHALL provide keyboard navigation order covering header, transcript, action button, and contextual commands.
- **ACC-002**: Panel SHALL expose ARIA live regions for conversation updates and status changes, ensuring screen-readers receive timely announcements.
- **ACC-003**: Panel SHALL provide minimum 4.5:1 contrast for all text elements and visual status indicators.
- **INT-001**: Panel SHALL subscribe to SessionManager events (`onSessionStateChanged`, `onSessionEnded`, `onSessionError`) and update UI within 250ms.
- **INT-002**: Panel SHALL publish user intents (`start`, `stop`, `configure`) via structured messages to the extension host controller.

## 4. Interfaces & Data Contracts

### Panel State Model

```typescript
export interface VoiceControlPanelState {
  status: 'ready' | 'listening' | 'thinking' | 'speaking' | 'error' | 'copilot-unavailable';
  sessionId?: string;
  sessionStartedAt?: string; // ISO 8601
  elapsedSeconds?: number;
  renewalCountdownSeconds?: number;
  transcript: TranscriptEntry[];
  copilotAvailable: boolean;
  microphoneStatus: 'idle' | 'capturing' | 'muted' | 'permission-denied';
  errorBanner?: UserFacingError;
}

export interface TranscriptEntry {
  entryId: string;
  speaker: 'user' | 'voicepilot' | 'copilot';
  content: string;
  timestamp: string; // ISO 8601
  confidence?: number;
  partial?: boolean; // true when streaming delta
}

export interface UserFacingError {
  code: string;
  summary: string;
  remediation?: string;
}
```

### Host ↔ Panel Message Schema

| Message Type | Direction | Payload | Description |
| --- | --- | --- | --- |
| `panel.initialize` | Host → Panel | `VoiceControlPanelState` | Bootstraps panel state on webview load |
| `session.update` | Host → Panel | `{ sessionId, status, elapsedSeconds, renewalCountdownSeconds }` | Updates session status |
| `transcript.append` | Host → Panel | `TranscriptEntry` | Adds transcript entry; `partial=true` for streaming deltas |
| `transcript.commit` | Host → Panel | `{ entryId, content }` | Finalizes prior partial entry |
| `audio.status` | Host → Panel | `{ microphoneStatus }` | Mirrors audio capture state |
| `copilot.availability` | Host → Panel | `{ available: boolean }` | Toggles degraded Copilot mode |
| `panel.action` | Panel → Host | `{ action: 'start' \| 'stop' \| 'configure' }` | User-triggered actions |
| `panel.feedback` | Panel → Host | `{ type: 'error' \| 'telemetry', detail: any }` | Optional feedback channel |

### Status Indicator Semantics

| Status | Source | Visual Treatment | Description |
| --- | --- | --- | --- |
| `ready` | Extension activation complete | Solid neutral icon, text “Ready” | No active session |
| `listening` | Audio pipeline reports user speaking | Blue glow, subtle animation | Microphone capturing user speech |
| `thinking` | Session manager awaiting AI response | Orange pulse, looping thinking tone | Waiting for Copilot or AI throughput |
| `speaking` | VoicePilot audio output | Green glow, captioned text | VoicePilot narrating response |
| `error` | Session or audio failure | Red banner, retry CTA | Recoverable failure encountered |
| `copilot-unavailable` | Copilot context key false | Amber banner, “Install Copilot Chat” CTA | Copilot features unavailable |

## 5. Acceptance Criteria

- **AC-001**: Given the extension activates, When the user opens the VoicePilot activity bar icon, Then the panel loads within 1.5 seconds and displays the “Ready” state.
- **AC-002**: Given an active session, When the session manager transitions to `listening`, Then the panel updates the status indicator and ARIA live region within 250ms.
- **AC-003**: Given transcript streaming, When partial entries arrive with `partial=true`, Then the panel shows incremental text and replaces it with finalized content once `transcript.commit` is received.
- **AC-004**: Given Copilot Chat is not installed, When Copilot-dependent actions occur, Then the panel shows a degraded banner with an actionable install button.
- **AC-005**: Given the user presses the primary action button, When a session is inactive, Then the panel sends `panel.action` with `start` and disables the button until confirmation arrives.
- **AC-006**: Given microphone permission is denied in the audio client, When `audio.status` reports `permission-denied`, Then the panel displays remediation guidance without triggering additional permission prompts.
- **AC-007**: Given screen reader mode, When status changes occur, Then ARIA live region announces the new state textually without duplicate announcements.
- **AC-008**: Given an error occurs, When `session.update` includes `status: 'error'`, Then the panel renders an error banner with remediation from `UserFacingError` and offers retry.
- **AC-009**: Given 51 transcript entries exist, When a new entry arrives, Then the panel removes the oldest entry and displays a truncation notice.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for state reducer logic and message handlers; integration tests using VS Code webview harness; end-to-end tests validating activation and panel rendering.
- **Frameworks**: Mocha with jsdom/Happy DOM for unit tests; `@vscode/test-electron` for integration; Playwright (headless) for ARIA and interaction validation.
- **Test Data Management**: Mocked session updates, simulated transcript streams, Copilot availability toggles, and audio status events.
- **CI/CD Integration**: Include panel-specific suites in `npm run test:unit` and `npm test`; ensure Playwright smoke test runs in nightly builds.
- **Coverage Requirements**: ≥ 90% branch coverage for reducer/controller modules; 100% for security-sensitive rendering paths (sanitization, CSP enforcement).
- **Performance Testing**: Measure render time and transcript scrolling performance using Playwright trace; fail tests when load time exceeds 1.5 seconds on reference profile.
- **Accessibility Testing**: Integrate axe-core scans and screen-reader emulation flows to verify ARIA roles and contrast ratios.

## 7. Rationale & Context

- **Holistic Conversation Flow**: Mirrors `docs/design/UI.md` emphasis on minimal visuals and audio-first interactions while keeping critical context accessible.
- **Session Alignment**: Relies on SessionManager (SP-005) state machine to ensure UI reflects actual connection and renewal status, preventing user confusion.
- **Audio Awareness**: Uses Audio Capture Pipeline (SP-007) metrics to communicate microphone availability and avoid redundant permission prompts.
- **Extension Lifecycle Compatibility**: Follows SP-001 activation/disposal patterns, ensuring panel registration and teardown do not leak resources.
- **Accessibility Leadership**: Supports hands-free and screen-reader workflows demanded by VoicePilot’s inclusive design goals.
- **Security Posture**: Maintains strict CSP and sanitization to prevent unsafe script execution in a permissive webview environment.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: GitHub Copilot Chat Extension – Provides Copilot responses; absence triggers degraded panel mode and install CTA.

### Third-Party Services

- **SVC-001**: Azure OpenAI GPT Realtime (WebRTC) – Supplies conversation responses; panel reflects transport state but does not connect directly.

### Infrastructure Dependencies

- **INF-001**: VS Code Webview Host – Required for rendering and message passing.
- **INF-002**: VS Code SecretStorage – Indirect dependency for session metadata (through SessionManager notifications).

### Data Dependencies

- **DAT-001**: SessionManager state snapshots – Provide sessionId, status, timers.
- **DAT-002**: Audio pipeline telemetry – Provide microphone status and VAD events.
- **DAT-003**: Copilot availability signals – Provided via VS Code context keys from Copilot adapter.

### Technology Platform Dependencies

- **PLT-001**: VS Code 1.104+ – Required for latest webview API capabilities and theme tokens.
- **PLT-002**: TypeScript 5+ – Required for strict typing of panel controller modules.

### Compliance Dependencies

- **COM-001**: Accessibility guidelines (WCAG 2.1 AA) – Required for contrast and keyboard navigation compliance.

## 9. Examples & Edge Cases

```typescript
// src/ui/voice-control-panel.ts
panelWebview.onDidReceiveMessage(async (message: PanelInboundMessage) => {
  switch (message.type) {
    case 'panel.action':
      await controller.handlePanelAction(message.action);
      break;
    case 'panel.feedback':
      logger.info('Panel feedback', message.detail);
      break;
    default:
      logger.warn('Unhandled panel message', message);
  }
});

sessionManager.onSessionStateChanged(async (event) => {
  panel.postMessage({
    type: 'session.update',
    sessionId: event.sessionId,
    status: event.newState,
    elapsedSeconds: secondsSince(event.sessionInfo.startedAt)
  });
});

// Edge case: Copilot unavailable while session active
if (!copilotAdapter.isAvailable()) {
  panel.postMessage({ type: 'copilot.availability', available: false });
  panel.postMessage({
    type: 'session.update',
    status: 'copilot-unavailable',
    sessionId: currentSession.sessionId
  });
}
```

Edge cases to handle:

1. **Activation Without Session**: Panel loads before any session starts; must show Ready state without errors.
2. **Permission Revocation Mid-Session**: User revokes microphone access; panel must display remediation while session manager attempts recovery.
3. **Session Error During Copilot Unavailability**: Both banners may need stacking; error takes precedence while reminding user about Copilot install.
4. **Rapid Action Toggles**: User clicks “Start Conversation” repeatedly; panel must disable button until acknowledgement arrives to avoid duplicate requests.
5. **Transcript Overflow**: Large conversation requires truncation messaging without losing current session context.

## 10. Validation Criteria

- Panel registration confirmed via VS Code `when` context `voicepilot.activated` toggle.
- CSP validation ensures only whitelisted domains appear in webview network log.
- Transcript sanitizer test suite passes for HTML and markdown inputs.
- Accessibility tooling (axe-core) reports zero critical violations.
- Integration tests confirm session state updates propagate within mandated latency.
- Manual smoke test verifies Copilot degraded banner and CTA flows.
- Performance benchmarks confirm initial load ≤ 1.5s and steady-state updates ≤ 16ms per frame.

## 11. Related Specifications / Further Reading

- SP-001: Core Extension Activation & Lifecycle
- SP-005: Session Management & Renewal
- SP-007: Audio Capture Pipeline Architecture
- `docs/design/UI.md`
- `docs/design/COMPONENTS.md`
- Azure OpenAI Realtime API Quickstart (see Technical Reference Index)

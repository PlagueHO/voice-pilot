---
title: Status & Presence Indicator Semantics
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: Agent Voice Project
tags: [design, ui, telemetry, accessibility, realtime]
---

## Introduction

This specification defines the unified status and presence indicator system for the Agent Voice extension. Indicators provide real-time feedback across the activity bar, sidebar panel, status bar, and webview so that users always understand the current voice conversation state, Azure session health, and Copilot availability. The specification aligns session lifecycle signals (SP-005), conversation state machine transitions (SP-012), and UI design principles (`docs/design/UI.md`, `docs/design/COMPONENTS.md`) to deliver consistent, accessible, and low-latency feedback.

## 1. Purpose & Scope

The purpose of this specification is to standardise indicator semantics, update rules, and delivery mechanisms across all Agent Voice surfaces.

Scope includes:

- Mapping conversation and session states to UI indicators and context keys
- Defining message contracts between the extension host and webviews for status propagation
- Establishing accessibility, latency, and resilience requirements for indicator updates
- Coordinating degraded experiences (e.g., Copilot unavailable, session suspended)
- Providing validation criteria for automated and manual testing

**Intended Audience**: Extension engineers, UI developers, QA automation engineers, and accessibility reviewers.

**Assumptions**:

- Session Manager (SP-005) emits lifecycle events and diagnostics in real time.
- Conversation State Machine (SP-012) produces deterministic state change events for each turn.
- UI layout and visual primitives follow `docs/design/UI.md`.
- Activity bar icon assets and animations exist within `resources/`.
- VS Code context key updates drive conditional command visibility.

## 2. Definitions

- **Indicator Surface**: A UI region that communicates status (activity bar, status bar, Agent Voice sidebar header, transcript area badges).
- **Presence State**: Aggregated status representing the conversation state, session health, and service availability.
- **Context Key**: VS Code command palette boolean or string value that gates UI behaviour (`agentvoice.state`, `agentvoice.copilotAvailable`).
- **Composite Status Message**: Structured payload combining session, conversation, and dependency states for distribution to UI consumers.
- **Degraded Mode**: Operational mode where full functionality is not available (e.g., Copilot missing, session suspended) but the UI remains responsive and instructive.
- **Latency Budget**: Maximum allowed delay between an upstream event and its rendered indicator update.
- **Fallback Glyph**: Static icon displayed when animations are not available or disabled for accessibility reasons.

## 3. Requirements, Constraints & Guidelines

### Core Indicator Requirements

- **REQ-001**: The system SHALL define a canonical list of presence states (`idle`, `listening`, `processing`, `waitingForCopilot`, `speaking`, `suspended`, `error`, `offline`) mapped from the Conversation State Machine transitions (SP-012).
- **REQ-002**: Indicator updates SHALL occur within 150 ms of receiving a state machine event under nominal conditions.
- **REQ-003**: Each presence state SHALL specify localized text, icon glyph, animation profile, and ARIA label consistent across all surfaces.
- **REQ-004**: Indicators SHALL expose a `agentvoice.state` context key reflecting the current presence state string.
- **REQ-005**: Status updates SHALL remain idempotent; duplicate events MUST NOT trigger additional animations or flicker.

### Session & Dependency Requirements

- **SES-001**: When Session Manager (SP-005) reports authentication renewal in progress, indicators SHALL transition to `suspended` with a tooltip describing the pause.
- **SES-002**: When session health degrades (`connectionStatus !== 'healthy'`), the status bar SHALL display a warning badge (⚠️) while the sidebar header shows “⋯ Reconnecting”.
- **SES-003**: If no active session exists, indicators SHALL revert to `idle` and disable conversation controls via context keys.

### Copilot Availability Requirements

- **COP-001**: When the GitHub Copilot Chat extension is unavailable, the Agent Voice panel SHALL display `⋯ Waiting for Copilot (not installed)` and provide an actionable “Install Copilot Chat” command.
- **COP-002**: The `agentvoice.copilotAvailable` context key SHALL be updated synchronously with indicator changes so dependent commands hide gracefully.
- **COP-003**: When Copilot requests exceed timeout thresholds, the presence state SHALL remain `waitingForCopilot` and display a retry hint until the Conversation State Machine transitions back to `listening`.

### Accessibility & UX Requirements

- **ACC-001**: All indicators SHALL provide ARIA labels and live-region announcements (“Agent Voice listening”, “Agent Voice suspended for renewal”).
- **ACC-002**: Activity bar animations SHALL offer reduced motion variants respecting VS Code `window.autoDetectColorScheme` and `workbench.reduceMotion` settings.
- **ACC-003**: Status bar text SHALL adhere to a maximum of 32 characters to preserve screen reader clarity.
- **ACC-004**: Color usage SHALL meet WCAG 2.1 AA contrast ratios in both light and dark themes.

### Performance & Telemetry Requirements

- **PER-001**: Indicator updates SHALL not block the UI thread; asynchronous message passing SHALL be used for webview updates.
- **PER-002**: Indicator telemetry SHALL record transition latency and failure counts but MUST exclude raw transcript content.
- **PER-003**: The system SHALL support batching multiple updates within a 50 ms window to prevent animation thrash during rapid state changes.

### Security Requirements

- **SEC-001**: Status payloads SHALL exclude personally identifiable information and audio transcript text.
- **SEC-002**: Degraded state messages SHALL not reveal credential scope or Azure resource identifiers.
- **SEC-003**: Context keys SHALL be read-only outside the extension host and NEVER exposed to webview scripts except via sanitized messages.

### Constraints

- **CON-001**: Indicator rendering SHALL rely solely on VS Code API primitives (`setStatusBarMessage`, `StatusBarItem`, `WebviewViewProvider`) and SHALL NOT require native modules.
- **CON-002**: All indicator assets SHALL reside under `resources/` and follow VS Code CSP rules when used within webviews.
- **CON-003**: Presence states SHALL be forward-compatible; new states MUST default to the `idle` behaviour if unrecognised by older clients.

### Guidelines & Patterns

- **GUD-001**: Prefer declarative configuration for indicator mappings (JSON/TypeScript map) to simplify testing and future localisation.
- **GUD-002**: Provide extensibility hooks so future specs (SP-044 audio equivalents) can subscribe to the same status bus.
- **PAT-001**: Employ the Observer pattern to broadcast indicator updates to all registered UI consumers (status bar, panel, optional floating widgets).
- **PAT-002**: Use the Presenter pattern within the webview to decouple raw payloads from UI rendering logic.

## 4. Interfaces & Data Contracts

### Presence Payload Schema

```json
{
  "type": "agentvoice.status",
  "payload": {
    "state": "listening",
    "sessionId": "sess-123",
    "since": "2025-09-26T18:42:00.153Z",
    "copilotAvailable": true,
    "latencyMs": 42,
    "message": "● Listening",
    "details": {
      "conversationTurnId": "turn-456",
      "retry": false,
      "renewal": false
    }
  }
}
```

### TypeScript Contracts

```typescript
export type Agent VoicePresenceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'waitingForCopilot'
  | 'speaking'
  | 'suspended'
  | 'error'
  | 'offline'
  | 'interrupted'; // legacy alias that maps to 'listening' visuals

export interface PresenceUpdate {
  state: Agent VoicePresenceState;
  sessionId?: string;
  since: string; // ISO timestamp
  copilotAvailable: boolean;
  latencyMs?: number;
  message: string;
  details: PresenceDetails;
}

export interface PresenceDetails {
  conversationTurnId?: string;
  retry: boolean;
  renewal: boolean;
  errorCode?: string;
  tooltip?: string;
}

export interface IndicatorPresenter {
  applyPresence(update: PresenceUpdate): void;
  applyTheme(theme: 'light' | 'dark', reduceMotion: boolean): void;
  dispose(): void;
}
```

### Indicator Mapping Table

| Presence State | Trigger Source | Sidebar Label | Status Bar Text | Activity Bar Icon | Tooltip / Guidance |
| --- | --- | --- | --- | --- | --- |
| `idle` | Session inactive | "Hands/Eyes Free Planning" | `$(mic) Agent Voice` | Static mic | "Start Conversation" |
| `listening` | CSM → Listening | "● Listening" | `$(unmute) Listening…` | Blue glow | "Agent Voice is listening. Speak anytime." |
| `processing` | CSM → Processing | "⋯ Thinking" | `$(sync) Processing…` | Orange pulse | "Analyzing your request." |
| `waitingForCopilot` | CSM Waiting + Copilot pending | "⋯ Waiting for Copilot" | `$(clock) Waiting for Copilot…` | Orange pulse w/ badge | "Copilot is responding. You may interrupt." |
| `speaking` | TTS streaming | "● Speaking" | `$(megaphone) Responding…` | Green glow | "Agent Voice is responding. Speak to interrupt." |
| `suspended` | Session renewal / diagnostics | "◌ Paused" | `$(debug-pause) Suspended…` | Grey pulse | "Renewing connection. This may take a moment." |
| `error` | Faulted conversation state | "⚠️ Attention Needed" | `$(error) Agent Voice issue` | Red badge | "Check logs. Run diagnostics command." |
| `offline` | Network loss / Azure unreachable | "✖ Offline" | `$(cloud-offline) Offline` | Hollow mic | "Reconnect to resume voice control." |

## 5. Acceptance Criteria

- **AC-001**: Given the conversation transitions to `listening`, When a presence update is emitted, Then the sidebar, status bar, and activity bar icon update within 150 ms and share the label “Listening”.
- **AC-002**: Given the session renews, When Session Manager emits a renewal event, Then indicators enter `suspended`, disable the Start/Stop button via context keys, and resume the previous state after renewal completes.
- **AC-003**: Given Copilot is not installed, When a user attempts a Copilot-dependent action, Then the panel displays the install affordance and the command palette hides Copilot actions by setting `agentvoice.copilotAvailable = false`.
- **AC-004**: Given a network outage, When Session Manager reports `connectionStatus = 'failed'`, Then the presence state becomes `offline`, a persistent status bar warning appears, and the user is offered a retry action.
- **AC-005**: Given reduced motion mode is enabled, When Agent Voice enters `speaking`, Then the activity bar uses the static green icon without animation while the textual labels remain unchanged.
- **AC-006**: Given multiple rapid state changes occur within 100 ms, When the presenter receives batched updates, Then only the latest presence state renders and no flicker is observed.
- **AC-007**: Given a faulted state, When the user opens the Agent Voice panel, Then the header displays remediation guidance sourced from the PresenceDetails tooltip.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for presence mapper logic; integration tests in the extension host verifying status bar and context key updates; webview UI tests using Playwright or VS Code Webview Test Harness.
- **Frameworks**: Mocha with Sinon fake timers for latency assertions; `@vscode/test-electron` for extension host UI validation; Playwright for webview rendering and accessibility snapshot comparisons.
- **Test Data Management**: JSON fixtures representing presence payloads, session health diagnostics, and Copilot availability flags.
- **CI/CD Integration**: Include indicator verification in `npm run test` (integration) and enforce snapshot diffs for the sidebar header markup.
- **Coverage Requirements**: ≥95% coverage on mapper functions and presenter branches; ≥90% accessibility rule coverage via axe-core audits.
- **Performance Testing**: Use the `Test Performance` task to measure indicator propagation latency and assert ≤150 ms average under synthetic load.
- **Accessibility Testing**: Automate screen reader output validation via VS Code Accessibility Insights or similar tooling.

## 7. Rationale & Context

- Consistent indicator semantics reduce cognitive load, satisfying the minimal interface goals outlined in `docs/design/UI.md`.
- Tight integration with Session Manager (SP-005) ensures users understand credential renewal pauses and degraded states without losing trust.
- Aligning presence mapping with the Conversation State Machine (SP-012) prevents divergence between backend state and UI cues, especially during interruptions.
- Accessibility requirements ensure Agent Voice remains usable for screen reader users and those sensitive to motion, matching project inclusivity goals.
- Observer-based distribution (PAT-001) supports future expansion (e.g., floating mini-controller, telemetry dashboards) without coupling UI layers.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Realtime API – Provides the realtime events that trigger state changes.
- **EXT-002**: GitHub Copilot Chat API – Influences `waitingForCopilot` behaviour and availability messaging.

### Third-Party Services

- **SVC-001**: Azure Identity (DefaultAzureCredential) – Indirect dependency via session renewal signalling.

### Infrastructure Dependencies

- **INF-001**: Session Manager (SP-005) – Supplies session lifecycle and health diagnostics.
- **INF-002**: Conversation State Machine (SP-012) – Supplies conversation state transitions.
- **INF-003**: Audio Pipeline Services (SP-007, SP-009, SP-010) – Provide activity cues that map to presence states.

### Data Dependencies

- **DAT-001**: PresenceUpdate payloads – Consumed by UI presenters and telemetry pipelines.
- **DAT-002**: VS Code context keys – Drive command visibility and keyboard shortcuts.

### Technology Platform Dependencies

- **PLT-001**: VS Code Extension API – Required for status bar items, activity bar registration, and context key manipulation.
- **PLT-002**: VS Code Webview Runtime – Required for sidebar rendering of presence states.

### Compliance Dependencies

- **COM-001**: WCAG 2.1 AA – Governs colour contrast and reduced motion behaviour.
- **COM-002**: Future privacy and telemetry policies (SP-027, SP-029) – Will dictate data retention rules for presence analytics.

## 9. Examples & Edge Cases

```typescript
// Example: batching rapid updates during interruption
presenceBus.publish([
  {
    state: 'speaking',
    since: new Date().toISOString(),
    copilotAvailable: true,
    message: '● Speaking',
    details: { conversationTurnId: 'turn-92', retry: false, renewal: false }
  },
  {
    state: 'interrupted' as Agent VoicePresenceState, // backwards-compatible alias
    since: new Date().toISOString(),
    copilotAvailable: true,
    message: '● Listening',
    details: { conversationTurnId: 'turn-92', retry: false, renewal: false }
  }
]);

// Presenter collapses to final update (`listening`) to avoid flicker
```

```json
{
  "type": "agentvoice.status",
  "payload": {
    "state": "offline",
    "since": "2025-09-26T18:55:12.902Z",
    "copilotAvailable": false,
    "message": "✖ Offline",
    "details": {
      "retry": true,
      "tooltip": "Network connection lost. Check Azure status or retry in a moment.",
      "errorCode": "NET-001"
    }
  }
}
```

Edge Cases:

1. **Reduced Motion with Animation Preference**: When `reduceMotion = true`, activity bar uses static glyphs; the presenter logs the preference to telemetry for future accessibility tuning.
2. **Unknown State from Older Clients**: If an outdated webview receives `state = 'calibrating'`, it falls back to `idle` visuals and logs a warning for compatibility diagnostics.
3. **Simultaneous Session Suspension and Copilot Timeout**: PresenceDetails includes both `renewal: true` and `retry: true`, and the tooltip prioritises session recovery messaging per UX guidelines.

## 10. Validation Criteria

- Presence state mappings pass unit tests for every Conversation State Machine transition defined in SP-012.
- Automated integration tests confirm status bar text, context keys, and activity bar icon states for all presence states.
- Accessibility audits confirm ARIA labels and live-region announcements exist for each state.
- Telemetry captures transition latency within the ≤150 ms budget with zero personally identifiable data.
- Manual QA checklist verifies degraded messaging for Copilot unavailable, session suspended, and offline scenarios.

## 11. Related Specifications / Further Reading

- [spec-design-session-management.md](./sp-005-spec-design-session-management.md)
- [spec-architecture-conversation-state-machine.md](./sp-012-spec-architecture-conversation-state-machine.md)
- [docs/design/UI.md](../docs/design/UI.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- [Azure OpenAI Realtime API Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart)

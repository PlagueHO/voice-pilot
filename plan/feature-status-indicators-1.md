---
goal: Implement SP-014 Status & Presence Indicators
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
status: 'Compoleted'
tags: [feature, ui, telemetry]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan delivers the implementation defined in `spec/sp-014-spec-design-status-indicators.md`, wiring conversation/session telemetry into consistent presence indicators across the VoicePilot activity bar, sidebar panel, status bar, and context keys. The work aligns with the Azure OpenAI realtime guidance catalogued in `docs/design/TECHNICAL-REFERENCE-INDEX.md` to ensure low-latency and accessible feedback.

## 1. Requirements & Constraints

- **REQ-001**: Implement the canonical presence state list (`idle`, `listening`, `processing`, `waitingForCopilot`, `speaking`, `suspended`, `error`, `offline`, legacy `interrupted`) exactly as defined in SP-014 Section 3.
- **SES-001**: Reflect Session Manager renewal and health diagnostics (SP-014 SES-001..SES-003) in indicator payloads without exceeding the 150 ms latency budget.
- **COP-001**: Surface GitHub Copilot availability and install affordances per SP-014 COP-001..COP-003 and keep `voicepilot.copilotAvailable` context key in sync.
- **ACC-001**: Provide ARIA labels, live-region announcements, and reduced-motion support as mandated by SP-014 ACC-001..ACC-003 and the UI design guide.
- **PER-001**: Batch and emit presence events asynchronously with recorded latency metrics, meeting SP-014 PER-001..PER-003 performance constraints.
- **SEC-001**: Exclude PII and credential details from presence payloads in accordance with SP-014 SEC-001..SEC-003.
- **CON-001**: Use only VS Code extension host APIs (`StatusBarItem`, context keys, webview messaging) for indicator rendering per SP-014 CON-001.
- **GUD-001**: Maintain a declarative mapping table that UI presenters consume, enabling future localisation (SP-014 GUD-001) and Observer pattern distribution (SP-014 PAT-001).

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish the presence indicator domain model and service bus that ingest session and conversation telemetry.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/types/presence.ts` defining `VoicePilotPresenceState`, `PresenceUpdate`, `PresenceDetails`, and exported `PRESENCE_STATE_MAP` matching SP-014 Section 4 (include tooltip text, icons, context key values). Update `src/types/index.ts` to re-export the new types. |  |  |
| TASK-002 | Implement `PresenceIndicatorService` in `src/services/presence-indicator-service.ts` that maps Conversation State Machine (`conversation/`) and Session Manager (`session/`) events into `PresenceUpdate` objects, enforces the ≤150 ms latency budget, batches rapid transitions, and exposes an Observer API (`onDidChangePresence`, `dispose`). |  |  |
| TASK-003 | Extend `SessionManagerImpl` (in `src/session/session-manager.ts`) to emit structured health snapshots (`connectionStatus`, renewal progress) via existing `onSessionStateChanged`/`onSessionRenewed` hooks so the presence service can derive `suspended` and `offline` states without duplicating logic. Document the emitted payload contract inline. |  |  |

### Implementation Phase 2

- GOAL-002: Wire the presence service into extension host surfaces, webview UI, and VS Code context keys.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Update `src/core/extension-controller.ts` to instantiate `PresenceIndicatorService`, subscribe it to conversation (`onStateChanged`, `onTurnEvent`) and session events, propagate updates to: (a) a new/updated `StatusBar` instance, (b) the Voice Control Panel via a dedicated `applyPresence` method, and (c) VS Code context keys `voicepilot.state`, `voicepilot.copilotAvailable`. Ensure disposables are registered and latency telemetry is logged through `Logger`. |  |  |
| TASK-005 | Refactor `src/ui/status-bar.ts` so it manages the status bar item lifecycle, exposes `renderPresence(update: PresenceUpdate)`, maps states to the icons/text from `PRESENCE_STATE_MAP`, sets warning badges for degraded/ offline states, and handles reduced-motion fallbacks. Instantiate the status bar from the controller and dispose it on teardown. |  |  |
| TASK-006 | Expand `src/ui/voice-control-state.ts` and `src/ui/voice-control-panel.ts` to support the new presence states, derive microphone state using the updated mapping, accept `PresenceUpdate` notifications, and expose tooltips/status detail fields. Modify `voice-control-panel.ts` to forward the presence payload to the webview (`panel.status` message). |  |  |
| TASK-007 | Update `src/ui/templates/voice-control-panel.html.ts` and `media/voice-control-panel.js` to render the new status labels, tooltips, reduced-motion variants, Copilot install CTA, and live-region announcements per SP-014 ACC-001..ACC-003. Ensure dataset attributes (`data-state`) cover all presence states and offline/error banners. |  |  |

### Implementation Phase 3

- GOAL-003: Validate presence behaviour via automated tests, telemetry hooks, and documentation updates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Add unit tests under `test/unit/services/presence-indicator-service.test.ts` covering state mapping, batching, latency measurement, and Copilot availability handling. Use Sinon fake timers to assert the ≤150 ms emission rule. |  |  |
| TASK-009 | Extend `test/extension.lifecycle.test.ts` (or add a new integration test) to verify context keys `voicepilot.state`/`voicepilot.copilotAvailable` and status bar text changes when simulated session/conversation events are emitted. |  |  |
| TASK-010 | Document the new indicator behaviour in `CHANGELOG.md` and ensure `README.md` (usage section) references status feedback. Include instructions for running `npm run lint`, `npm run test:unit`, and `npm run test` as validation criteria. |  |  |

## 3. Alternatives

- **ALT-001**: Attach presence logic directly within `VoiceControlPanel`; rejected because it would duplicate state mapping across UI surfaces and violate SP-014 PAT-001 Observer guidance.
- **ALT-002**: Derive presence status solely from conversation states; rejected because session health (renewals, offline detection) must influence indicators per SES-001..SES-003.

## 4. Dependencies

- **DEP-001**: Conversation State Machine events (`conversation/conversation-state-machine.ts`) for realtime turn transitions.
- **DEP-002**: Session Manager telemetry (`src/session/session-manager.ts`) for renewal, health, and suspension signals.
- **DEP-003**: Azure OpenAI realtime event semantics (see `docs/design/TECHNICAL-REFERENCE-INDEX.md`) to map network failures and Copilot latency into presence states.

## 5. Files

- **FILE-001**: `src/types/presence.ts` (new) — presence domain model and mapping definitions.
- **FILE-002**: `src/services/presence-indicator-service.ts` (new) — Observer service producing presence updates.
- **FILE-003**: `src/core/extension-controller.ts` — bootstrap wiring for presence service, context keys, disposables.
- **FILE-004**: `src/ui/status-bar.ts` — status bar presenter updated to consume `PresenceUpdate`.
- **FILE-005**: `src/ui/voice-control-state.ts`, `src/ui/voice-control-panel.ts`, `src/ui/templates/voice-control-panel.html.ts`, `media/voice-control-panel.js` — sidebar UI updates for presence semantics.
- **FILE-006**: `test/unit/services/presence-indicator-service.test.ts`, `test/extension.lifecycle.test.ts` — automated coverage for presence behaviour.

## 6. Testing

- **TEST-001**: Unit tests for `PresenceIndicatorService` covering mapping, batching, latency, and Copilot flags.
- **TEST-002**: Integration test verifying context keys, status bar updates, and sidebar messaging when mock conversation/session events are fired.
- **TEST-003**: Webview rendering test (Playwright or DOM harness) ensuring ARIA live-region and reduced-motion attributes toggle with presence states.

## 7. Risks & Assumptions

- **RISK-001**: Rapid event bursts may still cause UI flicker if batching is misconfigured; mitigate with deterministic queue processing and unit coverage.
- **RISK-002**: Session manager health data might be insufficient for offline detection; may require augmenting diagnostics API (captured in TASK-003).
- **ASSUMPTION-001**: Conversation and session subsystems already emit events matching SP-005 and SP-012 contracts, enabling presence mapping without refactoring their core logic.

## 8. Related Specifications / Further Reading

- [`spec/sp-014-spec-design-status-indicators.md`](../spec/sp-014-spec-design-status-indicators.md)
- [`spec/sp-005-spec-design-session-management.md`](../spec/sp-005-spec-design-session-management.md)
- [`spec/sp-012-spec-architecture-conversation-state-machine.md`](../spec/sp-012-spec-architecture-conversation-state-machine.md)
- [Azure OpenAI Realtime API Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart)

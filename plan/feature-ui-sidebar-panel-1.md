---
goal: Implement VoicePilot UI Sidebar Panel per SP-013
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
status: 'Completed'
tags: [feature, ui, webview]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This implementation plan defines the deterministic steps required to deliver the VoicePilot sidebar panel described in `spec/sp-013-spec-design-ui-sidebar-panel.md`, ensuring alignment with Azure OpenAI realtime integration guidance and VS Code extension lifecycle contracts.

## 1. Requirements & Constraints

- **REQ-001**: Register `voicepilot.voiceControl` webview provider with lazy initialization as mandated in SP-013 §3.
- **REQ-002**: Render status indicators, transcript stream, and primary action button conforming to SP-013 §3 iconography and behavior.
- **REQ-003**: Implement host ↔ panel message schema defined in SP-013 §4, including `panel.action`, `session.update`, and `copilot.availability` payloads.
- **SEC-001**: Enforce CSP and DOM sanitization per SP-013 §3 (SEC-001, SEC-002) using Azure OpenAI endpoints referenced in `docs/design/TECHNICAL-REFERENCE-INDEX.md`.
- **ACC-001**: Provide keyboard navigation and ARIA live regions per SP-013 §3 (ACC-001 – ACC-003).
- **CON-001**: Meet load-time performance constraint (<1.5s) defined in SP-013 §3 (CON-001).
- **GUD-001**: Follow modular architecture guidance (GUD-001 – GUD-003) aligning with SP-001 lifecycle patterns.
- **PAT-001**: Apply MVVM/state reducer approach (PAT-001, PAT-002) for deterministic state handling.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish foundational webview infrastructure and state management for the sidebar panel.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `src/ui/voice-control-panel.ts` to register `voicepilot.voiceControl` provider via `ExtensionController` initialization sequence, ensuring lazy activation hook. |  |  |
| TASK-002 | Create `src/ui/voice-control-state.ts` exporting `VoiceControlPanelState`, `TranscriptEntry`, and reducer utilities exactly matching SP-013 §4 type definitions. |  |  |
| TASK-003 | Implement CSP-compliant HTML scaffold in `src/ui/templates/voice-control-panel.html.ts` with hashed script registration and allowed domains from TECHNICAL-REFERENCE-INDEX Azure entries. |  |  |
| TASK-004 | Add DOMPurify (or existing sanitization util) integration in webview script to sanitize transcript content prior to render. |  |  |
| TASK-005 | Configure ARIA live regions and keyboard focus order within template to satisfy ACC-001/ACC-002 requirements. |  |  |

### Implementation Phase 2

- GOAL-002: Wire host-panel messaging, session coordination, and Copilot degraded mode feedback.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Implement message handler in `src/ui/voice-control-panel.ts` to process `session.update`, `audio.status`, and `copilot.availability`, updating reducer state and posting to webview. |  |  |
| TASK-007 | Implement webview-side script (`media/voice-control-panel.js`) to dispatch `panel.action` messages and render transcript stream with partial commit handling. |  |  |
| TASK-008 | Integrate with `SessionManager` (`src/session/session-manager.ts`) to emit required events and bind to panel controller; ensure updates occur within 250ms. |  |  |
| TASK-009 | Hook audio telemetry (`src/audio/audio-pipeline-service.ts`) to send `audio.status` messages reflecting capture state and permission errors. |  |  |
| TASK-010 | Implement Copilot availability detection via context key and show degraded banner with install CTA aligned with `docs/design/UI.md`. |  |  |
| TASK-011 | Instrument performance metrics ensuring initial render <1.5s and log warnings if threshold exceeded. |  |  |

## 3. Alternatives

- **ALT-001**: Render panel via React webview bundle—rejected to avoid additional bundler complexity and meet CSP hash requirements.
- **ALT-002**: Implement panel as native VS Code tree view—rejected because streaming transcript and rich status indicators require full webview control.

## 4. Dependencies

- **DEP-001**: TypeScript types and lifecycle scaffolding from SP-001 implementation.
- **DEP-002**: Session event APIs provided by `SessionManager` per SP-005.
- **DEP-003**: Audio telemetry interfaces from SP-007 audio pipeline components.
- **DEP-004**: Azure OpenAI endpoint metadata referenced in `docs/design/TECHNICAL-REFERENCE-INDEX.md` for CSP connect-src.

## 5. Files

- **FILE-001**: `src/ui/voice-control-panel.ts` — host-side panel controller registration and messaging.
- **FILE-002**: `src/ui/voice-control-state.ts` — shared state contracts and reducer logic.
- **FILE-003**: `src/ui/templates/voice-control-panel.html.ts` — CSP-safe HTML template.
- **FILE-004**: `media/voice-control-panel.js` — webview runtime handling messages and rendering UI.
- **FILE-005**: `src/session/session-manager.ts` — event wiring for panel updates.
- **FILE-006**: `src/audio/audio-pipeline-service.ts` — audio status broadcast integration.

## 6. Testing

- **TEST-001**: Add unit tests under `test/ui/voice-control-state.test.ts` covering reducer transitions for all status updates and transcript commits.
- **TEST-002**: Add integration test in `test/ui/voice-control-panel.integration.test.ts` using VS Code test harness to validate message flow and ARIA attributes.
- **TEST-003**: Add Playwright-based smoke test script `tests/e2e/voice-control-panel.spec.ts` verifying initial load performance and Copilot degraded banner behavior.

## 7. Risks & Assumptions

- **RISK-001**: CSP misconfiguration could block realtime WebRTC/WebSocket connections; mitigate by validating domains against TECHNICAL-REFERENCE-INDEX endpoints.
- **RISK-002**: DOMPurify bundle size may impact load time; mitigate by tree-shaking and caching hashed inline script.
- **ASSUMPTION-001**: Existing SessionManager and audio telemetry emit required events without additional latency beyond 250ms budget.

## 8. Related Specifications / Further Reading

- `spec/sp-013-spec-design-ui-sidebar-panel.md`
- `spec/sp-005-spec-design-session-management.md`
- `spec/sp-007-spec-architecture-audio-capture-pipeline.md`
- `docs/design/UI.md`
- `docs/design/TECHNICAL-REFERENCE-INDEX.md`

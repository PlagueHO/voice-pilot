---
goal: Implement Interruption & Turn-Taking Engine per SP-011
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
status: 'Completed'
tags: [feature, audio, realtime, azure]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan defines the deterministic implementation steps required to deliver the Interruption & Turn-Taking Engine described in `spec/sp-011-spec-design-interruption-management.md`, aligning with Azure Realtime API guidance referenced in `docs/design/TECHNICAL-REFERENCE-INDEX.md`.

## 1. Requirements & Constraints

- **REQ-001**: Implement an `InterruptionEngine` service that enforces single active speaker state and exposes event subscriptions as defined in SP-011 Section 4.
- **REQ-002**: Propagate conversation state updates to UI context keys and telemetry consumers within 50 ms of state change.
- **REQ-003**: Cancel active TTS playback within 250 ms when user barge-in is detected using Azure VAD events.
- **REQ-004**: Persist configurable policy profiles via Configuration Manager keys `voicepilot.conversation.policyProfile` and `voicepilot.conversation.interruptionBudgetMs`.
- **SEC-001**: Prevent leakage of raw audio or sensitive interruption metadata outside trusted extension channels; ensure logs redact audio payloads.
- **SEC-002**: Validate configuration inputs to enforce minimum silence duration (≥150 ms) and maximum interruption budget (≤750 ms).
- **CON-001**: Ensure handler execution latency per event remains ≤5 ms by using non-blocking async patterns.
- **CON-002**: Maintain compatibility with existing Session Manager initialization sequence (Config → Auth → Session → UI).
- **GUD-001**: Emit structured metrics (`speechStartLatency`, `interruptionLatency`) for diagnostics using existing logger utilities.
- **PAT-001**: Apply Observer pattern for state propagation and Strategy pattern for policy profile switching according to SP-011 Section 3.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish the core `InterruptionEngine` service and configuration surface.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/session/interruption-engine.ts` implementing the `InterruptionEngine` interface with state machine scaffolding, Observer pattern hooks, and policy loaders per SP-011 Section 4. | ✅ | 2025-09-26 |
| TASK-002 | Update `src/core/ExtensionController.ts` to register the `InterruptionEngine` in the service lifecycle, ensuring initialization occurs after Session Manager and before UI components. | ✅ | 2025-09-26 |
| TASK-003 | Extend `src/config/sections/conversation-section.ts` (create if absent) to expose configuration keys for policy profile, interruption budget, completion grace, and debounce values with validation constraints from REQ-004/SEC-002. | ✅ | 2025-09-26 |

### Implementation Phase 2

- GOAL-002: Integrate the engine with audio pipelines, transcription, and UI signaling.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Wire Azure VAD events from `src/audio/turn-detection-coordinator.ts` (or new module if required) into `InterruptionEngine.handleSpeechEvent`, ensuring message schemas match SP-011 `SpeechActivityEvent`. |  |  |
| TASK-005 | Connect TTS playback callbacks in `src/audio/tts-service.ts` to invoke `handlePlaybackEvent` and apply cancellation logic using `response.cancel` / `output_audio_buffer.clear` to satisfy REQ-003. |  |  |
| TASK-006 | Update `src/ui/voice-control-panel.ts` messaging handlers to react to turn events, set `voicepilot.conversationState` context, and surface fallback notifications when state = `recovering`. |  |  |

### Implementation Phase 3

- GOAL-003: Deliver validation, metrics, and automated testing coverage.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Implement structured metrics emission in `src/audio/audio-metrics.ts` (or new module) to record interruption latency and degraded mode counters sourced from the engine diagnostics. | ✅ | 2025-09-26 |
| TASK-008 | Add unit tests under `src/test/session/interruption-engine.test.ts` covering state transitions, policy validation, and cooldown logic using Mocha/Sinon per SP-011 Section 6. |  |  |
| TASK-009 | Create integration test scenario in `src/test/integration/conversation-flow.test.ts` simulating Azure event sequences to verify UI context updates and barge-in cancellation, leveraging fixtures defined for SP-011 TASK-008. |  |  |

## 3. Alternatives

- **ALT-001**: Implement interruption logic directly inside TTS/STT services; rejected because it violates single-responsibility design and complicates testing.
- **ALT-002**: Depend solely on client-side VAD heuristics; rejected due to reduced accuracy and divergence from Azure Realtime reference guidance (see Technical Reference Index).

## 4. Dependencies

- **DEP-001**: `spec/sp-011-spec-design-interruption-management.md` — authoritative requirements for the engine.
- **DEP-002**: Azure Realtime API reference and quickstart links enumerated in `docs/design/TECHNICAL-REFERENCE-INDEX.md` for event schema and interruption operations.

## 5. Files

- **FILE-001**: `src/session/interruption-engine.ts` — new engine implementation and exports.
- **FILE-002**: `src/config/sections/conversation-section.ts` — configuration definition for policy profiles and budgets.
- **FILE-003**: `src/ui/voice-control-panel.ts` — UI bindings for conversation state updates.
- **FILE-004**: `src/audio/tts-service.ts` — playback cancellation integration.
- **FILE-005**: `src/test/session/interruption-engine.test.ts` — unit test coverage for state transitions.

## 6. Testing

- **TEST-001**: Unit tests verifying state machine transitions, policy validation, and interruption budgets in `src/test/session/interruption-engine.test.ts`.
- **TEST-002**: Integration test simulating Azure VAD and TTS events to validate UI state/context updates in `src/test/integration/conversation-flow.test.ts` executed via `npm run test`.
- **TEST-003**: Performance probe added to `npm run test:perf` measuring average interruption latency using synthetic timestamps emitted by the engine.

## 7. Risks & Assumptions

- **RISK-001**: Azure event latency exceeding 250 ms could prevent meeting interruption budget; mitigation includes hybrid fallback and telemetry alerts per SP-011 Section 3.
- **ASSUMPTION-001**: Existing TTS and STT services expose event hooks required for integration without major refactoring.

## 8. Related Specifications / Further Reading

- [spec/sp-011-spec-design-interruption-management.md](../spec/sp-011-spec-design-interruption-management.md)
- [docs/design/TECHNICAL-REFERENCE-INDEX.md](../docs/design/TECHNICAL-REFERENCE-INDEX.md)

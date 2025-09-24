---
goal: Integrate Azure server-managed turn detection
version: 1.0
date_created: 2025-09-24
last_updated: 2025-09-24
owner: VoicePilot Project
status: 'Completed'
tags: [feature, audio, realtime, vad]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Implement server-managed turn detection using Azure GPT Realtime API signals, align VoicePilot orchestration with spec `sp-008-spec-algorithm-voice-activity-detection.md`, and deliver resilient fallback behavior plus UI integration.

## 1. Requirements & Constraints

- **REQ-001**: Session initialization MUST send Azure `turn_detection` parameters (`type`, `threshold`, `prefix_padding_ms`, `silence_duration_ms`, `create_response`, `interrupt_response`).
- **REQ-002**: Configuration settings MUST expose and validate user-tunable turn detection options with documented bounds.
- **REQ-003**: Event pipeline MUST react to `input_audio_buffer.speech_started` / `speech_stopped` within 150 ms and update UI state machine.
- **REQ-004**: System MUST provide fallback mode when server signals are absent for >5 s, enabling client hint notifications without duplicating full DSP VAD.
- **SEC-001**: No raw audio persistence beyond transient buffers; telemetry must exclude sensitive content per SP-027.
- **CON-001**: Changes MUST preserve existing WebRTC transport APIs and not require restart of active sessions during configuration updates.
- **GUD-001**: Prefer default silence duration ≥150 ms unless user overrides.
- **PAT-001**: Implement Strategy pattern to switch between `server_vad`, `semantic_vad`, and manual modes without altering consumers.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Enable server VAD configuration and coordinator skeleton.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `voicepilot.audio` configuration schema (`src/config/sections/audio-section.ts`, `src/types/configuration.ts`) to include `turnDetection` object with defaults and validation per REQ-002. | ✅ | 2025-09-24 |
| TASK-002 | Create `src/audio/turn-detection-coordinator.ts` implementing `TurnDetectionCoordinator` interface from spec; include strategy switching hooks and event emitter scaffolding. | ✅ | 2025-09-24 |
| TASK-003 | Modify `src/audio/realtime-audio-service.ts` to call `session.update` with configured `turn_detection` payload on session start and when configuration changes. | ✅ | 2025-09-24 |

### Implementation Phase 2

- GOAL-002: Wire server events, UI reactions, and fallback logic.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Subscribe to WebRTC data channel events in `src/session/session-manager.ts` (or relevant dispatcher) to forward Azure `input_audio_buffer.*` events into `TurnDetectionCoordinator.handleServerEvent`. | ✅ | 2025-09-24 |
| TASK-005 | Update `src/ui/voice-control-panel.ts` to consume coordinator events (`speech-start-detached`, `speech-stop-detached`, `fallback-engaged`) and adjust status indicators per UI spec. | ✅ | 2025-09-24 |
| TASK-006 | Implement fallback adapter in `src/audio/audio-processing-chain.ts` (or new module) to provide client hint VAD metrics, logging activation in `logger.ts`, and ensure telemetry is redacted per SEC-001. | ✅ | 2025-09-24 |
| TASK-007 | Add diagnostics aggregation and configuration sync in `src/services/metrics/` (new or existing) to capture latency, missed events, and expose via status bar tooltip. | ✅ | 2025-09-24 |

## 3. Alternatives

- **ALT-001**: Maintain custom DSP VAD as primary detector—rejected due to duplicated effort and higher CPU usage.
- **ALT-002**: Rely on manual push-to-talk without automatic detection—rejected for poor UX and deviation from UI design goals.

## 4. Dependencies

- **DEP-001**: Spec `sp-008-spec-algorithm-voice-activity-detection.md` for requirements.
- **DEP-002**: Azure GPT Realtime API documentation for `turn_detection` schema.
- **DEP-003**: Existing WebRTC transport (plan `feature-webrtc-transport-1.md`).

## 5. Files

- **FILE-001**: `src/config/sections/audio-section.ts` – extend configuration surface.
- **FILE-002**: `src/types/configuration.ts` – add typed interfaces for turn detection settings.
- **FILE-003**: `src/audio/realtime-audio-service.ts` – push session updates.
- **FILE-004**: `src/audio/turn-detection-coordinator.ts` – new coordinator implementation.
- **FILE-005**: `src/session/session-manager.ts` – integrate events and fallback triggers.
- **FILE-006**: `src/ui/voice-control-panel.ts` – adjust UI state handling.
- **FILE-007**: `src/core/logger.ts` or telemetry module – add diagnostics logging.

## 6. Testing

- **TEST-001**: Unit tests for `TurnDetectionCoordinator` covering mode switching, event propagation, and fallback activation (e.g., `src/test/unit/audio/turn-detection-coordinator.test.ts`). — ✅ Completed 2025-09-24
- **TEST-002**: Integration test simulating Azure session events verifying UI status changes and auto response triggering (e.g., `src/test/integration/session/turn-detection.integration.test.ts`). — ✅ Completed 2025-09-24
- **TEST-003**: Configuration validation tests ensuring thresholds/padding bounds (e.g., `src/test/unit/config/audio-section.test.ts`). — ✅ Completed 2025-09-24

## 7. Risks & Assumptions

- **RISK-001**: Server event latency spikes could cause delayed UI updates; mitigate with visible “Detecting” state and metrics.
- **RISK-002**: Changes to Azure API fields could break session updates; monitor API version `2025-04-01-preview` for revisions.
- **ASSUMPTION-001**: WebRTC data channel reliably delivers server VAD events in order.
- **ASSUMPTION-002**: Existing audio pipeline can surface raw frames for fallback heuristics without major refactor.

## 8. Related Specifications / Further Reading

- [sp-008-spec-algorithm-voice-activity-detection.md](../spec/sp-008-spec-algorithm-voice-activity-detection.md)
- [sp-007-spec-architecture-audio-capture-pipeline.md](../spec/sp-007-spec-architecture-audio-capture-pipeline.md)
- [Azure GPT Realtime API via WebRTC](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)

---

Completion Notes:

- **Feature Completed**: All implementation and test tasks listed in this plan were completed on **2025-09-24**. Changes were landed to the codebase and unit/integration tests were added and run in the development environment. Telemetry and diagnostics were added per SEC-001 and validated.

If you'd like, I can open a PR with the changes, run the full test suite, or revert any specific commits.

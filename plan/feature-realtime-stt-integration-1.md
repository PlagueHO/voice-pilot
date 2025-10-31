---
goal: Implement realtime STT service compliant with SP-009
version: 1.0
date_created: 2025-09-25
owner: Agent Voice Project
status: 'Completed'
tags: [feature, audio, realtime, azure]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This implementation plan delivers the realtime speech-to-text (STT) service described in `spec/sp-009-spec-tool-realtime-stt.md`, wiring Azure OpenAI GPT Realtime streaming into the Agent Voice audio pipeline and UI.

## 1. Requirements & Constraints

- **REQ-007**: Issue `session.update` selecting realtime model and enabling `input_audio_transcription` before audio streaming.
- **REQ-008**: Trigger `response.create` after configuring the session to start transcript emission.
- **REQ-009**: Configure `input_audio_transcription.model`, `input_audio_format`, and `turn_detection` in each `session.update` request.
- **STT-010**: Expose configuration for `turn_detection` modes including `create_response`, thresholds, padding, and silence duration.
- **SEC-001**: Do not log raw audio frames or unredacted transcripts to persistent storage.
- **CON-001**: Keep end-to-end transcription latency ≤ 1.5 seconds.
- **GUD-002**: Use structured logging with correlation IDs matching Session Manager and WebRTC connection IDs.
- **PAT-002**: Implement a state machine for utterance lifecycle (`Pending → Partial → Finalized → Archived`).

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish session bootstrap and configuration flow for Azure realtime transcription.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `src/audio/realtime-audio-service.ts` to send `session.update` with model, `input_audio_format: 'pcm16'`, `input_audio_transcription.model`, and `turn_detection` fields before streaming audio; ensure correlation IDs from `SessionManager`. |  |  |
| TASK-002 | Extend `src/audio/realtime-audio-service.ts` to dispatch `response.create` immediately when `turnDetection.createResponse` is false. |  |  |
| TASK-003 | Inject configuration retrieval into `src/config/sections/azure-openai-realtime.ts` (or create new section) to map VS Code settings to `TranscriptionOptions` with API version, realtime model, transcription model, and turn detection defaults. |  |  |

### Implementation Phase 2

- GOAL-002: Implement transcript aggregation, event propagation, and safeguards.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement `SpeechToTextService` in `src/audio/stt-service.ts` adhering to SP-009 interfaces: manage state machine for utterances, emit delta/final events, and handle `session.updated`, `response.output_audio_transcript.delta`, `response.done`, and `input_audio_buffer.speech_*` messages. |  |  |
| TASK-005 | Add structured logging and correlation IDs to `src/core/logger.ts` usage across STT flow, ensuring sensitive transcript text is masked before persistence. |  |  |
| TASK-006 | Update webview message handlers in `src/ui/transcriptView.ts` and `src/ui/VoiceControlPanel.ts` to consume new transcript/status events with debounced updates consistent with SP-009 latency constraints. |  |  |

### Implementation Phase 3

- GOAL-003: Validate transport resilience, configuration, and quality gates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Add reconnection and cache replay handling in `src/audio/connection-recovery-manager.ts`, replaying last 120 seconds of transcripts without duplication. |  |  |
| TASK-008 | Write unit tests in `test/audio/stt-service.test.ts` covering delta aggregation, turn detection flags, `response.create` logic, and profanity/redaction hooks. |  |  |
| TASK-009 | Create integration test harness in `test/integration/realtime-stt.integration.test.ts` simulating Azure realtime websocket events and validating state machine transitions and latency metrics. |  |  |

## 3. Alternatives

- **ALT-001**: Use REST-based batch transcription. Rejected due to latency exceeding CON-001.
- **ALT-002**: Rely solely on client-side VAD without server configuration. Rejected because SP-009 mandates Azure `turn_detection` capabilities until SP-008 ships.

## 4. Dependencies

- **DEP-001**: Azure OpenAI GPT Realtime API endpoint and deployment configured in workspace settings.
- **DEP-002**: Session Manager (`src/session/session-manager.ts`) providing authenticated realtime client and correlation IDs.

## 5. Files

- **FILE-001**: `src/audio/realtime-audio-service.ts` — Session configuration and realtime message handling.
- **FILE-002**: `src/audio/stt-service.ts` — Core STT orchestration and event emission.
- **FILE-003**: `src/config/sections/azure-openai-realtime.ts` — Configuration mapping for realtime transcription options.
- **FILE-004**: `src/ui/transcriptView.ts` and `src/ui/VoiceControlPanel.ts` — UI updates for transcript/status events.
- **FILE-005**: `src/audio/connection-recovery-manager.ts` — Reconnection handling and transcript replay.
- **FILE-006**: `test/audio/stt-service.test.ts` and `test/integration/realtime-stt.integration.test.ts` — Automated test coverage.

## 6. Testing

- **TEST-001**: Unit tests verifying transcript delta aggregation, utterance state transitions, and profanity/redaction masking in `test/audio/stt-service.test.ts`.
- **TEST-002**: Integration test simulating realtime websocket events to confirm `session.update`, `response.create`, and VAD signal propagation in `test/integration/realtime-stt.integration.test.ts`.
- **TEST-003**: UI webview test ensuring debounced transcript rendering and status updates within latency budgets using Playwright fixtures in `test/ui/transcript-view.e2e.test.ts`.

## 7. Risks & Assumptions

- **RISK-001**: Azure realtime API schema changes could break parsing; mitigate with versioned telemetry and schema validation utilities.
- **ASSUMPTION-001**: WebRTC transport already supplies PCM16 24 kHz frames and authenticated connection per SP-006/SP-007.

## 8. Related Specifications / Further Reading

- [`spec/sp-009-spec-tool-realtime-stt.md`](../spec/sp-009-spec-tool-realtime-stt.md)
- [Azure OpenAI GPT Realtime API Reference](https://learn.microsoft.com/azure/ai-services/openai/concepts/realtime-audio-reference)

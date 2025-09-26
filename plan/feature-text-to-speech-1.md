---
goal: Implement Azure Realtime TTS service for VoicePilot
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Audio Team
status: 'Completed'
tags: [feature, audio, azure, tts]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan operationalizes specification `sp-010-spec-tool-text-to-speech.md` to deliver Azure Realtime text-to-speech streaming, aligned with the authoritative resources catalogued in `docs/design/TECHNICAL-REFERENCE-INDEX.md`.

## 1. Requirements & Constraints

- **REQ-001**: Stream PCM16 audio from Azure Realtime within 300 ms initial latency (SP-010 §3 REQ-001/002).
- **REQ-002**: Provide playback controls (start, pause, resume, stop) with immediate buffer flush (SP-010 §3 REQ-003).
- **REQ-003**: Publish speaking-state updates and caption deltas to host/UI (SP-010 §3 REQ-004/006).
- **REQ-004**: Enforce single active session and apply new voice profiles via session restart (SP-010 §3 REQ-005, CON-003).
- **REQ-005**: Default Azure API version `2025-04-01-preview` with override support (SP-010 §3 REQ-010, Acceptance AC-007).
- **SEC-001**: Use ephemeral credentials; never expose long-lived keys to webview (SP-010 §3 SEC-001).
- **SEC-002**: Clear audio buffers after playback/stop to prevent residual data (SP-010 §3 SEC-002).
- **CON-001**: All playback runs inside webview context using Web Audio API (SP-010 §3 CON-001).
- **CON-002**: Provide degraded text-only mode when synthesis fails repeatedly (SP-010 §3 CON-002, Acceptance AC-004).
- **GUD-001**: Enable incremental chunk playback and harmonic smoothing (SP-010 §3 GUD-001/002).
- **PAT-001**: Apply Observer and Command patterns for playback events and controls (SP-010 §3 PAT-001/002).
- **PAT-002**: Use Circuit Breaker for throttling repeated Azure failures (SP-010 §3 PAT-003).

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish typed contracts, configuration surfaces, and initialization wiring for the TTS service.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/types/tts.ts` defining `TextToSpeechService`, `TtsServiceConfig`, `TtsSpeakRequest`, `TtsSpeakHandle`, `TtsPlaybackEvent`, `TtsPlaybackMetrics`, and export registration helpers per SP-010 §4. |  |  |
| TASK-002 | Update `src/types/index.ts` to export the new TTS types without breaking existing exports. |  |  |
| TASK-003 | Extend `src/config/sections/audio-config-section.ts` to include persisted voice profile, API version default (`2025-04-01-preview`), transport selection, and validation hooks referenced in SP-010 §3 REQ-005/010. |  |  |
| TASK-004 | Document new settings and fallback behavior in `README.md` + `docs/design/UI.md` where speaking states are referenced. |  |  |

### Implementation Phase 2

- GOAL-002: Implement Azure Realtime synthesis pipeline, session control, and circuit-breaker logic in the extension host.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Refactor `src/audio/tts-service.ts` to implement the contracts from Phase 1, integrating `AzureOpenAI` realtime session creation with `DefaultAzureCredential`/ephemeral key support per `sp-010` and TECHNICAL-REFERENCE-INDEX Azure links. |  |  |
| TASK-006 | Add session management utilities in `src/audio/realtime-audio-service.ts` or companion module to send `session.update` with modalities, voice, and PCM16 format before `response.create`. |  |  |
| TASK-007 | Implement buffer fade-out, `response.cancel`, `output_audio_buffer.clear`, and `conversation.item.truncate` flows with timing checks (`<250 ms`) inside `src/audio/tts-service.ts`. |  |  |
| TASK-008 | Emit structured playback events via Observer pattern through `src/core/event-bus` (or introduce dedicated dispatcher) ensuring UI consumers receive state deltas. |  |  |
| TASK-009 | Integrate circuit breaker and degraded-mode notifications using `src/core/logger.ts` and existing notification services so repeated failures trigger text-only fallback. |  |  |

### Implementation Phase 3

- GOAL-003: Synchronize host and webview playback, surface controls, and add automated coverage.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Update `src/ui/VoiceControlPanel.ts` and associated webview messaging modules to handle `tts.speak`, `tts.control`, and `tts.event` payloads defined in SP-010 §4, wiring UI state to speaking indicators. |  |  |
| TASK-011 | Implement webview playback pipeline (Web Audio API) in `src/ui/webview/tts-playback.ts` (new file) supporting chunk enqueue, fade-out, and metrics reporting to host. |  |  |
| TASK-012 | Add accessibility caption handling and transcript synchronization in `src/ui/transcriptView.ts` leveraging `response.output_audio_transcript.delta` events. |  |  |
| TASK-013 | Create unit tests under `src/test/audio/tts-service.test.ts` covering state transitions, circuit breaker, and voice-change session restarts. |  |  |
| TASK-014 | Extend integration tests in `src/test/session/` or new `src/test/integration/tts-playback.test.ts` with mocked Azure realtime server verifying UI speaks/interrupts as per AC-001/002/004. |  |  |
| TASK-015 | Add performance probe in `src/test/perf/tts-latency.test.ts` to assert average synthesis-to-playback latency <350 ms. |  |  |

## 3. Alternatives

- **ALT-001**: Use Azure Speech SDK instead of Azure OpenAI Realtime — rejected because project standardizes on GPT Realtime per TECHNICAL-REFERENCE-INDEX and SP-010 scope.
- **ALT-002**: Perform playback in Node via native audio libraries — rejected due to VS Code sandbox restrictions (SP-010 §3 CON-001) and cross-platform complexity.

## 4. Dependencies

- **DEP-001**: Azure OpenAI Realtime API and JavaScript SDK (`openai` package) per TECHNICAL-REFERENCE-INDEX entries.
- **DEP-002**: Azure Identity (`@azure/identity`) for token acquisition and ephemeral key issuance workflows.
- **DEP-003**: Existing Session Manager (`src/session/SessionManager.ts`) for coordinating voice session lifecycle restarts.

## 5. Files

- **FILE-001**: `src/types/tts.ts` — defines TTS interfaces and shared types.
- **FILE-002**: `src/audio/tts-service.ts` — core service implementation aligned with SP-010.
- **FILE-003**: `src/ui/webview/tts-playback.ts` — webview playback pipeline using Web Audio API.
- **FILE-004**: `src/config/sections/audio-config-section.ts` — user configuration and validation.
- **FILE-005**: `src/test/audio/tts-service.test.ts` — unit test coverage.
- **FILE-006**: `docs/design/UI.md` — documentation of speaking state UX updates.

## 6. Testing

- **TEST-001**: Unit tests for TTS service state machine, buffer handling, and voice profile updates (`src/test/audio/tts-service.test.ts`).
- **TEST-002**: Integration tests simulating realtime playback and interruption with mocked Azure server (`src/test/integration/tts-playback.test.ts`).
- **TEST-003**: Performance probe measuring synthesis-to-playback latency budget (`src/test/perf/tts-latency.test.ts`).
- **TEST-004**: Accessibility verification ensuring caption events fire and UI contexts update (`src/test/ui/accessibility-tts.test.ts`).

## 7. Risks & Assumptions

- **RISK-001**: WebRTC support may be unavailable on certain platforms; WebSocket fallback must be validated.
- **RISK-002**: Latency budgets could be exceeded due to network variability; circuit breaker/fallback logic needs robust thresholds.
- **ASSUMPTION-001**: Session Manager exposes hooks required to pause or cancel downstream services without race conditions.
- **ASSUMPTION-002**: Ephemeral key issuance endpoint is available and compliant with SP-004 for secure credential flow.

## 8. Related Specifications / Further Reading

- [`spec/sp-010-spec-tool-text-to-speech.md`](../spec/sp-010-spec-tool-text-to-speech.md)
- [`docs/design/TECHNICAL-REFERENCE-INDEX.md`](../docs/design/TECHNICAL-REFERENCE-INDEX.md)
- [`spec/sp-006-spec-architecture-webrtc-audio.md`](../spec/sp-006-spec-architecture-webrtc-audio.md)

---
goal: Deliver Web Audio API 1.1 & Azure Realtime Compliance Updates
version: 1.0
date_created: 2025-09-30
owner: Agent Voice Project
status: 'Planned'
tags: [feature, audio, realtime, compliance]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This implementation plan schedules the Agent Voice runtime updates required to satisfy the Web Audio API 1.1 contract and Azure GPT Realtime WebRTC guidance. The deliverable aligns `WebRTCAudioService`, session orchestration, and transcript handling with the official TypeScript quickstart and WebRTC how-to documentation while preserving existing extension integrations.

## 1. Requirements & Constraints

- **REQ-001**: Send `session.update`, `conversation.item.create`, and `response.create` events in the Azure-documented order with `modalities`/`output_modalities` set to `['audio','text']` as shown in the TypeScript quickstart.
- **REQ-002**: Capture `response.output_audio_transcript.delta`, `response.output_text.delta`, and `response.done` events and surface them as structured `TranscriptEvent` payloads for the conversation pipeline.
- **REQ-003**: Support optional `voice` selection and session instruction updates sourced from configuration or UI and forward them through the WebRTC data channel.
- **SEC-001**: Ensure ephemeral session keys never reach the webview; refresh client tokens before the 60-second TTL elapses per Azure WebRTC guidance.
- **AUD-001**: Validate AudioWorklet render-quantum sizing (128 frames) and record underrun telemetry compliant with Web Audio API 1.1 expectations.
- **CON-001**: Maintain compatibility with existing `AudioTrackManager` and `SessionManagerImpl` consumers without breaking public APIs.
- **GUD-001**: Follow Microsoft Learn quickstart/how-to examples for event naming, API version `2025-08-28`, and turn-detection defaults.
- **PAT-001**: Centralize realtime speech-to-text handling behind a dedicated service conforming to existing dependency injection patterns in `src/services/`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Align WebRTC session orchestration with Azure GPT Realtime event sequencing.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `src/audio/webrtc-audio-service.ts` to issue `session.update` payloads containing `modalities`, `model`, optional `voice`, and immediately follow with `conversation.item.create` and `response.create` events. Emit guard rails to avoid duplicate `response.create` dispatches. | ✅ | 2025-09-30 |
| TASK-002 | Extend `handleDataChannelMessage` in `src/audio/webrtc-audio-service.ts` to parse `response.output_*` and `response.done` events, normalize event types, and forward them to the realtime STT adapter. | ✅ | 2025-09-30 |
| TASK-003 | Modify `src/audio/webrtc-transport.ts` to pass through instruction updates, voice selection, and API version `2025-04-01-preview` in the sessions URL while preserving existing configuration hooks. | ✅ | 2025-09-30 |

### Implementation Phase 2

- GOAL-002: Introduce a realtime speech-to-text service that bridges Azure events to Agent Voice conversation components.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Create `src/services/realtime-speech-to-text-service.ts` exposing `ingestRealtimeEvent` and `subscribeTranscript` APIs that transform Azure deltas into `TranscriptEvent` structures with utterance IDs, timestamps, and finalization markers. | ✅ | 2025-09-30 |
| TASK-005 | Wire the new service into `src/session/session-manager.ts` and `src/conversation/conversation-state-machine.ts`, ensuring transcript updates propagate to UI components and privacy filters. | ✅ | 2025-09-30 |
| TASK-006 | Add targeted unit tests under `test/services/realtime-speech-to-text-service.test.ts` covering delta aggregation, finalization on `response.done`, and error handling for malformed events. | ✅ | 2025-09-30 |

### Implementation Phase 3

- GOAL-003: Enforce Web Audio 1.1 render loop compliance and telemetry collection *(Status: Complete)*.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Update `src/audio/audio-processing-chain.ts` and the PCM worklet (`src/audio/worklets/pcm-encoder-worklet.ts`) to validate 128-frame render quantums, log underruns, and expose an observable metric channel. | ✅ | 2025-09-30 |
| TASK-008 | Enhance `src/audio/audio-metrics.ts` to aggregate render-quantum health, latency, and CPU sampling, emitting structured telemetry for diagnostics dashboards. | ✅ | 2025-09-30 |
| TASK-009 | Build audio telemetry unit tests in `test/unit/audio/audio-processing-chain.render.unit.test.ts` (and extend metrics coverage) verifying underrun detection, metric emission, and fallback behaviour. | ✅ | 2025-09-30 |

### Implementation Phase 4

- GOAL-004: Harden ephemeral key lifecycle and configuration alignment *(Status: Complete)*.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Extend `src/services/ephemeral-key-service.ts` (or equivalent) to refresh keys proactively at 45-second intervals and expose expiry metadata to `WebRTCAudioService`. | ✅ | 2025-10-01 |
| TASK-011 | Update `src/config/realtime-session.ts` (or create if missing) to surface voice selection, turn-detection defaults, and API version constants referenced in Phases 1–2. | ✅ | 2025-10-01 |
| TASK-012 | Document the configuration flow in `docs/design/FEATURE-PLAN.md` and `docs/design/TECHNICAL-REFERENCE-INDEX.md`, linking to the Azure quickstart/how-to sources. | ✅ | 2025-10-01 |

## 3. Alternatives

- **ALT-001**: Handle transcript deltas directly inside `WebRTCAudioService` without a dedicated service—rejected to keep conversation concerns modular and testable.
- **ALT-002**: Defer render-quantum telemetry to a future observability initiative—rejected because Web Audio 1.1 compliance depends on immediate validation.

## 4. Dependencies

- **DEP-001**: Microsoft Learn GPT Realtime API TypeScript quickstart (`realtime-audio-quickstart`).
- **DEP-002**: Microsoft Learn GPT Realtime API WebRTC how-to (`realtime-audio-webrtc`).
- **DEP-003**: Agent Voice specifications `sp-006`, `sp-007`, and `sp-009` for transport, audio pipeline, and realtime STT obligations.

## 5. Files

- **FILE-001**: `src/audio/webrtc-audio-service.ts` — primary WebRTC session orchestration updates.
- **FILE-002**: `src/audio/webrtc-transport.ts` — session payload composition and API version handling.
- **FILE-003**: `src/services/realtime-speech-to-text-service.ts` — new realtime transcript adapter.
- **FILE-004**: `src/audio/audio-processing-chain.ts` & `src/audio/worklets/pcm-encoder-worklet.ts` — render-quantum compliance logic.
- **FILE-005**: `src/audio/audio-metrics.ts` — telemetry aggregation extensions.
- **FILE-006**: `src/services/ephemeral-key-service.ts` — ephemeral key refresh coordination.
- **FILE-007**: `docs/design/FEATURE-PLAN.md`, `docs/design/TECHNICAL-REFERENCE-INDEX.md` — documentation alignment.

## 6. Testing

- **TEST-001**: Unit tests validating `WebRTCAudioService` dispatches `response.create` once and registers handlers for all required realtime events.
- **TEST-002**: Unit/integration tests for `RealtimeSpeechToTextService` confirming delta aggregation, utterance finalization, and error resilience.
- **TEST-003**: Audio telemetry tests verifying render-quantum enforcement, underrun detection, and metric emission frequency.
- **TEST-004**: Integration test ensuring ephemeral key refresh occurs before expiry and does not interrupt active sessions.

## 7. Risks & Assumptions

- **RISK-001**: Incorrect event sequencing could break active conversations—mitigate with integration tests using mocked Azure event streams.
- **RISK-002**: Additional telemetry may impact performance—mitigate by sampling metrics and guarding dev instrumentation.
- **ASSUMPTION-001**: Existing configuration infrastructure can expose new voice/turn detection settings without major refactoring.
- **ASSUMPTION-002**: Azure API version `2025-08-28` remains stable during implementation window.

## 8. Related Specifications / Further Reading

- [SP-006: WebRTC Audio Transport](../spec/sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline](../spec/sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-009: Realtime STT Tool](../spec/sp-009-spec-tool-realtime-stt.md)
- [Azure GPT Realtime TypeScript Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript)
- [Azure GPT Realtime WebRTC How-To](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)

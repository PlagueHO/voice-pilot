---
goal: Implement Audio Codec Standards across VoicePilot realtime pipeline
version: 1.0
date_created: 2025-10-04
last_updated: 2025-10-05
owner: VoicePilot Project
status: 'Completed'
tags: [feature, audio, codec, realtime]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan operationalizes specification `sp-035-spec-design-audio-codec-standards.md` by defining deterministic steps to encode, negotiate, and enforce PCM16 codec profiles across the capture pipeline (SP-007) and WebRTC transport layer (SP-006). The tasks here can be executed autonomously to deliver compliant codec handling, telemetry, and fallback behaviors.

## 1. Requirements & Constraints

- **REQ-001**: Implement the PCM16/24 kHz mono primary profile and ensure it is applied across capture, transport, and Azure ingestion.
- **REQ-002**: Provide PCM16/16 kHz fallback and Opus fallback profiles with deterministic switching logic driven by transport telemetry.
- **REQ-003**: Ensure WebRTC SDP negotiation emits `ptime=20` and `maxptime<=40`, synchronizing `AudioContext.sampleRate` with the agreed profile.
- **SEC-001**: Prevent codec negotiation logs and telemetry from exposing Azure endpoint secrets or bearer tokens.
- **PER-001**: Maintain <40 ms encode path latency and cap jitter buffers at 120 ms.
- **CON-001**: Enforce mono capture and block ScriptProcessorNode usage; rely on AudioWorklet-based resampling only.
- **GUD-001**: Emit codec telemetry samples every 5 seconds through existing transport diagnostics hooks.
- **PAT-001**: Use Factory + Strategy patterns to instantiate codec profiles and switch between them without restarting sessions.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Define codec profile domain objects, factories, and validation utilities.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/audio/codec/audio-codec-profile.ts` exporting `AudioCodecProfile`, `CodecNegotiationRequest`, `CodecNegotiationResult`, and `AudioFormatDescriptor` interfaces exactly as specified in SP-035, using TypeScript 5 ES2022 module syntax. | Yes | 2025-10-05 |
| TASK-002 | Add `src/audio/codec/audio-codec-factory.ts` implementing a deterministic factory that returns typed constants for `pcm16-24k-mono`, `pcm16-16k-mono`, and `opus-48k-fallback`, including validation for frame duration, packet sizes, and DTX flags. | Yes | 2025-10-05 |
| TASK-003 | Introduce `src/audio/codec/codec-strategy-registry.ts` providing Strategy pattern helpers (`selectProfile`, `shouldFallback`, `requiresResample`) wired for telemetry-driven decisions. | Yes | 2025-10-05 |

### Implementation Phase 2

- GOAL-002: Integrate codec negotiation with audio capture and WebRTC transport services.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Update `src/audio/audio-context-provider.ts` to accept a codec profile parameter when configuring and ensure `AudioContext` reinitializes when negotiated `sampleRate` or `latencyHint` changes, persisting the agreed profile ID. | Yes | 2025-10-05 |
| TASK-005 | Modify `src/audio/audio-capture.ts` to request codec negotiation before `startCapture`, applying resampling via AudioWorklet when `requiresResample` is `true`, and emitting `codec.profile.changed` events through the existing event bus. | Yes | 2025-10-05 |
| TASK-006 | Extend `src/audio/webrtc-transport.ts` (`WebRTCTransportImpl.establishConnection` and `performNegotiationWithTimeout`) to embed codec SDP attributes (`a=ptime`, `a=maxptime`, mono channel) and broadcast transport telemetry to the codec strategy registry. | Yes | 2025-10-05 |

### Implementation Phase 3

- GOAL-003: Implement telemetry, diagnostics, and automated fallback behaviors.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Emit `codec.profile.changed` JSON events via `src/audio/webrtc-audio-service.ts` and forward them to UI status indicators and session diagnostics. | Yes | 2025-10-05 |
| TASK-008 | Enhance `src/audio/connection-recovery-manager.ts` to trigger fallback profile selection when packet loss > 3% over two consecutive telemetry windows, reverting to primary profile upon recovery. | Yes | 2025-10-05 |
| TASK-009 | Implement jitter buffer cap enforcement and packet size validation within `src/audio/webrtc-transport.ts`, raising structured errors when limits from SP-035 are exceeded. | Yes | 2025-10-05 |

### Implementation Phase 4

- GOAL-004: Add comprehensive automated tests and fixtures.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-010 | Add unit tests under `test/unit/audio/codec` validating factory outputs, strategy decisions, and resample flags using deterministic telemetry fixtures. | Yes | 2025-10-05 |
| TASK-011 | Extend `test/unit/audio/audio-context-provider.unit.test.ts` and `audio-processing-chain.render.unit.test.ts` to cover sample rate reconfiguration and mono enforcement. | Yes | 2025-10-05 |
| TASK-012 | Create integration test `test/integration/webrtc/webrtc-codec-negotiation.integration.test.ts` simulating SDP negotiation to assert `ptime`, `maxptime`, and fallback behavior, using Playwright/WebRTC mocks. | Yes | 2025-10-05 |

## 3. Alternatives

- **ALT-001**: Delegate codec negotiation entirely to Azure SDP defaults — rejected because SP-035 mandates deterministic control and telemetry.
- **ALT-002**: Use Opus as the primary codec with PCM16 fallback — rejected due to alignment with Azure GPT Realtime requirements and increased processing overhead.

## 4. Dependencies

- **DEP-001**: Existing telemetry pipeline in `src/audio/webrtc-audio-service.ts` for emitting connection diagnostics.
- **DEP-002**: Audio worklet infrastructure delivered by `src/audio/worklets/*` for resampling and processing.

## 5. Files

- **FILE-001**: `src/audio/codec/audio-codec-profile.ts` — new domain interfaces and helpers.
- **FILE-002**: `src/audio/audio-capture.ts` — capture pipeline integration with codec negotiation and events.
- **FILE-003**: `src/audio/webrtc-transport.ts` — SDP negotiation, packet validation, and telemetry hooks.
- **FILE-004**: `test/unit/audio/codec/*.unit.test.ts` — new unit test coverage for codec logic.
- **FILE-005**: `test/integration/webrtc/webrtc-codec-negotiation.integration.test.ts` — end-to-end negotiation validation.

## 6. Testing

- **TEST-001**: Run `npm run test:unit` to execute codec factory and strategy unit tests.
- **TEST-002**: Run `npm run test:all` to validate integration of codec negotiation within WebRTC transport and ensure no regressions.

## 7. Risks & Assumptions

- **RISK-001**: Browser-specific SDP quirks may prevent PCM16 enforcement; mitigation includes fallback to Opus with structured warnings.
- **ASSUMPTION-001**: Playwright-based integration environment can mock WebRTC APIs sufficiently to simulate packet loss and jitter scenarios.

## 8. Related Specifications / Further Reading

- [SP-035: Audio Codec Standards](../spec/sp-035-spec-design-audio-codec-standards.md)
- [SP-006: WebRTC Audio Transport Layer](../spec/sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline Architecture](../spec/sp-007-spec-architecture-audio-capture-pipeline.md)

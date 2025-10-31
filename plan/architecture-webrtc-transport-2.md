---
goal: Achieve SP-006 WebRTC transport compliance
version: 2025-09-27
date_created: 2025-09-27
last_updated: 2025-09-28
owner: Agent Voice Engineering
status: Completed
tags: [architecture, audio, realtime]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Establish a staged implementation plan that upgrades the WebRTC transport stack to satisfy SP-006 requirements, covering audio graph integration, transport contract updates, recovery strategies, telemetry, automation, and documentation.

## 1. Requirements & Constraints

- **REQ-001**: Support PCM16 24 kHz full-duplex audio routed through a Web Audio API 1.1 graph before WebRTC transmission (SP-006 AUD-001–AUD-006, AC-011).
- **REQ-002**: Provide data channel resilience with audio-only fallback and automatic resynchronization (SP-006 DATA-001–DATA-004, AC-010).
- **REQ-003**: Deliver connection recovery with exponential backoff, ICE restart, and telemetry outputs (SP-006 CONN-002/003, ERR-002/003, AC-004/006).
- **REQ-004**: Emit diagnostics for SDP negotiation, latency, packet statistics, and enforce a five-second negotiation timeout (SP-006 REQ-005, ERR-001, PERF-001/002).
- **REQ-005**: Supply integration points for session manager, audio pipeline, and key renewal per Section 4 interfaces (SP-006 Interfaces, Dependency map).
- **SEC-001**: Maintain ephemeral key handling without exposing permanent credentials inside webviews (SP-006 AUTH-002, SEC-002).
- **CON-001**: Preserve VS Code webview permission boundaries; AudioContext must resume only after user gesture.
- **GUD-001**: Follow Observer pattern for state notifications and Strategy pattern for recovery (SP-006 PAT-001, PAT-003).
- **PAT-001**: Implement Factory upgrades in `WebRTCConfigFactory` so downstream modules receive normalized configuration (SP-006 PAT-002).

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Introduce shared Web Audio processing graph and configuration primitives.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Extend `AudioConfiguration` in `src/types/webrtc.ts` with `audioContextProvider`, `workletModuleUrls`, and validation rules; update corresponding TypeScript types and exported interfaces. | ✅ | 2025-09-27 |
| TASK-002 | Create `src/audio/audio-context-provider.ts` exporting a singleton provider that lazily creates an `AudioContext` (latencyHint "interactive"), registers state listeners, and loads optional worklet modules declared in configuration. | ✅ | 2025-09-27 |
| TASK-003a | Refactor `src/audio/audio-track-manager.ts` to inject the shared provider and build the capture graph `MediaStreamAudioSourceNode -> AudioWorkletNode -> MediaStreamAudioDestinationNode`, retaining existing gain and mute controls. | ✅ | 2025-09-27 |
| TASK-003b | Replace `<audio>` element playback in `audio-track-manager` with Web Audio sink nodes that reuse the shared context and honour output device selection. | ✅ | 2025-09-27 |
| TASK-003c | Implement lifecycle cleanup in `audio-track-manager`, ensuring worklet nodes, destinations, and context-specific event listeners are disposed when tracks stop or sessions tear down. | ✅ | 2025-09-27 |
| TASK-004a | Update `src/audio/webrtc-audio-service.ts` to request processed capture and playback streams via the provider, resuming the shared `AudioContext` on explicit user gesture or session start. | ✅ | 2025-09-27 |
| TASK-004b | Ensure `webrtc-audio-service` closes graph nodes and detaches observers during `stopSession()` and `dispose()`, emitting diagnostics when cleanup paths fail. | ✅ | 2025-09-27 |

**GOAL-001 status:** Completed on 2025-09-27 with the shared AudioContext provider, refactored audio track manager, and validated via lint, unit, and headless test suites.

### Implementation Phase 2

- GOAL-002: Align transport and configuration factories with new audio contracts.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Modify `src/audio/webrtc-config-factory.ts` to populate `audioContextProvider` and `workletModuleUrls`, validate expiry windows, and surface configuration errors with `WebRTCErrorImpl`. | ✅ | 2025-09-28 |
| TASK-006 | Update `src/audio/webrtc-transport.ts` so `addAudioTrack` accepts preprocessed tracks, exposes `getAudioContext()` for downstream inspection, and propagates audio graph lifecycle events (e.g., session update sends output format metadata). | ✅ | 2025-09-28 |
| TASK-007 | Implement `AudioPipelineIntegration` interface in `src/audio/webrtc-audio-service.ts` and export integration hooks for session manager consumption, ensuring state updates fire Observer callbacks. | ✅ | 2025-09-28 |

### Implementation Phase 3

- GOAL-003: Enhance recovery strategies and data-channel resilience.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008a | Implement `restartIce()` orchestration in `src/audio/connection-recovery-manager.ts`, including exponential backoff with jitter, attempt ceilings, and persisted attempt counters. | ✅ | 2025-09-28 |
| TASK-008b | Recreate unreliable data channels after failures, reapply negotiated parameters, and synchronise state observers so transport consumers see updated channel references. | ✅ | 2025-09-28 |
| TASK-009a | Maintain audio-only fallback in `src/audio/webrtc-transport.ts`, keeping outbound audio active while data channels are unavailable and publishing fallback status to observers. | ✅ | 2025-09-28 |
| TASK-009b | Buffer outbound signalling/events during fallback and flush the queue with ordering guarantees once data-channel connectivity resumes. | ✅ | 2025-09-28 |
| TASK-010a | Route recovery callbacks through `src/audio/webrtc-error-handler.ts`, mapping transport failures to recovery strategies and notifying the session manager. | ✅ | 2025-09-28 |
| TASK-010b | Emit structured telemetry (`reconnectAttempt`, `reconnectSuccess`, `fallbackActive`) from `webrtc-audio-service` and error handler, wiring Observer notifications for downstream consumers. | ✅ | 2025-09-28 |

**GOAL-003 status:** Completed on 2025-09-28 after verifying recovery orchestration (`connection-recovery-manager.ts`), data-channel resilience and fallback queueing (`webrtc-transport.ts`), and telemetry propagation through the audio service and error handler (`webrtc-audio-service.ts`, `webrtc-error-handler.ts`).

### Implementation Phase 4

- GOAL-004: Deliver diagnostics, automated tests, and documentation updates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011a | Add negotiation timer instrumentation to `WebRTCTransportImpl`, enforcing the five-second cutoff and surfacing `WebRTCErrorCode.SdpNegotiationFailed` with contextual metadata. | ✅ | 2025-09-28 |
| TASK-011b | Sample latency and packet statistics via `RTCPeerConnection.getStats()`, logging structured metrics through `Logger` and exposing snapshots through telemetry observers. | ✅ | 2025-09-28 |
| TASK-012a | Author unit tests in `test/unit/audio/audio-context-provider.test.ts` covering shared context reuse, worklet preloading, and cleanup semantics. | ✅ | 2025-09-28 |
| TASK-012b | Add unit tests in `test/unit/audio/connection-recovery-manager.test.ts` validating ICE restart backoff, data-channel recreation, and telemetry counters. | ✅ | 2025-09-28 |
| TASK-012c | Implement integration test `test/integration/webrtc-audio-session.integration.test.ts` simulating negotiation timeouts, reconnection within three attempts, and audio-only fallback behaviour. | ✅ | 2025-09-28 |
| TASK-013 | Update documentation (`AGENTS.md`, `docs/design/FEATURE-PLAN.md`) with new workflow steps, configuration options, debugging guidance, and recovery telemetry outputs. | ✅ | 2025-09-28 |

**GOAL-004 status:** Completed on 2025-09-28 following implementation of negotiation timeout diagnostics, stats sampling, comprehensive test coverage, and documentation updates validated by passing unit and headless integration suites.

## 3. Alternatives

- **ALT-001**: Use per-session `AudioContext` instances instead of a shared provider; rejected due to higher startup latency and resource churn violating PERF-003.
- **ALT-002**: Delegate recovery entirely to session manager; rejected because transport-level ICE restart must execute where peer connection is owned to satisfy CONN-002.

## 4. Dependencies

- **DEP-001**: `EphemeralKeyService` must expose renewal callbacks compatible with the new recovery flow.
- **DEP-002**: VS Code webview permissions must allow microphone access and AudioWorklet execution on all supported platforms.

## 5. Files

- **FILE-001**: `src/types/webrtc.ts` — type contract extensions.
- **FILE-002**: `src/audio/audio-context-provider.ts` — new provider module (to be created).
- **FILE-003**: `src/audio/audio-track-manager.ts` — audio graph refactor.
- **FILE-004**: `src/audio/webrtc-transport.ts` — transport enhancements.
- **FILE-005**: `src/audio/webrtc-config-factory.ts` — configuration updates.
- **FILE-006**: `src/audio/webrtc-audio-service.ts` — pipeline integration.
- **FILE-007**: `src/audio/connection-recovery-manager.ts` — strategy upgrades.
- **FILE-008**: `src/audio/webrtc-error-handler.ts` — error routing updates.
- **FILE-009**: `docs/` and `AGENTS.md` — documentation revisions.

## 6. Testing

- **TEST-001**: Add unit tests validating shared AudioContext reuse, worklet loading, and cleanup semantics in `test/unit/audio/audio-context-provider.test.ts`.
- **TEST-002**: Add recovery unit tests covering ICE restart and data-channel retry behavior in `test/unit/audio/connection-recovery-manager.test.ts`.
- **TEST-003**: Create integration test `test/integration/webrtc-audio-session.integration.test.ts` simulating negotiation timeouts, reconnection success within three attempts, and audio-only fallback without data-channel.
- **TEST-004**: Add telemetry assertion tests ensuring negotiation metrics emit within expected ranges.

## 7. Risks & Assumptions

- **RISK-001**: Browser AudioWorklet availability may differ across platforms, potentially requiring fallback nodes.
- **RISK-002**: WebRTC mocks for testing may not match VS Code webview behavior, risking false positives; mitigation via targeted integration tests.
- **ASSUMPTION-001**: Ephemeral key renewal latency remains under one second, ensuring reconnection attempts stay within three retries.
- **ASSUMPTION-002**: Azure Realtime API continues to accept PCM16 24 kHz streams without renegotiation mid-session.

## 8. Related Specifications / Further Reading

- [SP-006 WebRTC Audio Transport Layer Specification](spec/sp-006-spec-architecture-webrtc-audio.md)
- [Plan: WebRTC Transport Feature Scope](plan/feature-webrtc-transport-1.md)
- [Azure OpenAI Realtime Audio Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart)

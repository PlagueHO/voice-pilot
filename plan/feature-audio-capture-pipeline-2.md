---
goal: Align Audio Capture Pipeline with Updated SP-007 Web Audio API 1.1 Requirements
version: 2.0
date_created: 2025-09-29
last_updated: 2025-09-29
owner: Agent Voice Project
status: 'Completed'
tags: [feature, audio, capture, remediation, webaudio]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan closes the newly identified SP-007 Audio Capture Pipeline compliance gaps by updating existing TypeScript services to the Web Audio API 1.1 contract. The scope is limited to remediation work not already covered by other roadmap items in FEATURE-PLAN.md.

## 1. Requirements & Constraints

- **REQ-002**: Surface explicit microphone permission guidance when requesting access.
- **REQ-003**: Support 16 kHz, 24 kHz (default), and 48 kHz capture rates without regressions.
- **REQ-006**: Provide graceful degradation path when microphone permission is denied.
- **AUD-004**: Maintain processing latency budget ≤ 50 ms within the capture pipeline.
- **AUD-006**: Monitor and recover from buffer underruns to prevent dropouts.
- **WEB-004**: Adapt audio quality to transport feedback without violating minimum capture rate.
- **PERF-001**: Ensure initialization completes within 2 seconds in typical environments.
- **PERF-002**: Keep continuous processing CPU utilization below 5% on reference hardware.
- **PERF-004**: Maintain end-to-end audio latency below 100 ms.
- **ERR-001**: Provide actionable messaging and retry path when permissions fail.
- **GUD-005**: Reuse a single AudioContext and respect Web Audio 1.1 render quantum guidance.
- **PAT-003**: Apply factory pattern for processing node creation to enable strategy swaps.
- **CON-001**: Changes must remain compatible with existing WebRTC transport integration.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Align public contracts with the updated SP-007 interface definitions.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Update `src/types/audio-capture.ts` to add `getAudioContext`, `setAudioProcessing`, extended event types (`permissionGranted`, `permissionDenied`, `voiceActivityDetected`), and constrained sample-rate union | ✅ | 2025-09-29 |
| TASK-002 | Extend `src/types/audio-errors.ts` with severity, recoverable metadata, and enriched context fields required by SP-007 | ✅ | 2025-09-29 |
| TASK-003 | Synchronize `src/types/webrtc.ts` audio configuration typing to honour the 16/24/48 kHz capture contract and document the minimum rate guard | ✅ | 2025-09-29 |

### Implementation Phase 2

- GOAL-002: Refactor `AudioCapture` and related services to satisfy the new contract and runtime behaviours.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Modify `src/audio/audio-capture.ts` to expose `getAudioContext`, emit new permission events, and dynamically select 16/24/48 kHz sample rates while keeping 24 kHz default | ✅ | 2025-09-29 |
| TASK-005 | Enhance `configureAudioContextProvider` and `AudioContextProvider` usage to propagate negotiated sample rate and latency hint while reusing the shared context | ✅ | 2025-09-29 |
| TASK-006 | Implement graceful permission denial handling with retry messaging and fallback behaviour aligned with REQ-006 and ERR-001 | ✅ | 2025-09-29 |
| TASK-007 | Prevent the adaptive quality logic in `src/audio/audio-track-manager.ts` from reducing capture below 16 kHz and ensure transport feedback only adjusts within supported rates | ✅ | 2025-09-29 |

### Implementation Phase 3

- GOAL-003: Reinforce performance, buffering, and verification coverage for the updated pipeline.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Add latency and CPU sampling hooks (e.g., in `src/audio/audio-metrics.ts`) to validate AUD-004, PERF-001/002/004 budgets with structured logs | ✅ | 2025-09-29 |
| TASK-009 | Create unit and integration tests under `test/audio/` to validate sample-rate negotiation, permission event emission, and buffer recovery paths | ✅ | 2025-09-29 |
| TASK-010 | Update developer documentation (`docs/` audio pipeline section) summarizing new configuration options and remediation behaviours | ✅ | 2025-09-29 |

## 3. Alternatives

- **ALT-001**: Defer changes to future SP-035 Audio Codec Standards work—rejected because current regressions block SP-007 compliance now.
- **ALT-002**: Introduce a new capture service instead of refactoring existing classes—rejected to avoid duplicate logic and increased maintenance.

## 4. Dependencies

- **DEP-001**: SP-007 Audio Capture Pipeline specification (latest revision).
- **DEP-002**: Existing `sharedAudioContextProvider` implementation.
- **DEP-003**: WebRTC transport quality feedback loop in `AudioTrackManager`.

## 5. Files

- **FILE-001**: `src/types/audio-capture.ts` — contract updates for the capture pipeline.
- **FILE-002**: `src/types/audio-errors.ts` — enriched error metadata.
- **FILE-003**: `src/types/webrtc.ts` — audio configuration typing guardrails.
- **FILE-004**: `src/audio/audio-capture.ts` — runtime permission, sampling, and event handling.
- **FILE-005**: `src/audio/audio-track-manager.ts` — transport-driven quality adjustments.
- **FILE-006**: `src/audio/audio-metrics.ts` — performance sampling enhancements.
- **FILE-007**: `docs/design/` audio pipeline section — documentation refresh.

## 6. Testing

- **TEST-001**: Unit tests for `AudioCapture` covering permission granted/denied event emission and configuration fallback.
- **TEST-002**: Integration tests validating negotiated sample rates (16/24/48 kHz) are respected end-to-end.
- **TEST-003**: Stress tests that simulate buffer underruns and verify recovery telemetry.
- **TEST-004**: Performance tests asserting initialization time < 2 s and CPU usage < 5% during steady-state capture.

## 7. Risks & Assumptions

- **RISK-001**: Additional instrumentation could inflate bundle size—mitigate by guarding dev-only metrics output.
- **RISK-002**: Browser-specific permission UX differences may complicate deterministic testing—mitigate with mockable permission interfaces.
- **ASSUMPTION-001**: No other pending FEATURE-PLAN entry currently addresses these remediation items, so there is no dependency conflict.
- **ASSUMPTION-002**: Existing WebRTC transport feedback remains the authoritative quality signal.

## 8. Related Specifications / Further Reading

- [SP-007: Audio Capture Pipeline Architecture](../spec/sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-006: WebRTC Audio Transport Layer](../spec/sp-006-spec-architecture-webrtc-audio.md)
- [Feature Plan & Roadmap](../docs/design/FEATURE-PLAN.md)

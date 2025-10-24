---
goal: VoicePilot Message Contract Implementation Plan
version: 1.0
date_created: 2025-10-11
last_updated: 2025-10-11
owner: VoicePilot Project
status: Completed
tags: [feature, messaging, architecture]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan operationalizes specification `spec/sp-050-spec-architecture-message-contracts.md` by delivering envelope utilities, schema validation, and channel-specific integrations across host, webview, realtime audio, STT, TTS, telemetry, and error flows.

## 1. Requirements & Constraints

- **REQ-001**: Implement canonical envelope structure with fields `id`, `type`, `version`, `timestamp`, `correlationId`, `source`, `payload`, `sequence`, and optional `privacyTier`.
- **REQ-002**: Provide JSON Schema draft 2020-12 validators stored under `/spec/schemas/` for every message type defined in SP-050.
- **REQ-003**: Maintain backward compatibility for two minor versions per message type using semantic versioning.
- **SEC-001**: Enforce allow-listed `source` values before dispatching handlers to mitigate message injection.
- **SEC-002**: Prevent credentials and secrets from traversing webview channels per privacy policy (SP-027).
- **CON-001**: Ensure serialized envelope size on host ↔ webview channel does not exceed 256 KiB by chunking large payloads.
- **CON-002**: Achieve validation latency ≤ 2 ms per envelope to satisfy performance budgets (SP-030).
- **GUD-001**: Document schemas with examples and auto-generate Markdown summaries for developer onboarding.
- **PAT-001**: Implement request/response correlation using UUID-based `correlationId` with automatic timeout handling.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish schema registry and envelope utility layer.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `/spec/schemas/envelope.schema.json` and message-type schemas (`ui.session.state.schema.json`, etc.) per SP-050 definitions with examples. | Yes | 2025-10-11 |
| TASK-002 | Implement `createEnvelope`, `validateEnvelope`, and `chunkEnvelopePayload` helpers in `src/core/message-envelope.ts` using `ajv` with draft 2020-12 support. | Yes | 2025-10-11 |
| TASK-003 | Add unit tests in `test/unit/core/message-envelope.test.ts` validating schema loading, correlation handling, and chunking behavior. | Yes | 2025-10-11 |

### Implementation Phase 2

- GOAL-002: Integrate host ↔ webview messaging with schema enforcement.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Refactor `src/ui/voice-control-panel.ts` to use `createEnvelope` for outbound messages and validate inbound messages before processing. | Yes | 2025-10-11 |
| TASK-005 | Update `media/voice-control-panel.js` webview runtime to validate envelopes via generated schema bundle and route commands using correlation IDs. | Yes | 2025-10-11 |
| TASK-006 | Extend integration tests in `test/integration/ui/voice-control-panel.integration.test.ts` to assert schema validation and 256 KiB chunking behavior. | Yes | 2025-10-11 |

### Implementation Phase 3

- GOAL-003: Apply schemas to audio, STT, TTS, telemetry, and error services.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Wire `src/audio/webrtc-transport.ts` and `src/audio/webrtc-audio-service.ts` to emit/consume `audio.control.state` and `audio.stream.frame` envelopes with latency instrumentation. | Yes | 2025-10-11 |
| TASK-008 | Update `src/services/realtime-speech-to-text-service.ts` to emit `stt.transcript.delta`/`final` envelopes, including replay guard logic and sequence enforcement. | Yes | 2025-10-11 |
| TASK-009 | Implement TTS request/response envelope handling in `src/services/audio-feedback/audio-feedback-service.ts` (or new `src/services/text-to-speech-service.ts`) including interruption token propagation per SP-011. | Yes | 2025-10-11 |
| TASK-010 | Integrate telemetry and error schemas within `src/telemetry/gate-telemetry.ts`, `src/telemetry/lifecycle-telemetry.ts`, and `src/services/error/error-event-bus.ts`, ensuring severity taxonomy alignment. | Yes | 2025-10-11 |

## 3. Alternatives

- **ALT-001**: Rely on TypeScript interfaces only without JSON Schema validation — rejected due to lack of runtime enforcement and cross-language compatibility.
- **ALT-002**: Use protocol buffers for message serialization — rejected due to webview serialization overhead and added build complexity.

## 4. Dependencies

- **DEP-001**: `ajv` runtime dependency for JSON Schema validation (ensure version supports draft 2020-12).
- **DEP-002**: WebRTC data channel initialization from `src/audio/webrtc-transport.ts` to carry control/audio envelopes.

## 5. Files

- **FILE-001**: `spec/sp-050-spec-architecture-message-contracts.md` — authoritative specification reference.
- **FILE-002**: `src/core/message-envelope.ts` — new envelope utility module.
- **FILE-003**: `media/voice-control-panel.js` — webview runtime requiring schema enforcement.
- **FILE-004**: `src/services/realtime-speech-to-text-service.ts` — STT envelope integration point.
- **FILE-005**: `src/audio/webrtc-transport.ts` — audio control/frame envelope integration.

## 6. Testing

- **TEST-001**: `npm run test:unit` must cover new unit tests validating envelope helpers and schema loading.
- **TEST-002**: `npm run test:integration` (or `npm test`) must exercise host ↔ webview messaging with schema enforcement and chunking scenarios.
- **TEST-003**: Add performance micro-benchmarks under `test/perf/messaging-envelope.perf.test.ts` to confirm ≤ 2 ms validation latency.

## 7. Risks & Assumptions

- **RISK-001**: Schema drift between host and webview bundles could break runtime validation; mitigate by generating schemas during build step.
- **ASSUMPTION-001**: Existing services expose hook points for injecting envelope validators without architectural refactor.

## 8. Related Specifications / Further Reading

- [spec/sp-050-spec-architecture-message-contracts.md](../spec/sp-050-spec-architecture-message-contracts.md)
- [spec/sp-028-spec-architecture-error-handling-recovery.md](../spec/sp-028-spec-architecture-error-handling-recovery.md)
- [spec/sp-005-spec-design-session-management.md](../spec/sp-005-spec-design-session-management.md)

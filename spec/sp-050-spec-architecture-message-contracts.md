---
title: VoicePilot Data Contracts for Message Passing
version: 1.0
date_created: 2025-10-11
last_updated: 2025-10-11
owner: VoicePilot Project
tags: [architecture, data-contracts, messaging, realtime]
---

## Introduction

This specification defines the authoritative data contracts and messaging envelopes that govern communication among the VoicePilot extension host, the sidebar webview, realtime audio services, and Azure OpenAI integrations. It ensures every participant exchanges structured, versioned JSON messages that are discoverable, validated, and backward compatible while honouring privacy, session, and transport guarantees established by prior specifications.

## 1. Purpose & Scope

This document provides the normative requirements for message schemas, versioning, validation, and transport bindings used across VoicePilot runtime services.

- Covers host ↔ webview messaging, audio capture streaming, realtime speech-to-text (STT) events, text-to-speech (TTS) outputs, telemetry envelopes, and error propagation.
- Applies to extension and webview TypeScript modules, service initializers, and test harnesses.
- Assumes SP-005 session orchestration, SP-006 WebRTC transport, SP-007 audio capture pipeline, SP-009 realtime STT integration, and SP-010 TTS streaming are already implemented.

Intended audience: extension architects, service developers, QA engineers, and tooling maintainers.

## 2. Definitions

- **Envelope**: Canonical wrapper around payloads containing identifiers, timestamps, type, version, and correlation metadata.
- **Channel**: Logical pathway used to route envelopes (e.g., host→webview, WebRTC data channel).
- **Schema Registry**: Source-controlled catalogue listing JSON schemas and semantic versions.
- **Correlation ID**: UUID linking related request, acknowledgement, telemetry, and error messages.
- **Codec Hint**: Metadata describing payload encoding (e.g., `pcm16`, `opus`) required for audio buffers.
- **Replay Guard**: Mechanism preventing duplicate processing via monotonic sequence counters.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: All messages shall use the canonical envelope shape with fields `id`, `type`, `version`, `timestamp`, `correlationId`, `source`, and `payload`.
- **REQ-002**: Message payloads shall be JSON-serializable objects validated against JSON Schema draft 2020-12 definitions stored in `/spec/schemas/`.
- **REQ-003**: Each message type shall increment semantic versions using `MAJOR.MINOR.PATCH` and maintain backward compatibility for two minor revisions.
- **REQ-004**: Host ↔ webview messages shall be transmitted via `vscode.Webview.postMessage` and received through the corresponding message event listener using the envelope.
- **REQ-005**: Audio streaming control messages shall use the WebRTC data channel labelled `voicepilot-control`; PCM frames shall use `voicepilot-audio` with fixed little-endian encoding and explicit `Codec Hint` metadata in control frames.
- **REQ-006**: STT transcripts shall distinguish `partial` versus `final` results, carrying incremental diffs and confidence scores, aligned with SP-009 timing guarantees.
- **REQ-007**: TTS playback directives shall include interruption tokens to comply with SP-011 interruption semantics and SP-010 playback rules.
- **REQ-008**: Error envelopes shall embed `severity`, `category`, and `retryable` flags consistent with SP-028 taxonomy.
- **REQ-009**: Privacy-sensitive payloads shall include `privacyTier` annotations aligning with SP-027 data handling policy.
- **SEC-001**: Messages shall reject injection by validating `source` against an allow list and enforcing strict schema validation before acting on payload data.
- **SEC-002**: Sensitive payload fields (credentials, tokens) shall never traverse webview channels; they remain confined to host-only channels.
- **CON-001**: Maximum envelope size shall not exceed 256 KiB for host ↔ webview channels; frames exceeding limit require chunking messages with ordered sequence IDs.
- **CON-002**: Control message latency budgets shall not exceed 60 ms one-way to meet SP-030 performance targets.
- **GUD-001**: Prefer additive fields and feature flags to maintain backward compatibility instead of removing or repurposing fields.
- **GUD-002**: Document every schema in Markdown with embedded examples to ease developer onboarding.
- **PAT-001**: Employ request/response with correlation IDs for operations needing acknowledgements (e.g., UI command dispatch).
- **PAT-002**: Use publish/subscribe semantics for telemetry and status updates to decouple producers and consumers.

## 4. Interfaces & Data Contracts

| Channel | Message Type | Version | Direction | Payload Summary |
|---------|--------------|---------|-----------|-----------------|
| Host ↔ Webview | `ui.session.state` | 1.1.0 | Host → Webview | Reports session state, timers, and microphone readiness. |
| Host ↔ Webview | `ui.command.invoke` | 1.0.0 | Webview → Host | Requests host to execute command (`startConversation`, `endConversation`, etc.). |
| Host ↔ Webview | `ui.telemetry.event` | 1.0.0 | Host → Webview | Publishes UI-friendly telemetry snapshots without PII. |
| Host ↔ Webview | `ui.error.notice` | 1.0.0 | Host → Webview | Sends recoverable error payloads with remediation hints. |
| WebRTC Control | `audio.control.state` | 1.0.0 | Host ↔ Service | Synchronizes capture, mute, and codec negotiation metadata. |
| WebRTC Audio | `audio.stream.frame` | 1.0.0 | Service → Host | Streams PCM16 frames with sequence, codec hint, and checksum. |
| STT Realtime | `stt.transcript.delta` | 1.2.0 | Service → Host | Emits partial transcripts (diff, confidence, timeline markers). |
| STT Realtime | `stt.transcript.final` | 1.0.0 | Service → Host | Emits finalized transcript segments with utterance IDs. |
| TTS Playback | `tts.play.request` | 1.1.0 | Host → Service | Requests audio synthesis with voice, prosody, and barge-in token. |
| TTS Playback | `tts.play.chunk` | 1.0.0 | Service → Host | Delivers encoded audio chunks and playback offsets. |
| Telemetry | `telemetry.metric.push` | 1.0.0 | Any → Host | Publishes metrics aligned with SP-054 schema once available. |
| Error Bus | `error.frame` | 1.0.0 | Any → Host | Conveys VoicePilotError structure with remediation guidance. |

### Envelope Schema (JSON Schema excerpt)

```json
{
  "$id": "https://voicepilot/spec/envelope.schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "type", "version", "timestamp", "payload", "source"],
  "properties": {
    "id": { "type": "string", "format": "uuid" },
    "type": { "type": "string", "pattern": "^[a-z0-9]+(\.[a-z0-9]+)+$" },
    "version": { "type": "string", "pattern": "^\d+\.\d+\.\d+$" },
    "timestamp": { "type": "string", "format": "date-time" },
    "correlationId": { "type": "string", "format": "uuid" },
    "source": { "type": "string", "enum": ["host", "webview", "audio-service", "stt-service", "tts-service"] },
    "privacyTier": { "type": "string", "enum": ["public", "customer", "sensitive"] },
    "payload": { "type": "object" },
    "sequence": { "type": "integer", "minimum": 0 }
  },
  "additionalProperties": false
}
```

### Example Payload Definitions

- `ui.session.state.payload` shall include `state`, `mic`, `elapsed`, and `retryAllowance`.
- `audio.stream.frame.payload` shall include `sequence`, `codec`, `sampleRate`, `channels`, and `data` (Base64).
- `stt.transcript.delta.payload` shall include `utteranceId`, `diff`, `confidence`, `isFinal`, and `timecodes`.
- `tts.play.request.payload` shall include `text`, `voice`, `style`, `bargeInToken`, `priority`, and `metadata`.

## 5. Acceptance Criteria

- **AC-001**: Given a host → webview notification, when the UI receives a `ui.session.state` envelope, then the listener validates the schema and updates UI state within one render frame.
- **AC-002**: Given a realtime STT stream, when the host receives `stt.transcript.delta` messages out of sequence, then the host reorders them using the `sequence` field and discards duplicates based on `id`.
- **AC-003**: Given a playback interruption request, when the host sends `tts.play.request` with a `bargeInToken`, then the TTS service halts any chunk with the same token before starting new playback.
- **AC-004**: Given an error condition, when a service emits `error.frame` with `retryable=false`, then the host forwards a `ui.error.notice` with matching correlation and severity to the webview.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests validate envelope builders and schema validators; integration tests exercise host ↔ webview messaging; end-to-end tests cover full audio roundtrips with mocked Azure services.
- **Frameworks**: Use Mocha with Chai assertions; leverage `ajv` for JSON schema validation; stub VS Code Webview APIs with existing harnesses.
- **Test Data Management**: Store sample envelopes in `spec/fixtures/message-contracts/`; ensure randomized UUIDs and timestamps per run.
- **CI/CD Integration**: Extend `npm run test:all` to execute schema validation suite; gate merges on zero schema drift.
- **Coverage Requirements**: Maintain ≥ 95% statement coverage for envelope mappers and ≥ 90% branch coverage for routing logic.
- **Performance Testing**: Include micro-benchmarks verifying serialization and validation complete within 2 ms per message under load.

## 7. Rationale & Context

- Aligns with SP-005 to ensure session state transitions propagate deterministically.
- Reinforces SP-006 requirement for consistent WebRTC control metadata.
- Coordinates with SP-007 audio pipeline outputs and ensures PCM metadata propagates alongside frames.
- Satisfies SP-009 and SP-010 by distinguishing transcript deltas and playback chunks with interruption support.
- Supports SP-028 error taxonomy, SP-037 retry semantics, and SP-027 privacy tiers across all messages.

## 8. Dependencies & External Integrations

- **EXT-001**: Azure OpenAI Realtime endpoint – delivers STT and TTS messages that must map to the defined envelopes.
- **SVC-001**: VS Code Webview messaging API – transports host ↔ webview envelopes.
- **INF-001**: WebRTC data channels provisioned per SP-006 – carry control and audio frame messages.
- **DAT-001**: Schema registry stored in repository – versioned JSON schemas referenced by developers and tooling.
- **PLT-001**: Node.js 22 runtime – ensures `crypto.randomUUID` and structuredClone support for envelope factories.
- **COM-001**: Privacy compliance policy (SP-027) – mandates privacy tiers and redaction patterns within payloads.

## 9. Examples & Edge Cases

```json
{
  "id": "8b0f8c0a-0f32-4f3f-86fd-2b1e5a6d2d0f",
  "type": "stt.transcript.delta",
  "version": "1.2.0",
  "timestamp": "2025-10-11T17:32:45.128Z",
  "correlationId": "1f2c0e87-9f26-4a19-a30c-0ec05df7e7a9",
  "source": "stt-service",
  "privacyTier": "customer",
  "sequence": 42,
  "payload": {
    "utteranceId": "3fd2d6f9-0d44-4f80-942a-e6b3fdc75689",
    "diff": [{ "op": "append", "text": "deploy" }],
    "confidence": 0.91,
    "isFinal": false,
    "timecodes": { "startMs": 1240, "endMs": 1760 }
  }
}
```

Edge cases:

- Duplicate `sequence` processed after timeout triggers `replay guard` logging without state mutation.
- Chunked `audio.stream.frame` messages use `sequence` increments of one and include `final=true` flag on terminating frame.
- `ui.command.invoke` failures emit paired `error.frame` referencing the original `correlationId` for traceability.

## 10. Validation Criteria

- JSON schemas compile without errors and cover every message type referenced in this specification.
- Automated validators reject payloads missing required fields or containing additional properties.
- Integration tests confirm backward compatibility when `MINOR` increments occur.
- Observability dashboards display message latency histograms derived from envelope timestamps.

## 11. Related Specifications / Further Reading

- [spec/sp-005-spec-design-session-management.md](sp-005-spec-design-session-management.md)
- [spec/sp-006-spec-architecture-webrtc-audio.md](sp-006-spec-architecture-webrtc-audio.md)
- [spec/sp-007-spec-architecture-audio-capture-pipeline.md](sp-007-spec-architecture-audio-capture-pipeline.md)
- [spec/sp-009-spec-tool-realtime-stt.md](sp-009-spec-tool-realtime-stt.md)
- [spec/sp-010-spec-tool-text-to-speech.md](sp-010-spec-tool-text-to-speech.md)
- [spec/sp-028-spec-architecture-error-handling-recovery.md](sp-028-spec-architecture-error-handling-recovery.md)

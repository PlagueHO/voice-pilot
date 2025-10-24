---
goal: Implement privacy and data handling controls per SP-027
version: 1.0
date_created: 2025-09-26
last_updated: 2025-10-05
owner: VoicePilot Project
status: 'Completed'
tags: [privacy, security, process]
---

# Introduction

![Status: Completed on 2025-10-05](https://img.shields.io/badge/status-Completed-brightgreen)

This plan delivers the end-to-end implementation of the Privacy & Data Handling Policy (SP-027), covering data classification, retention enforcement, redaction, purge workflows, UI indicators, and telemetry safeguards across the VoicePilot extension.

## 1. Requirements & Constraints

- **REQ-001**: Enforce data classification (`Sensitive`, `Confidential`, `Operational`) at capture time within webview and extension host modules.
- **REQ-002**: Implement retention windows (audio ≤ 5 s, partial transcripts ≤ 30 s, final transcripts ≤ 120 s, diagnostics ≤ 24 h) with automated purge.
- **SEC-001**: Strip `Sensitive` payloads from webview ↔ extension messaging except for authorized recipients.
- **SEC-002**: Block Copilot prompt forwarding when privacy annotations flag secrets or PII.
- **PRI-001**: Apply redaction rules in the webview before transcripts leave the audio pipeline.
- **CON-001**: Privacy processing must keep additional transcription latency under 250 ms and memory overhead under 10 MB/session.
- **GUD-001**: Surface privacy state and purge controls in `VoiceControlPanel` consistent with UI accessibility guidance.
- **PAT-001**: Use Observer pattern for purge notifications and Builder pattern for privacy-aware transcript payloads.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish shared privacy model, services, and lifecycle enforcement in both webview and extension host.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/types/privacy.ts` defining `DataClassification`, `PrivacyAnnotatedTranscript`, `PurgeCommand`, and helper guards per SP-027 §4. | ✅ | 2025-10-05 |
| TASK-002 | Add `privacyPolicy` configuration schema to `src/config/sections/privacy-policy-section.ts` with defaults matching retention windows and redaction options; register with `ConfigurationManager`. | ✅ | 2025-10-05 |
| TASK-003 | Implement `PrivacyController` service in `src/services/privacy/privacy-controller.ts` handling retention scheduler, purge orchestration, and configuration hydration; expose via dependency container. | ✅ | 2025-10-05 |
| TASK-004 | Wire `PrivacyController.initialize()` into `ExtensionController` lifecycle ensuring purge-on-start before other services, referencing SP-003 for secret boundaries. | ✅ | 2025-10-05 |
| TASK-005 | Create unit tests in `test/privacy/privacy-controller.test.ts` covering retention timers, purge outcomes, and configuration overrides. | ✅ | 2025-10-05 |

### Implementation Phase 2

- GOAL-002: Integrate privacy controls with realtime transcription, session management, and Copilot adapters.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Update `src/webview/audio/transcript-aggregator.ts` to apply redaction rules before emitting events, attach classification metadata, and enforce partial transcript retention limits. | ✅ | 2025-10-05 |
| TASK-007 | Modify `src/session/SessionManager.ts` to invoke `PrivacyController.issuePurge()` on session end, reconnect, and manual clear commands; ensure events propagate via Observer pattern. | ✅ | 2025-10-05 |
| TASK-008 | Extend `src/copilot/chatIntegration.ts` to block or redact prompts flagged `containsSecrets`/`containsPII`, logging sanitized metadata only. | ✅ | 2025-10-05 |
| TASK-009 | Introduce privacy-aware messaging channel changes in `src/ui/VoiceControlPanel.ts` and `src/ui/transcriptView.ts` so only redacted transcripts render, along with purge triggers. | ✅ | 2025-10-05 |
| TASK-010 | Add integration tests in `test/integration/privacy-session.test.ts` simulating transcript flows, purge events, and Copilot prompt rejection paths. | ✅ | 2025-10-05 |

### Implementation Phase 3

- GOAL-003: Deliver UI transparency, telemetry guards, and operational tooling for privacy compliance.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Implement privacy status indicator and quick actions in `VoiceControlPanel` webview (HTML/JS under `media/voice-control-panel.js`) aligned with UI.md accessibility guidance. | ✅ | 2025-10-05 |
| TASK-012 | Update logging utilities in `src/core/logger.ts` to enforce anonymized fields and add structured redaction metadata (sessionId, purge status). | ✅ | 2025-10-05 |
| TASK-013 | Guard telemetry emission within `src/services/telemetry/telemetry-service.ts` (create if absent) to honor `telemetryOptIn` and prevent payload content capture. | ✅ | 2025-10-05 |
| TASK-014 | Document privacy controls in `docs/validation/sp-001-acceptance-validation.md` (new subsection) and add operational runbook in `docs/process/privacy-data-handling-runbook.md`. | ✅ | 2025-10-05 |
| TASK-015 | Execute `npm run test:unit` and `npm run test:all`, capturing evidence that privacy suites pass within latency constraints. | ✅ | 2025-10-05 |

## 3. Alternatives

- **ALT-001**: Perform redaction within the extension host only—rejected because raw transcripts would traverse host boundary, violating SEC-001.
- **ALT-002**: Persist transcripts to disk for recovery—rejected due to retention policy (RET-001) and increased exposure risk.

## 4. Dependencies

- **DEP-001**: Azure OpenAI Realtime API (refer to Technical Reference Index) for transcript metadata supporting server-side redaction.
- **DEP-002**: VS Code Secret Storage & Configuration APIs referenced in SP-003 and docs/TECHNICAL-REFERENCE-INDEX.md.

## 5. Files

- **FILE-001**: `src/services/privacy/privacy-controller.ts` — new privacy orchestration service.
- **FILE-002**: `src/webview/audio/transcript-aggregator.ts` — apply redaction and retention logic before emission.
- **FILE-003**: `src/ui/VoiceControlPanel.ts` & `media/voice-control-panel.js` — surface privacy indicators and purge controls.
- **FILE-004**: `src/copilot/chatIntegration.ts` — ensure privacy-annotated prompts respect blocking rules.
- **FILE-005**: `docs/process/privacy-data-handling-runbook.md` — operational documentation for privacy controls.

## 6. Testing

- **TEST-001**: Unit tests covering retention scheduler, purge command execution, and redaction utilities (`npm run test:unit`).
- **TEST-002**: Integration tests validating transcript pipeline, purge events, and Copilot prompt blocking (`npm run test:all`).
- **TEST-003**: UI automation validating privacy indicators and manual purge flows via Playwright harness.

## 7. Risks & Assumptions

- **RISK-001**: Retention scheduler may introduce latency spikes if purges are heavy; mitigate with incremental purging and profiling.
- **ASSUMPTION-001**: Azure realtime responses include necessary metadata (response IDs, server VAD signals) as documented in Technical Reference Index.

## 8. Related Specifications / Further Reading

- [spec/sp-027-spec-security-privacy-data-handling.md](../spec/sp-027-spec-security-privacy-data-handling.md)
- [spec/sp-003-spec-security-secret-storage.md](../spec/sp-003-spec-security-secret-storage.md)
- [spec/sp-009-spec-tool-realtime-stt.md](../spec/sp-009-spec-tool-realtime-stt.md)
- [docs/design/UI.md](../docs/design/UI.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- [docs/design/TECHNICAL-REFERENCE-INDEX.md](../docs/design/TECHNICAL-REFERENCE-INDEX.md)

---
goal: Implement Agent Voice Error Handling & Recovery Framework
version: 1.0
date_created: 2025-09-27
last_updated: 2025-09-27
owner: Agent Voice Reliability Team
status: 'Completed'
tags: [architecture, reliability, error-handling, recovery, vscode, azure]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This implementation plan delivers the architecture, services, and UI integrations required by SP-028 to standardize error handling, recovery orchestration, and observability across the Agent Voice extension while aligning with the technical references catalogued in `docs/design/TECHNICAL-REFERENCE-INDEX.md`.

## 1. Requirements & Constraints

- **REQ-001**: Define and use a shared error taxonomy covering severity, fault domain, and user impact across host and webview contexts (SP-028 §3).
- **REQ-002**: Ensure all services wrap thrown exceptions in the canonical error envelope before propagation (SP-028 §3).
- **REQ-003**: Populate remediation instructions suitable for UI consumption in every error envelope (SP-028 §3).
- **REQ-004**: Implement idempotent, observable recovery plans with completion and failure signaling (SP-028 §3).
- **REQ-005**: Respect configurable retry envelopes per fault domain with jittered backoff (SP-028 §3).
- **SEC-001**: Redact sensitive credentials and personal data from logs, telemetry, and UI notifications (SP-028 §3, SP-003, SP-027).
- **SEC-002**: Validate host ↔ webview error payload schemas to prevent injection attacks (SP-028 §3).
- **RCV-001**: Coordinate recovery flows with the conversation state machine to avoid conflicting transitions (SP-028 §3, SP-012).
- **RCV-002**: Provide graceful degradation paths such as transcription-only mode when dependencies fail (SP-028 §3).
- **OBS-001**: Emit structured logs, metrics, and telemetry containing correlation metadata (SP-028 §3, TECHNICAL-REFERENCE-INDEX.md).
- **CON-001**: Initialize the framework after the logger and before dependent services within the activation five-second budget (SP-028 §3, SP-001).
- **CON-002**: Retain only in-memory error state; persistent storage is prohibited without consent (SP-028 §3).
- **GUD-001**: Provide helper utilities (`withRecovery`, `wrapError`) to minimize duplication (SP-028 §3).
- **GUD-002**: Expose reusable VS Code UI adapters for surfacing error states (SP-028 §3, UI guidelines).
- **PAT-001**: Use publish/subscribe pattern for error broadcast to decouple listeners (SP-028 §3).
- **PAT-002**: Apply circuit breaker pattern for repeated external dependency failures (SP-028 §3).

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish canonical error contracts, taxonomy, and helper utilities.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/types/error/agent-voice-error.ts` defining `Agent VoiceError`, `RetryPlan`, `RecoveryPlan`, `RecoveryStep`, and related interfaces per SP-028 §4. |  |  |
| TASK-002 | Add `src/types/error/error-taxonomy.ts` exporting enumerations and strongly typed fault domains, severities, and user impact constants. |  |  |
| TASK-003 | Implement `src/helpers/error/redaction.ts` with deterministic redaction utilities satisfying SEC-001 and unit coverage targets. |  |  |
| TASK-004 | Provide `src/helpers/error/envelope.ts` with `wrapError`, `withRecovery` signatures aligning with GUD-001 and injecting correlation metadata. |  |  |
| TASK-005 | Update `src/types/index.ts` to re-export new error-related types for project-wide consumption. |  |  |

### Implementation Phase 2

- GOAL-002: Build the error event bus service and recovery orchestration infrastructure.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Create `src/services/error/error-event-bus.ts` implementing `ErrorEventBus` with publish/subscribe, filtering, and suppression window support. |  |  |
| TASK-007 | Implement `src/services/error/recovery-orchestrator.ts` coordinating retry envelopes, circuit breaker state, and recovery command execution. |  |  |
| TASK-008 | Add `src/services/error/recovery-registrar.ts` exposing `RecoveryRegistrar` for dependent services to register domain-specific steps. |  |  |
| TASK-009 | Integrate the error framework initialization into `src/core/ExtensionController.ts` lifecycle between logger and dependent services per CON-001. |  |  |
| TASK-010 | Document service wiring in `docs/design/COMPONENTS.md` reflecting new error handling modules and dependency graph. |  |  |

### Implementation Phase 3

- GOAL-003: Wire domain services and UI adapters to the new framework with privacy and resilience safeguards.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Update `src/auth/EphemeralKeyService.ts` to use `withRecovery` and publish `Agent VoiceError` instances for authentication faults. |  |  |
| TASK-012 | Extend `src/session/SessionManager.ts` and transport/audio services to register recovery actions and degraded modes via `RecoveryRegistrar`. |  |  |
| TASK-013 | Implement `src/ui/status-bar.ts` and `src/ui/VoiceControlPanel.ts` adapters invoking new error presentation methods with suppression logic. |  |  |
| TASK-014 | Ensure host ↔ webview messaging schemas for error payloads are validated by adding shared schema definitions under `src/ui/transcriptView.ts` (or adjacent modules). |  |  |
| TASK-015 | Add structured logging and metrics instrumentation to `src/core/logger.ts` consumers leveraging correlation IDs from the error envelope. |  |  |

### Implementation Phase 4

- GOAL-004: Deliver comprehensive automated tests, telemetry plumbing, and documentation updates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-016 | Create unit tests under `test/error/error-helpers.test.ts` covering envelope utilities, redaction, and retry policy calculations (≥95% coverage). |  |  |
| TASK-017 | Add integration tests using `@vscode/test-electron` ensuring error publication triggers UI adapters and recovery flows without regressions. |  |  |
| TASK-018 | Implement contract tests validating JSON schema for webview error messages under `test/ui/error-schema.test.ts`. |  |  |
| TASK-019 | Update `docs/validation/error-handling.md` summarizing test matrix, telemetry metrics, and operational playbooks. |  |  |
| TASK-020 | Configure metrics export hooks (e.g., `metrics/error-metrics.ts`) to ingest domain severity counts and surface correlation identifiers for observability dashboards. |  |  |

## 3. Alternatives

- **ALT-001**: Implement decentralized error handling within each service without a shared framework—rejected due to duplication and inconsistent recovery flows.
- **ALT-002**: Use direct callbacks instead of a publish/subscribe event bus—rejected for tight coupling and reduced flexibility when adding new observers.
- **ALT-003**: Persist error history to disk for later diagnostics—rejected to comply with privacy constraints (SP-027) and avoid storage overhead.

## 4. Dependencies

- **DEP-001**: `src/core/logger.ts` for structured logging integration and correlation metadata emission.
- **DEP-002**: Azure OpenAI SDK retry guidance referenced in `docs/design/TECHNICAL-REFERENCE-INDEX.md` for transport fault handling.
- **DEP-003**: VS Code Extension API notification and status bar interfaces for UI adapters.
- **DEP-004**: Conversation state machine implementation from `spec/sp-012-spec-architecture-conversation-state-machine.md` and associated services.

## 5. Files

- **FILE-001**: `src/types/error/agent-voice-error.ts` — canonical error envelope definitions.
- **FILE-002**: `src/services/error/error-event-bus.ts` — central publish/subscribe service.
- **FILE-003**: `src/services/error/recovery-orchestrator.ts` — retry envelopes and recovery execution.
- **FILE-004**: `src/helpers/error/envelope.ts` — helper utilities for wrapping operations with recovery.
- **FILE-005**: `src/helpers/error/redaction.ts` — sensitive data redaction logic.
- **FILE-006**: `src/ui/status-bar.ts` and `src/ui/VoiceControlPanel.ts` — UI presentation updates.
- **FILE-007**: `docs/validation/error-handling.md` — validation playbook documentation.
- **FILE-008**: `test/error/error-helpers.test.ts` — unit test coverage for error utilities.

## 6. Testing

- **TEST-001**: Unit test coverage for `wrapError`, `withRecovery`, and redaction helpers with deterministic fixtures.
- **TEST-002**: Integration test verifying error publication triggers status bar and panel notifications without duplicate alerts during suppression windows.
- **TEST-003**: Recovery orchestration tests simulating circuit breaker activation and fallback modes for transport failures.
- **TEST-004**: Contract tests ensuring host ↔ webview error payload schemas reject malformed input.
- **TEST-005**: Telemetry validation tests confirming logs and metrics include correlation metadata without leaking sensitive values.

## 7. Risks & Assumptions

- **RISK-001**: Complex recovery flows may introduce race conditions with session state transitions; mitigate via deterministic state machine integration tests.
- **RISK-002**: Circuit breaker misconfiguration could prevent automatic recovery; mitigate with configuration validation and safe defaults.
- **RISK-003**: UI notification overload if suppression windows fail; mitigate with thorough end-to-end testing and rate limiting.
- **ASSUMPTION-001**: Existing services can be instrumented without breaking public APIs or requiring major refactors.
- **ASSUMPTION-002**: Observability sinks (logger, metrics) support correlation identifiers without schema changes.
- **ASSUMPTION-003**: Azure OpenAI and GitHub Copilot dependencies expose error metadata needed for classification.

## 8. Related Specifications / Further Reading

- [SP-028 — Error Handling & Recovery Framework](../spec/sp-028-spec-architecture-error-handling-recovery.md)
- [SP-012 — Conversation State Machine](../spec/sp-012-spec-architecture-conversation-state-machine.md)
- [SP-004 — Ephemeral Key Service](../spec/sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-006 — WebRTC Audio Transport Layer](../spec/sp-006-spec-architecture-webrtc-audio.md)
- [Technical Reference Index](../docs/design/TECHNICAL-REFERENCE-INDEX.md)

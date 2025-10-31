---
goal: Implement SP-017 Intent Processing Pipeline
version: 1.0
date_created: 2025-10-31
last_updated: 2025-10-31
owner: VoicePilot Engineering
status: In progress
tags: [feature, intent, nlp]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In_progress-yellow)

Execute specification SP-017 to deliver the intent processing and classification subsystem that bridges realtime transcripts with the conversation state machine while satisfying performance, extensibility, and privacy requirements.

## 1. Requirements & Constraints

- **REQ-001**: Produce structured intent results from finalized STT transcripts within 200 ms for rule-based paths.
- **CLS-003**: Provide hybrid rule + LLM classification with weighted scoring and context awareness.
- **ENT-002**: Resolve and validate workspace-relative file paths for extracted entities.
- **INT-002**: Publish classified intents to the conversation state machine within 100 ms of classification.
- **SEC-001**: Redact sensitive entities prior to logging or telemetry emission.
- **PER-004**: Support up to 10 concurrent classification requests without queuing.
- **CON-002**: Retain only the last 10 turns per session in intent history to limit memory usage.
- **GUD-001**: Prefer rule-based flows for high-frequency commands to minimise latency and compute cost.
- **PAT-001**: Apply Strategy pattern for pluggable classification backends.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish intent processing module scaffolding, contracts, and lifecycle wiring.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/intent/intent-processor.ts` defining `IntentProcessor` + related interfaces per SP-017 and export barrel in `src/intent/index.ts`. | ✅ | 2025-10-31 |
| TASK-002 | Implement `IntentProcessorImpl` skeleton in `src/intent/intent-processor-impl.ts` with `ServiceInitializable` lifecycle, dependency injection placeholders, and telemetry hooks. | ✅ | 2025-10-31 |
| TASK-003 | Wire `IntentProcessorImpl` construction and initialization within `src/extension.ts` activation sequence after `SessionManagerImpl` instantiation. | ✅ | 2025-10-31 |

### Implementation Phase 2

- GOAL-002: Deliver rule-based, LLM, and hybrid classifiers plus entity extraction pipeline fulfilling classification requirements.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement rule-based classifier strategy in `src/intent/classifiers/rule-intent-classifier.ts` handling normalization, regex/keyword patterns, and negation detection. | ✅ | 2025-10-31 |
| TASK-005 | Implement LLM classifier strategy in `src/intent/classifiers/llm-intent-classifier.ts` using Azure OpenAI client, invoking `#mcp_context7_get-library-docs` for any package updates before coding. | ✅ | 2025-10-31 |
| TASK-006 | Implement hybrid orchestrator in `src/intent/classifiers/hybrid-intent-classifier.ts` combining weighted outputs, disambiguation threshold logic, and explanations. | ✅ | 2025-10-31 |
| TASK-007 | Build entity extraction pipeline in `src/intent/entities/entity-extractor.ts` applying Chain of Responsibility for regex, NER (future stub), and LLM enrichers with workspace resolution utilities. | ✅ | 2025-10-31 |

### Implementation Phase 3

- GOAL-003: Integrate processor with conversation state machine, session context, and handler registration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Persist per-session intent history cache in `IntentProcessorImpl`, enforcing max 10 turns and exposing accessor APIs. | ✅ | 2025-10-31 |
| TASK-009 | Implement handler registry in `src/intent/handlers/intent-handler-registry.ts` supporting priorities and disposable subscriptions. | ✅ | 2025-10-31 |
| TASK-010 | Publish classified intents via event bus to `src/conversation/conversation-state-machine.ts`, updating state transitions and ensuring 100 ms propagation. | ✅ | 2025-10-31 |
| TASK-011 | Emit structured telemetry and redacted logs through `src/telemetry/telemetry-service.ts` for classification latency, confidence, and fallback usage. | ✅ | 2025-10-31 |

### Implementation Phase 4

- GOAL-004: Finalize configuration, tests, and documentation ensuring spec conformance and observability.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Add configuration schema entries in `package.json` and validators under `src/config/validators/intent-config-section.ts` covering classifier modes and custom packs. | ⏸️ | Deferred |
| TASK-013 | Author unit tests in `test/unit/intent/` covering classifiers, entity extraction, handler registry, and history retention; add integration tests under `test/integration/intent/`. | ✅ | 2025-10-31 |
| TASK-014 | Update developer docs `docs/design/TECHNICAL-REFERENCE-INDEX.md` and add section to `docs/process/intent-processing.md` summarising architecture, tuning levers, and telemetry dashboards. | ⏸️ | Deferred |
| TASK-015 | Define telemetry dashboards/alerts configuration in `docs/process/monitoring.md` capturing latency budgets and fallback rates. | ⏸️ | Deferred |

## 3. Alternatives

- **ALT-001**: Offload intent classification entirely to Azure OpenAI—rejected due to latency variance and quota risk contradicting REQ-001 and PER-004.
- **ALT-002**: Adopt third-party NLU SDK (e.g., Rasa) within the extension—rejected to avoid bundling overhead and to maintain offline-capable rule-based fallback.

## 4. Dependencies

- **DEP-001**: Azure OpenAI SDK availability and configuration for LLM classifier.
- **DEP-002**: Conversation state machine events (`src/conversation/conversation-state-machine.ts`) for publishing intent results.
- **DEP-003**: Session Manager services providing workspace context and preferences.

## 5. Files

- **FILE-001**: `src/intent/intent-processor.ts` — contracts and public API for intent processing.
- **FILE-002**: `src/intent/classifiers/*` — classifier strategy implementations.
- **FILE-003**: `src/intent/entities/entity-extractor.ts` — entity extraction pipeline.
- **FILE-004**: `src/extension.ts` — integration wiring during activation.
- **FILE-005**: `test/unit/intent/**/*.ts` — unit test suites for classifiers and extractors.

## 6. Testing

- **TEST-001**: Unit tests validating rule-based classifier latency and pattern coverage per intent packs.
- **TEST-002**: Integration tests simulating STT transcript events through `IntentProcessorImpl` to verify state machine propagation and disambiguation flows.
- **TEST-003**: Telemetry regression tests asserting redaction and metric emission using mocked telemetry service.

## 7. Risks & Assumptions

- **RISK-001**: LLM response schema drift could break hybrid orchestration; mitigate with strict JSON schema validation and fallback.
- **ASSUMPTION-001**: Realtime STT finalized events provide required metadata within SP-009 contract without additional normalization.
- **ASSUMPTION-002**: Required VS Code APIs for workspace path resolution remain stable in Node.js 22 runtime.

## 8. Related Specifications / Further Reading

- [SP-017: Intent Processing & Classification Algorithm](sp-017-spec-algorithm-intent-processing.md)
- [SP-012: Conversation State Machine Architecture](sp-012-spec-architecture-conversation-state-machine.md)
- [SP-009: Realtime Speech-to-Text Integration](sp-009-spec-tool-realtime-stt.md)
- [docs/process/retry-backoff-framework-1.md](../process/retry-backoff-framework-1.md)

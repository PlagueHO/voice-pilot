---
goal: Implement Conversation State Machine per SP-012
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
status: 'Completed'
tags: [architecture, conversation, realtime, vscode-extension]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan operationalizes specification `spec/sp-012-spec-architecture-conversation-state-machine.md` by defining deterministic implementation phases for the VoicePilot conversation state machine, ensuring integration with session, STT, TTS, and UI systems aligns with referenced technical guidance and Azure realtime documentation from the Technical Reference Index.

## 1. Requirements & Constraints

- **REQ-001**: Implement all state and transition requirements defined in `spec/sp-012-spec-architecture-conversation-state-machine.md` section 3.
- **REQ-002**: Publish UI context updates that comply with labels described in `docs/design/UI.md`.
- **REQ-003**: Ensure state machine event propagation supports Copilot integration contracts defined in SP-012 section 4 and `spec/sp-009-spec-tool-realtime-stt.md` / `spec/sp-010-spec-tool-text-to-speech.md`.
- **SEC-001**: Prevent logging of raw transcripts or audio content per SP-012 security requirements and privacy guidance.
- **INT-001**: Maintain compatibility with Session Manager contracts (`spec/sp-005-spec-design-session-management.md`).
- **CON-001**: Execute entirely within the extension host context without introducing webview global state.
- **GUD-001**: Follow Hierarchical State Machine and Observer patterns as mandated in SP-012 section 3.
- **PAT-001**: Apply circuit breaker mitigation for repeated Faulted transitions.
- **DOC-001**: Reference Azure OpenAI realtime event schemas per Technical Reference Index entry “Azure OpenAI Realtime API Reference”.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Scaffold core conversation state machine module and wiring hooks in the extension host.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/conversation/conversation-state-machine.ts` implementing `ConversationStateMachine` interface with states `idle`, `preparing`, `listening`, `processing`, `waitingForCopilot`, `speaking`, `interrupted`, `suspended`, `faulted`, `terminating` and state transition guards per SP-012 REQ-001..REQ-010. |  |  |
| TASK-002 | Add unit tests in `src/test/conversation/conversation-state-machine.test.ts` covering baseline transitions (`Idle → Preparing → Listening`, `Listening → Processing`, `Processing → Speaking`). |  |  |
| TASK-003 | Extend dependency injection container in `src/core/ExtensionController.ts` (or equivalent factory) to register the new state machine service and expose lifecycle hooks. |  |  |

### Implementation Phase 2

- GOAL-002: Integrate state machine with Session Manager, STT, and TTS services.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Wire Session Manager callbacks in `src/session/session-manager.ts` to invoke `suspend`/`resume` and `startConversation` per SP-012 INT-001 and suspension requirements. |  |  |
| TASK-005 | Update STT service at `src/audio/stt-service.ts` to forward transcript and VAD events to the state machine via `notifyTranscript`, ensuring latency constraints from SP-009 and SP-012 PER-001. |  |  |
| TASK-006 | Update TTS service at `src/audio/tts-service.ts` to call `notifyTts` on playback events (`speaking-state-changed`, `playback-complete`, interruption) per SP-010 and SP-012 REQ-006/REQ-007. |  |  |

### Implementation Phase 3

- GOAL-003: Surface UI state updates, Copilot integration, and resilience features.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Modify `src/ui/voice-control-panel.ts` (or related webview messaging handler) to react to `voicepilot.state` messages emitted by the state machine, updating UI context keys and localized strings per UI design guidelines. |  |  |
| TASK-008 | Implement Copilot coordination in `src/copilot/chat-integration.ts` (or equivalent) so that state transitions trigger single prompt dispatches and handle `CopilotResponseEvent` callbacks defined in SP-012 section 4. |  |  |
| TASK-009 | Add resilience logic in `src/conversation/conversation-state-machine.ts` to apply circuit breaker thresholds for repeated `faulted` states and emit remediation notifications through `src/core/logger.ts`. |  |  |

## 3. Alternatives

- **ALT-001**: Use an external state machine library (e.g., XState) in the extension host—rejected to avoid adding runtime dependencies and to keep deterministic control aligned with existing architectural patterns.
- **ALT-002**: Manage conversation flow within Session Manager directly—rejected to maintain single responsibility and allow independent evolution of audio pipelines.

## 4. Dependencies

- **DEP-001**: Existing Session Manager (`src/session/session-manager.ts`) must expose required lifecycle events.
- **DEP-002**: STT and TTS services (`src/audio/stt-service.ts`, `src/audio/tts-service.ts`) must provide event hooks compatible with state machine contracts.
- **DEP-003**: Copilot integration layer (`src/copilot/chat-integration.ts`) must support request/response correlation IDs.

## 5. Files

- **FILE-001**: `src/conversation/conversation-state-machine.ts` – New module implementing the conversation state machine.
- **FILE-002**: `src/test/conversation/conversation-state-machine.test.ts` – Test suite validating transition coverage and guard logic.
- **FILE-003**: `src/session/session-manager.ts` – Integration point for suspension/resume and start triggers.
- **FILE-004**: `src/audio/stt-service.ts` – Updates for transcript event forwarding.
- **FILE-005**: `src/audio/tts-service.ts` – Updates for playback event forwarding and interruptions.
- **FILE-006**: `src/ui/voice-control-panel.ts` – UI reactions to conversation state notifications.
- **FILE-007**: `src/copilot/chat-integration.ts` – Copilot request orchestration aligned with state machine events.
- **FILE-008**: `src/core/logger.ts` – Structured diagnostic logging for state transitions and fault handling.

## 6. Testing

- **TEST-001**: Unit test suite verifying all primary transitions, guard conditions, and fault recovery scenarios in `src/test/conversation/conversation-state-machine.test.ts`.
- **TEST-002**: Integration test in `src/test/extension/conversation.integration.test.ts` simulating STT/TTS events and asserting UI context keys.
- **TEST-003**: Performance probe added to `npm run test:perf` measuring `Listening → Processing` latency via synthetic event harness.
- **TEST-004**: Regression test ensuring Copilot dispatch occurs exactly once per turn using mocked `chat-integration` in `src/test/copilot/conversation-state-machine.integration.test.ts`.

## 7. Risks & Assumptions

- **RISK-001**: Misaligned event sequencing between STT/TTS services and the state machine may cause inconsistent UI states; mitigate via end-to-end integration tests.
- **RISK-002**: Circuit breaker thresholds may conflict with Session Manager retry logic; coordinate configuration defaults.
- **ASSUMPTION-001**: Session Manager, STT, and TTS services already expose asynchronous event emitters compatible with new callbacks.
- **ASSUMPTION-002**: Technical Reference Index resources remain accessible for validating Azure realtime event schemas.

## 8. Related Specifications / Further Reading

- [spec/sp-012-spec-architecture-conversation-state-machine.md](../spec/sp-012-spec-architecture-conversation-state-machine.md)
- [spec/sp-005-spec-design-session-management.md](../spec/sp-005-spec-design-session-management.md)
- [spec/sp-009-spec-tool-realtime-stt.md](../spec/sp-009-spec-tool-realtime-stt.md)
- [spec/sp-010-spec-tool-text-to-speech.md](../spec/sp-010-spec-tool-text-to-speech.md)
- [docs/design/UI.md](../docs/design/UI.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- [docs/design/TECHNICAL-REFERENCE-INDEX.md](../docs/design/TECHNICAL-REFERENCE-INDEX.md)

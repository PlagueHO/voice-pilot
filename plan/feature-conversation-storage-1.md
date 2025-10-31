---
goal: Implement conversation persistence storage subsystem
version: 1.0
date_created: 2025-10-21
last_updated: 2025-10-21
owner: Agent Voice Project
status: Planned
tags: [feature, storage, conversation]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Plan the end-to-end implementation of the SP-061 conversation persistence storage feature, delivering encrypted workspace-scoped conversation history with retention, purge, and crash-recovery capabilities aligned to existing lifecycle services.

## 1. Requirements & Constraints

- **REQ-001**: Persist conversation blobs under `ExtensionContext.storageUri/agentvoice/conversations` using deterministic hashed filenames.
- **REQ-002**: Provide CRUD APIs (`createRecord`, `updateRecord`, `getRecord`, `listRecords`, `deleteRecord`, `purgeAll`, `commitSnapshot`, `getSnapshot`, `commitConversation`) matching `spec/sp-061-spec-design-conversation-storage.md` Section 4.
- **SEC-001**: Encrypt all serialized payloads with AES-256-GCM using per-workspace keys stored in VS Code `SecretStorage` under `agentvoice.conversation.key`.
- **PRI-001**: Accept only privacy-sanitized transcripts and propagate redaction metadata without exposing raw sensitive tokens.
- **CON-001**: Enforce <10 MB uncompressed payload limit per conversation and cap write latency to ≤150 ms p95 with telemetry warnings when exceeded.
- **GUD-001**: Maintain an in-memory metadata index refreshed on initialization and invalidated on purge or schema migration.
- **PAT-001**: Register the storage service with the disposal orchestrator using the Repository pattern to isolate filesystem and crypto concerns.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish storage domain contracts, privacy compatibility, and crypto utilities.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/types/conversation-storage.ts` defining `ConversationRecord`, `ConversationRecordInput`, `ConversationRecordMutation`, `ConversationSummary`, `ConversationMetrics`, `RetentionInfo`, `PrivacyEnvelope`, `StorageEnvelope`, `RecoverySnapshot`, `PurgeReport`, and related TypeScript guards exactly as specified; export the module from `src/types/index.ts`. |  |  |
| TASK-002 | Extend `src/types/privacy.ts` to add new `PurgeReason` literals (`"retention-expired"`, `"privacy-policy-change"`, `"workspace-reset"`, `"corruption-detected"`) while retaining legacy values, update `isPurgeCommand` validation accordingly, and add unit coverage under `test/unit/privacy/privacy-controller.spec.ts`. |  |  |
| TASK-003 | Add `src/services/conversation/conversation-storage-crypto.ts` exporting deterministic helpers `loadOrCreateWorkspaceKey`, `encryptPayload`, and `decryptPayload` using `randomBytes(32)` plus AES-256-GCM with 12-byte IVs; persist keys via `context.secrets.store("agentvoice.conversation.key", base64Key)` and memoize in-memory. |  |  |

### Implementation Phase 2

- GOAL-002: Implement encrypted storage service and filesystem orchestration.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement `ConversationStorageServiceImpl` in `src/services/conversation/conversation-storage-service.ts` implementing `ConversationStorageService`; on `initialize()` create the storage namespace with `vscode.workspace.fs.createDirectory`, hydrate an in-memory `Map<string, ConversationRecordSummary>` by decrypting `*.vpconv` blobs, and schedule a 6-hour retention sweep. |  |  |
| TASK-005 | Inside `ConversationStorageServiceImpl`, implement `createRecord`, `updateRecord`, `commitConversation`, and `commitSnapshot` to serialize using `JSON.stringify`, encrypt via `encryptPayload`, write to hashed filenames `sha256(conversationId).substring(0,32).vpconv`, and emit `conversationStored` events through `vscode.EventEmitter`. |  |  |
| TASK-006 | Add purge and listing support: implement `listRecords` with cursor tokens, `deleteRecord` and `purgeAll` performing secure deletion via `vscode.workspace.fs.writeFile` zero-fill before `delete`, and register retention entries with `PrivacyController.registerRetention` for each stored record; include telemetry calls via `Logger`. |  |  |

### Implementation Phase 3

- GOAL-003: Integrate storage with lifecycle services, cleanup, and automated tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Update `src/session/session-manager.ts` to accept a `conversationStorage` dependency, generate `conversationId` per session, stream realtime transcript deltas into `commitSnapshot`, and invoke `commitConversation` during `endSession` and fatal error paths prior to purging privacy buffers. |  |  |
| TASK-008 | Modify `src/core/extension-controller.ts` to instantiate `ConversationStorageServiceImpl`, call `initialize()` after privacy controller boot, register it with the disposal orchestrator using priority `DISPOSAL_PRIORITY.session`, inject it into `SessionManagerImpl`, and pipe `privacyController.onPurge` events to `conversationStorage.purgeAll` or `deleteRecord` as required. |  |  |
| TASK-009 | Create unit tests `test/unit/conversation/conversation-storage-service.spec.ts` covering encryption round-trips, retention sweep purge, cursor pagination, and error handling; add integration smoke test `test/integration/conversation/conversation-storage.integration.test.ts` verifying session shutdown writes records and disposal clears handles. |  |  |

## 3. Alternatives

- **ALT-001**: Store plaintext JSON under workspace storage without encryption — rejected due to SEC-001 and PRI-001 requirements.
- **ALT-002**: Persist conversation history via `workspaceState` memento API — rejected because data would sync cross-machines and lacks secure deletion semantics.

## 4. Dependencies

- **DEP-001**: VS Code `ExtensionContext.storageUri`, `workspace.fs`, and `SecretStorage` APIs must be available during activation.
- **DEP-002**: Node.js `crypto` module (`createHash`, `randomBytes`) underpin hashing and key generation.

## 5. Files

- **FILE-001**: `src/services/conversation/conversation-storage-service.ts` — concrete encrypted storage implementation.
- **FILE-002**: `src/session/session-manager.ts` — session lifecycle hooks to commit and snapshot conversations.

## 6. Testing

- **TEST-001**: Add unit coverage ensuring encrypted blobs decrypt to original payloads and purge operations zero residual files.
- **TEST-002**: Extend integration suite to verify session termination writes records, updates metadata index, and registers cleanup scopes with the disposal orchestrator.

## 7. Risks & Assumptions

- **RISK-001**: File I/O latency spikes could breach CON-001 thresholds; mitigation via async batching and telemetry alerts.
- **ASSUMPTION-001**: Workspace storage directory is writable and not synced; plan assumes VS Code handles per-workspace isolation.

## 8. Related Specifications / Further Reading

- [spec/sp-061-spec-design-conversation-storage.md](../spec/sp-061-spec-design-conversation-storage.md)
- [spec/sp-027-spec-security-privacy-data-handling.md](../spec/sp-027-spec-security-privacy-data-handling.md)
- [spec/sp-053-spec-design-resource-cleanup.md](../spec/sp-053-spec-design-resource-cleanup.md)

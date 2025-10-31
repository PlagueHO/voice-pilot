---
title: Conversation Persistence Storage
version: 1.0
date_created: 2025-10-21
last_updated: 2025-10-21
owner: Agent Voice Project
tags: [design, storage, conversation, persistence, privacy]
---

## Introduction

This specification defines the workspace-scoped conversation persistence subsystem for Agent Voice. It prescribes how conversations are serialized, encrypted, retained, restored, and purged while honoring session lifecycle guarantees, privacy policies, and deterministic cleanup rules.

## 1. Purpose & Scope

Agent Voice requires durable storage so users can revisit conversations, resume interrupted work, and power history experiences. This specification covers:

- Storage service architecture for persisting conversation transcripts, metadata, and derived summaries.
- Retention policies, purge workflows, and secure deletion practices aligned with privacy rules.
- Interfaces connecting the storage subsystem to session management, cleanup orchestration, and future history UI.
- Validation, telemetry, and fallback strategies for operating against VS Code workspace storage APIs.

**Intended Audience**: Extension engineers building storage services, privacy reviewers, QA teams verifying persistence behavior, and designers of conversation history UX.

**Assumptions**:

- Session management (SP-005), privacy governance (SP-027), and cleanup orchestrator (SP-053) are implemented.
- VS Code provides `ExtensionContext.storageUri`, `workspaceState`, and `SecretStorage` primitives.
- Transcripts exposed by realtime STT adhere to redaction rules defined in SP-027 before reaching storage.
- Node.js 22 crypto APIs are available in the extension host for encryption and hashing.

## 2. Definitions

- **Conversation Record**: Canonical persisted bundle consisting of conversation metadata, ordered messages, attachments, and derived analytics.
- **Message Frame**: Individual utterance or assistant response annotated with timestamps, role, and privacy metadata.
- **Storage Namespace**: Unique directory under the workspace storage URI reserved for Agent Voice conversation assets.
- **Retention Window**: Maximum lifetime assigned to a conversation before automatic purge triggers.
- **Secure Deletion**: Process that overwrites, truncates, and removes serialized data to prevent recovery.
- **Write Compaction**: Batched operation merging incremental changes into a new encrypted blob while discarding prior revisions.
- **Recovery Snapshot**: Minimal payload allowing rapid restoration of in-progress conversation after crash or restart.
- **Encryption Envelope**: Structure holding ciphertext, initialization vector, auth tag, and schema version metadata for persisted blobs.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Storage service SHALL persist conversations using workspace-scoped storage obtained from `ExtensionContext.storageUri` with directory name `agentvoice/conversations`.
- **REQ-002**: Storage operations SHALL expose CRUD APIs (`createRecord`, `updateRecord`, `getRecord`, `listRecords`, `deleteRecord`, `purgeAll`).
- **REQ-003**: `listRecords` SHALL return records sorted by `lastInteractionAt` descending and support cursor-based pagination for future UI scenarios.
- **REQ-004**: Storage service SHALL publish `conversationStored` and `conversationDeleted` events for downstream subscribers (e.g., SP-062 history UI).
- **REQ-005**: Crash recovery snapshots SHALL be flushed within 2 seconds after every assistant response to guarantee resumability.
- **DAT-001**: Conversation record schema SHALL include identifiers, timestamps, title, participants, redaction flags, summary shards, and storage metrics as defined in Section 4.
- **DAT-002**: Message frames SHALL preserve sequence numbers, role, transcript text (redacted), audio references, and privacy annotations.
- **SEC-001**: Persisted blobs SHALL be encrypted using AES-256-GCM with per-workspace keys stored in VS Code SecretStorage under `agentvoice.conversation.key`.
- **SEC-002**: Storage filenames SHALL incorporate SHA-256 hashes of conversation IDs to prevent metadata leakage.
- **SEC-003**: Decryption failures SHALL be treated as fatal storage errors, triggering purge of corrupted blobs and notifying recovery orchestrator (SP-028).
- **PRI-001**: Only transcripts that pass privacy sanitization per SP-027 SHALL be persisted; sensitive markers MUST remain in metadata without storing raw values.
- **PRI-002**: User-initiated purge commands SHALL complete within 500 ms per record and emit `privacy.purge.completed` telemetry.
- **RET-001**: Default retention window SHALL be 30 days; configuration SHALL allow 7–180 day range with per-workspace overrides stored in settings (SP-002).
- **RET-002**: A retention sweep SHALL execute on activation and every 6 hours, deleting expired records and secure-deleting blobs.
- **INT-001**: Session manager (SP-005) SHALL call `commitConversation` when sessions transition to `Ending` or `Failed`, providing final summaries and metrics.
- **INT-002**: Cleanup orchestrator (SP-053) SHALL register storage scopes ensuring pending writes finalize before disposal completes.
- **INT-003**: Privacy purge events (SP-027) SHALL invoke storage purge APIs with reason codes propagated to telemetry.
- **CON-001**: Individual conversation payloads SHALL NOT exceed 10 MB uncompressed; storage service SHALL chunk large attachments and reject oversize writes.
- **CON-002**: Write latency SHALL remain under 150 ms for 95th percentile of commits on SSD-backed environments; exceeding this threshold SHALL raise a warning metric.
- **CON-003**: Storage SHALL remain resilient when disk quota is exhausted by surfacing actionable errors and deferring new writes until purge frees space.
- **GUD-001**: Apply write compaction after every five updates to minimize fragmentation and stale blobs.
- **GUD-002**: Maintain a lightweight in-memory index of conversation metadata for fast lookups, invalidating on schema migrations or purge events.
- **GUD-003**: Defer heavy summarization tasks until after initial persistence to keep write latency low.
- **PAT-001**: Implement Repository pattern isolating storage medium from domain consumers, enabling unit testing with in-memory adapters.
- **PAT-002**: Use Circuit Breaker from SP-037 around disk IO to prevent cascading failures during repeated write errors.

## 4. Interfaces & Data Contracts

### Storage Service Interface

```typescript
export interface ConversationStorageService extends ServiceInitializable {
  createRecord(record: ConversationRecordInput): Promise<ConversationRecord>;
  updateRecord(conversationId: string, mutation: ConversationRecordMutation): Promise<ConversationRecord>;
  getRecord(conversationId: string): Promise<ConversationRecord | undefined>;
  listRecords(options?: ListOptions): Promise<ListResult<ConversationRecordSummary>>;
  deleteRecord(conversationId: string, reason: PurgeReason): Promise<void>;
  purgeAll(reason: PurgeReason): Promise<PurgeReport>;
  commitSnapshot(snapshot: RecoverySnapshot): Promise<void>;
  getSnapshot(conversationId: string): Promise<RecoverySnapshot | undefined>;
}

export interface ListOptions {
  limit?: number;
  cursor?: string;
  includeExpired?: boolean;
}

export interface ListResult<T> {
  items: T[];
  nextCursor?: string;
  totalCount: number;
}
```

### Conversation Record Schema

```typescript
export interface ConversationRecord {
  conversationId: string;
  version: number; // schema version
  title: string;
  createdAt: string; // ISO 8601
  lastInteractionAt: string;
  summary?: ConversationSummary;
  participants: ParticipantRef[];
  messages: MessageFrame[];
  attachments?: AttachmentRef[];
  metrics: ConversationMetrics;
  retention: RetentionInfo;
  privacy: PrivacyEnvelope;
  storage: StorageEnvelope;
}

export interface ConversationRecordInput {
  conversationId: string;
  title: string;
  createdAt: string;
  participants: ParticipantRef[];
  messages: MessageFrame[];
  summary?: ConversationSummary;
  metrics?: Partial<ConversationMetrics>;
}

export interface ConversationRecordMutation {
  title?: string;
  appendMessages?: MessageFrame[];
  summary?: ConversationSummary;
  retention?: Partial<RetentionInfo>;
  metrics?: Partial<ConversationMetrics>;
}

export interface ParticipantRef {
  id: string;
  role: 'user' | 'assistant' | 'system';
  displayName?: string;
}

export interface MessageFrame {
  frameId: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string; // redacted text
  createdAt: string;
  attachments?: AttachmentRef[];
  privacy: {
    containsSecrets: boolean;
    redactionRulesApplied: string[];
    piiTokens?: string[]; // hashed tokens only
  };
  audio?: AudioArtifactRef;
}

export interface AttachmentRef {
  attachmentId: string;
  type: 'audio' | 'transcript' | 'code' | 'document';
  uri: string; // relative path under storage namespace
  checksum: string; // SHA-256
  byteLength: number;
}

export interface AudioArtifactRef {
  uri: string;
  format: 'pcm16' | 'opus';
  durationMs: number;
}

export interface ConversationSummary {
  synopsis: string;
  lastUpdatedAt: string;
  keywords: string[];
  actionItems?: string[];
}

export interface ConversationMetrics {
  userUtteranceCount: number;
  assistantUtteranceCount: number;
  durationMs: number;
  averageLatencyMs: number;
}

export interface RetentionInfo {
  retentionExpiresAt: string;
  retentionPolicy: 'workspace-default' | 'custom';
  manualHold?: boolean;
}

export interface PrivacyEnvelope {
  classification: 'Confidential';
  exportable: boolean;
  consentCapture?: string;
}

export interface StorageEnvelope {
  blobUri: string;
  blobVersion: number;
  sizeBytes: number;
  checksum: string;
  lastCompactedAt?: string;
}
```

### Encryption Envelope

```typescript
export interface EncryptedBlob {
  conversationId: string;
  schemaVersion: number;
  cipherText: ArrayBuffer;
  iv: ArrayBuffer;
  authTag: ArrayBuffer;
  createdAt: string;
  checksum: string; // SHA-256 of plaintext for integrity verification
}
```

### Purge Reporting

```typescript
export type PurgeReason =
  | 'user-requested'
  | 'retention-expired'
  | 'privacy-policy-change'
  | 'workspace-reset'
  | 'corruption-detected';

export interface PurgeReport {
  reason: PurgeReason;
  startedAt: string;
  completedAt: string;
  purgedCount: number;
  failures: PurgeFailure[];
}

export interface PurgeFailure {
  conversationId: string;
  error: string;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given an active session ends, When `commitConversation` is invoked, Then the conversation record is encrypted, persisted within 150 ms, and becomes available via `listRecords` sorted newest first.
- **AC-002**: Given a user requests to resume the last session after crash, When `getSnapshot` runs, Then the recovery snapshot decrypts successfully and restores the conversation state within 2 seconds.
- **AC-003**: Given retention is configured to 14 days, When activation occurs after 15 days of inactivity, Then all records older than 14 days are securely deleted and no longer returned by `listRecords`.
- **AC-004**: Given a purge request citing privacy concerns, When `deleteRecord` executes, Then ciphertext and attachment files are removed and telemetry records reason `privacy-policy-change`.
- **AC-005**: Given decryption fails due to tampering, When `getRecord` runs, Then the record is quarantined, the blob is purged, and recovery orchestrator receives an error event.
- **AC-006**: Given storage is exhausted, When a new conversation write occurs, Then storage service emits a capacity warning and retries after purge frees space without crashing the extension.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for encryption, serialization, retention scheduling, and purge flows; integration tests covering session handoff, crash recovery, and privacy purge; optional end-to-end tests verifying conversation history UI once SP-062 is implemented.
- **Frameworks**: Mocha + Chai for host-side logic, Sinon for clock and filesystem fakes, @vscode/test-electron for integration, and Playwright for UI validation.
- **Test Data Management**: Synthetic transcripts containing redaction markers, simulated attachments of varying sizes, and fixtures modeling corruption scenarios.
- **CI/CD Integration**: Persistence tests SHALL run within `npm run test:unit`; retention sweeps and purge paths SHALL execute in `npm run test:all` to validate long-running behavior.
- **Coverage Requirements**: ≥95% statement coverage on storage service core modules, ≥90% branch coverage for retention paths, 100% coverage on crypto key derivation code.
- **Performance Testing**: Benchmark commit latency and purge throughput using deterministic clocks; fail tests if 95th percentile exceeds CON-002 thresholds.
- **Resilience Testing**: Inject I/O failures and disc quota exhaustion to validate error handling and integration with retry strategy (SP-037).

## 7. Rationale & Context

1. **Reliability**: Persisting conversations ensures users can resume work and audit prior interactions, complementing session lifecycle guarantees in SP-005.
2. **Privacy Alignment**: Encryption, retention windows, and purge semantics uphold privacy obligations defined in SP-027 and propagate reason codes for audits.
3. **Deterministic Cleanup**: Integration with SP-053 ensures storage never blocks disposal and that secure deletion occurs during teardown.
4. **Future UX Enablement**: Structured schemas and events unlock history navigation experiences planned in SP-062 without reworking fundamentals.
5. **Resilience**: Crash snapshots and capacity handling reduce the risk of data loss and contribute to faster recovery orchestrated by SP-028.

## 8. Dependencies & External Integrations

### External Systems
- **EXT-001**: VS Code workspace storage (filesystem directory) – Provides physical persistence surface and imposes quota behavior.

### Third-Party Services
- **SVC-001**: Node Crypto module – Supplies AES-GCM encryption, RNG, and hash functions.

### Infrastructure Dependencies
- **INF-001**: Local filesystem permissions – Must allow read/write/delete operations for the storage namespace.
- **INF-002**: Optional sync services (VS Code Settings Sync) – Must not sync ciphertext blobs by default; only metadata stored in settings may sync.

### Data Dependencies
- **DAT-001**: Session summaries and metrics from SP-005 – Required to populate record metadata and durations.
- **DAT-002**: Privacy annotations from SP-027 – Required to mark redactions and enforce export eligibility.
- **DAT-003**: Disposal reports from SP-053 – Required to confirm purge completion during cleanup.

### Technology Platform Dependencies
- **PLT-001**: Node.js 22 Buffer and stream APIs – Required for efficient encryption and file IO.
- **PLT-002**: VS Code SecretStorage – Required to hold encryption keys securely.

### Compliance Dependencies
- **COM-001**: Privacy policy (SP-027) – Dictates retention and export rules.
- **COM-002**: Future compliance audit spec (SP-060) – Will reference stored conversation metadata for audit trails.

## 9. Examples & Edge Cases

```typescript
const storage = await conversationStorageFactory.initialize(context);

const record = await storage.createRecord({
  conversationId: crypto.randomUUID(),
  title: 'Debugging failing test',
  createdAt: new Date().toISOString(),
  participants: [
    { id: 'user-default', role: 'user', displayName: 'You' },
    { id: 'assistant-agentvoice', role: 'assistant', displayName: 'Agent Voice' }
  ],
  messages: [
    {
      frameId: crypto.randomUUID(),
      sequence: 1,
      role: 'user',
      content: 'Why is the build failing?',
      createdAt: new Date().toISOString(),
      privacy: { containsSecrets: false, redactionRulesApplied: [] }
    }
  ]
});

await storage.updateRecord(record.conversationId, {
  appendMessages: [
    {
      frameId: crypto.randomUUID(),
      sequence: 2,
      role: 'assistant',
      content: 'The lint step is failing on unused imports.',
      createdAt: new Date().toISOString(),
      privacy: { containsSecrets: false, redactionRulesApplied: [] }
    }
  ],
  summary: {
    synopsis: 'Identified lint failure root cause',
    lastUpdatedAt: new Date().toISOString(),
    keywords: ['lint', 'unused imports']
  }
});

const history = await storage.listRecords({ limit: 5 });
console.log(history.items.map(item => item.title));
```

Edge cases to validate:

- Recovery snapshot corrupted mid-write: storage detects partial file, retries once, then recreates snapshot.
- User toggles retention to 7 days: scheduler immediately purges records older than 7 days and logs summary.
- Workspace shared across multiple sessions simultaneously: concurrency control prevents last-write-wins from losing messages by using optimistic locking on `blobVersion`.
- Encryption key rotation: regenerating key re-encrypts all blobs using streaming migration to avoid downtime.

## 10. Validation Criteria

- Persistence unit and integration tests achieve coverage thresholds and pass under simulated I/O stress.
- Encryption and decryption routines verified with deterministic vectors and negative tampering tests.
- Retention sweeps remove expired records without impacting active sessions, confirmed via telemetry and manual inspection.
- Purge workflows emit telemetry events with accurate counts and zero residual files under storage namespace.
- Manual crash recovery scenario successfully restores conversation state using snapshots and commits final record.

## 11. Related Specifications / Further Reading

- [sp-005-spec-design-session-management.md](sp-005-spec-design-session-management.md)
- [sp-027-spec-security-privacy-data-handling.md](sp-027-spec-security-privacy-data-handling.md)
- [sp-053-spec-design-resource-cleanup.md](sp-053-spec-design-resource-cleanup.md)
- [sp-028-spec-architecture-error-handling.md](sp-028-spec-architecture-error-handling.md)
- [SP-062 Conversation History Navigation UI](../docs/design/FEATURE-PLAN.md#feature-plan)
- [VS Code Storage APIs](https://code.visualstudio.com/api/references/vscode-api#Memento)

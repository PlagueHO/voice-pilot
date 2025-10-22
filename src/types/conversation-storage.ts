import * as vscode from "vscode";
import type { ServiceInitializable } from "../core/service-initializable";
import type { PurgeReason } from "./privacy";

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

export interface ParticipantRef {
  id: string;
  role: "user" | "assistant" | "system";
  displayName?: string;
}

export interface AttachmentRef {
  attachmentId: string;
  type: "audio" | "transcript" | "code" | "document";
  uri: string;
  checksum: string;
  byteLength: number;
}

export interface AudioArtifactRef {
  uri: string;
  format: "pcm16" | "opus";
  durationMs: number;
}

export interface MessageFrame {
  frameId: string;
  sequence: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  attachments?: AttachmentRef[];
  privacy: {
    containsSecrets: boolean;
    redactionRulesApplied: string[];
    piiTokens?: string[];
  };
  audio?: AudioArtifactRef;
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
  retentionPolicy: "workspace-default" | "custom";
  manualHold?: boolean;
}

export interface PrivacyEnvelope {
  classification: "Confidential";
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

export interface ConversationRecord {
  conversationId: string;
  version: number;
  title: string;
  createdAt: string;
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

export interface ConversationRecordSummary {
  conversationId: string;
  title: string;
  createdAt: string;
  lastInteractionAt: string;
  messageCount: number;
  retention: RetentionInfo;
  metrics: ConversationMetrics;
  storage: StorageEnvelope;
  privacy: PrivacyEnvelope;
}

export interface RecoverySnapshot {
  conversationId: string;
  sessionId: string;
  lastInteractionAt: string;
  pendingMessages: MessageFrame[];
  updatedAt: string;
  summary?: ConversationSummary;
  metrics?: Partial<ConversationMetrics>;
}

export interface PurgeFailure {
  conversationId: string;
  error: string;
}

export interface PurgeReport {
  reason: PurgeReason;
  startedAt: string;
  completedAt: string;
  purgedCount: number;
  failures: PurgeFailure[];
}

export interface EncryptedBlob {
  conversationId: string;
  schemaVersion: number;
  cipherText: string;
  iv: string;
  authTag: string;
  createdAt: string;
  checksum: string;
}

export interface ConversationStorageEvents {
  conversationStored: ConversationRecordSummary;
  conversationDeleted: { conversationId: string; reason: PurgeReason };
}

export interface ConversationStorageService
  extends ServiceInitializable {
  createRecord(input: ConversationRecordInput): Promise<ConversationRecord>;
  updateRecord(
    conversationId: string,
    mutation: ConversationRecordMutation,
  ): Promise<ConversationRecord>;
  getRecord(
    conversationId: string,
  ): Promise<ConversationRecord | undefined>;
  listRecords(options?: ListOptions): Promise<ListResult<ConversationRecordSummary>>;
  deleteRecord(conversationId: string, reason: PurgeReason): Promise<void>;
  purgeAll(reason: PurgeReason): Promise<PurgeReport>;
  commitSnapshot(snapshot: RecoverySnapshot): Promise<void>;
  getSnapshot(
    conversationId: string,
  ): Promise<RecoverySnapshot | undefined>;
  commitConversation(
    conversationId: string,
    mutation: ConversationRecordMutation & {
      summary?: ConversationSummary;
      metrics?: Partial<ConversationMetrics>;
    },
  ): Promise<ConversationRecord>;
  readonly onConversationStored: vscode.Event<ConversationRecordSummary>;
  readonly onConversationDeleted: vscode.Event<{
    conversationId: string;
    reason: PurgeReason;
  }>;
}

export function isConversationMetrics(value: unknown): value is ConversationMetrics {
  if (!value || typeof value !== "object") {
    return false;
  }
  const metrics = value as ConversationMetrics;
  return (
    typeof metrics.userUtteranceCount === "number" &&
    typeof metrics.assistantUtteranceCount === "number" &&
    typeof metrics.durationMs === "number" &&
    typeof metrics.averageLatencyMs === "number"
  );
}

export function isRetentionInfo(value: unknown): value is RetentionInfo {
  if (!value || typeof value !== "object") {
    return false;
  }
  const retention = value as RetentionInfo;
  return (
    typeof retention.retentionExpiresAt === "string" &&
    (retention.retentionPolicy === "workspace-default" ||
      retention.retentionPolicy === "custom")
  );
}

export function isPrivacyEnvelope(value: unknown): value is PrivacyEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const privacy = value as PrivacyEnvelope;
  return (
    privacy.classification === "Confidential" &&
    typeof privacy.exportable === "boolean"
  );
}

export function isStorageEnvelope(value: unknown): value is StorageEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const storage = value as StorageEnvelope;
  return (
    typeof storage.blobUri === "string" &&
    typeof storage.blobVersion === "number" &&
    typeof storage.sizeBytes === "number" &&
    typeof storage.checksum === "string"
  );
}

export function isConversationRecord(value: unknown): value is ConversationRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as ConversationRecord;
  return (
    typeof record.conversationId === "string" &&
    typeof record.version === "number" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.lastInteractionAt === "string" &&
    Array.isArray(record.participants) &&
    Array.isArray(record.messages) &&
    isConversationMetrics(record.metrics) &&
    isRetentionInfo(record.retention) &&
    isPrivacyEnvelope(record.privacy) &&
    isStorageEnvelope(record.storage)
  );
}

export function isConversationRecordSummary(
  value: unknown,
): value is ConversationRecordSummary {
  if (!value || typeof value !== "object") {
    return false;
  }
  const summary = value as ConversationRecordSummary;
  return (
    typeof summary.conversationId === "string" &&
    typeof summary.title === "string" &&
    typeof summary.createdAt === "string" &&
    typeof summary.lastInteractionAt === "string" &&
    typeof summary.messageCount === "number" &&
    isConversationMetrics(summary.metrics) &&
    isRetentionInfo(summary.retention) &&
    isPrivacyEnvelope(summary.privacy) &&
    isStorageEnvelope(summary.storage)
  );
}

export function isRecoverySnapshot(value: unknown): value is RecoverySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const snapshot = value as RecoverySnapshot;
  return (
    typeof snapshot.conversationId === "string" &&
    typeof snapshot.sessionId === "string" &&
    typeof snapshot.lastInteractionAt === "string" &&
    typeof snapshot.updatedAt === "string" &&
    Array.isArray(snapshot.pendingMessages)
  );
}

export function isPurgeReport(value: unknown): value is PurgeReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const report = value as PurgeReport;
  return (
    typeof report.reason === "string" &&
    typeof report.startedAt === "string" &&
    typeof report.completedAt === "string" &&
    typeof report.purgedCount === "number" &&
    Array.isArray(report.failures)
  );
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  if (!value || typeof value !== "object") {
    return false;
  }
  const blob = value as EncryptedBlob;
  return (
    typeof blob.conversationId === "string" &&
    typeof blob.schemaVersion === "number" &&
    typeof blob.cipherText === "string" &&
    typeof blob.iv === "string" &&
    typeof blob.authTag === "string" &&
    typeof blob.createdAt === "string" &&
    typeof blob.checksum === "string"
  );
}

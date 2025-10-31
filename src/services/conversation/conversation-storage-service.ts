import { createHash } from 'crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '../../core/logger';
import {
    ConversationMetrics,
    ConversationRecord,
    ConversationRecordInput,
    ConversationRecordMutation,
    ConversationRecordSummary,
    ConversationStorageService,
    ConversationSummary,
    EncryptedBlob,
    ListOptions,
    ListResult,
    MessageFrame,
    PurgeReport,
    RecoverySnapshot,
    RetentionInfo,
    StorageEnvelope,
} from '../../types/conversation-storage';
import type { PurgeReason } from '../../types/privacy';
import { calculateRetentionExpiry } from '../../types/privacy';
import { PrivacyController } from '../privacy/privacy-controller';
import {
    EncryptionComponents,
    decryptPayload,
    encryptPayload,
    loadOrCreateWorkspaceKey,
} from './conversation-storage-crypto';

const MAX_UNCOMPRESSED_BYTES = 10 * 1024 * 1024;
const SCHEMA_VERSION = 1;
const STORAGE_NAMESPACE = 'agentvoice';
const CONVERSATION_FOLDER = 'conversations';
const SNAPSHOT_FOLDER = 'snapshots';
const RETENTION_SWEEP_MS = 6 * 60 * 60 * 1000;

interface PersistResult {
  record: ConversationRecord;
  summary: ConversationRecordSummary;
}

interface CursorPayload {
  lastInteractionAt: string;
  conversationId: string;
}

export class ConversationStorageServiceImpl
  implements ConversationStorageService
{
  private readonly storedEmitter = new vscode.EventEmitter<ConversationRecordSummary>();
  private readonly deletedEmitter = new vscode.EventEmitter<{
    conversationId: string;
    reason: PurgeReason;
  }>();
  readonly onConversationStored = this.storedEmitter.event;
  readonly onConversationDeleted = this.deletedEmitter.event;

  private readonly index = new Map<string, ConversationRecordSummary>();
  private readonly retentionDisposables = new Map<string, vscode.Disposable>();
  private key: Buffer | undefined;
  private initialized = false;
  private storageRoot!: vscode.Uri;
  private snapshotRoot!: vscode.Uri;
  private retentionSweep?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly privacy: PrivacyController,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

      const baseStorageUri = await this.resolveStorageRoot();

    this.storageRoot = vscode.Uri.joinPath(
      baseStorageUri,
      STORAGE_NAMESPACE,
      CONVERSATION_FOLDER,
    );
    this.snapshotRoot = vscode.Uri.joinPath(
      baseStorageUri,
      STORAGE_NAMESPACE,
      SNAPSHOT_FOLDER,
    );

    await vscode.workspace.fs.createDirectory(this.storageRoot);
    await vscode.workspace.fs.createDirectory(this.snapshotRoot);

    this.key = await loadOrCreateWorkspaceKey(this.context);
    await this.hydrateIndex();

    this.retentionSweep = setInterval(() => {
      void this.performRetentionSweep();
    }, RETENTION_SWEEP_MS).unref?.();

    this.initialized = true;
    this.logger.info('ConversationStorageService initialized', {
      recordCount: this.index.size,
    });
  }

  dispose(): void {
    if (this.retentionSweep) {
      clearInterval(this.retentionSweep);
      this.retentionSweep = undefined;
    }
    for (const disposable of this.retentionDisposables.values()) {
      disposable.dispose();
    }
    this.retentionDisposables.clear();
    this.storedEmitter.dispose();
    this.deletedEmitter.dispose();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async createRecord(
    input: ConversationRecordInput,
  ): Promise<ConversationRecord> {
    this.ensureInitialized();
    if (this.index.has(input.conversationId)) {
      throw new Error(`Conversation ${input.conversationId} already exists`);
    }

    const metrics = this.normalizeMetrics(input.metrics);
    const retention = this.buildRetentionInfo(input.createdAt);
    const storage: StorageEnvelope = {
      blobUri: this.resolveRecordUri(input.conversationId).toString(),
      blobVersion: 1,
      sizeBytes: 0,
      checksum: '',
    };
    const summary = this.deriveSummary(
      input.conversationId,
      input.title,
      input.createdAt,
      input.messages,
      metrics,
      retention,
    );

    const record: ConversationRecord = {
      conversationId: input.conversationId,
      version: SCHEMA_VERSION,
      title: input.title,
      createdAt: input.createdAt,
      lastInteractionAt: summary.lastInteractionAt,
      summary: input.summary,
      participants: input.participants,
      messages: input.messages,
      attachments: undefined,
      metrics,
      retention,
      privacy: {
        classification: 'Confidential',
        exportable: false,
      },
      storage,
    };

    const persisted = await this.persistRecord(record);
    this.index.set(record.conversationId, persisted.summary);
    this.registerRetention(record.conversationId, persisted.summary);
    this.storedEmitter.fire(persisted.summary);

    return persisted.record;
  }

  async updateRecord(
    conversationId: string,
    mutation: ConversationRecordMutation,
  ): Promise<ConversationRecord> {
    this.ensureInitialized();
    const existing = await this.getRecord(conversationId);
    if (!existing) {
      throw new Error(`Conversation ${conversationId} does not exist`);
    }

    const updated: ConversationRecord = {
      ...existing,
      title: mutation.title ?? existing.title,
      summary: mutation.summary ?? existing.summary,
      retention: {
        ...existing.retention,
        ...mutation.retention,
        retentionExpiresAt:
          mutation.retention?.retentionExpiresAt ??
          existing.retention.retentionExpiresAt,
      },
      metrics: {
        ...existing.metrics,
        ...mutation.metrics,
      },
    };

    if (mutation.appendMessages?.length) {
      updated.messages = [...existing.messages, ...mutation.appendMessages];
      updated.lastInteractionAt = this.resolveLastInteraction(updated.messages);
    }

    const persisted = await this.persistRecord({
      ...updated,
      storage: {
        ...updated.storage,
        blobVersion: updated.storage.blobVersion + 1,
      },
    });
    this.index.set(conversationId, persisted.summary);
    this.registerRetention(conversationId, persisted.summary);
    this.storedEmitter.fire(persisted.summary);
    return persisted.record;
  }

  async commitConversation(
    conversationId: string,
    mutation: ConversationRecordMutation & {
      summary?: ConversationSummary;
      metrics?: Partial<ConversationMetrics>;
    },
  ): Promise<ConversationRecord> {
    const record = await this.updateRecord(conversationId, mutation);
    await this.deleteSnapshot(conversationId).catch((error) => {
      this.logger.warn('Failed to delete recovery snapshot after commit', {
        conversationId,
        error: (error as Error).message,
      });
    });
    return record;
  }

  async getRecord(
    conversationId: string,
  ): Promise<ConversationRecord | undefined> {
    this.ensureInitialized();
    const fileUri = this.resolveRecordUri(conversationId);
    try {
      const payload = await vscode.workspace.fs.readFile(fileUri);
      return this.deserializeRecord(conversationId, payload);
    } catch (error: any) {
      if (error?.code === 'FileNotFound' || error?.name === 'EntryNotFound') {
        return undefined;
      }
      this.logger.error('Failed to read conversation record', {
        conversationId,
        error: error?.message ?? error,
      });
      throw error;
    }
  }

  async listRecords(
    options: ListOptions = {},
  ): Promise<ListResult<ConversationRecordSummary>> {
    this.ensureInitialized();
    const { limit = 20, cursor, includeExpired = false } = options;
    
    // Optimization: Iterate directly instead of creating intermediate array
    const summaries: ConversationRecordSummary[] = [];
    const now = Date.now();
    for (const entry of this.index.values()) {
      if (includeExpired) {
        summaries.push(entry);
      } else if (entry.retention.manualHold) {
        summaries.push(entry);
      } else if (new Date(entry.retention.retentionExpiresAt).getTime() > now) {
        summaries.push(entry);
      }
    }

    summaries.sort((a, b) =>
      new Date(b.lastInteractionAt).getTime() -
      new Date(a.lastInteractionAt).getTime(),
    );

    let startIndex = 0;
    if (cursor) {
      try {
        const payload = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        ) as CursorPayload;
        startIndex = summaries.findIndex(
          (item) =>
            item.conversationId === payload.conversationId &&
            item.lastInteractionAt === payload.lastInteractionAt,
        );
        if (startIndex >= 0) {
          startIndex += 1;
        } else {
          startIndex = 0;
        }
      } catch (error: any) {
        this.logger.warn('Failed to parse list cursor; restarting from beginning', {
          cursor,
          error: error?.message ?? error,
        });
        startIndex = 0;
      }
    }

    const paged = summaries.slice(startIndex, startIndex + limit);
    let nextCursor: string | undefined;
    if (startIndex + limit < summaries.length && paged.length) {
      const last = paged[paged.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({
          lastInteractionAt: last.lastInteractionAt,
          conversationId: last.conversationId,
        }),
      ).toString('base64url');
    }

    return {
      items: paged,
      nextCursor,
      totalCount: summaries.length,
    };
  }

  async deleteRecord(
    conversationId: string,
    reason: PurgeReason,
  ): Promise<void> {
    this.ensureInitialized();
    const fileUri = this.resolveRecordUri(conversationId);
    const snapshotUri = this.resolveSnapshotUri(conversationId);
    try {
      const payload = await vscode.workspace.fs.readFile(fileUri);
      await this.secureDelete(fileUri, payload.length);
    } catch (error: any) {
      if (error?.code !== 'FileNotFound' && error?.name !== 'EntryNotFound') {
        this.logger.warn('Failed to remove conversation record payload', {
          conversationId,
          error: error?.message ?? error,
        });
      }
    }

    try {
      await vscode.workspace.fs.delete(fileUri);
    } catch (error: any) {
      if (error?.code !== 'FileNotFound' && error?.name !== 'EntryNotFound') {
        this.logger.debug('Conversation record delete ignored', {
          conversationId,
          error: error?.message ?? error,
        });
      }
    }
    try {
      await vscode.workspace.fs.delete(snapshotUri);
    } catch (error: any) {
      if (error?.code !== 'FileNotFound' && error?.name !== 'EntryNotFound') {
        this.logger.debug('Snapshot delete ignored', {
          conversationId,
          error: error?.message ?? error,
        });
      }
    }

    const summary = this.index.get(conversationId);
    if (summary?.storage) {
      this.logger.info('Conversation record deleted', {
        conversationId,
        reason,
      });
    }
    this.index.delete(conversationId);
    this.disposeRetention(conversationId);
    this.deletedEmitter.fire({ conversationId, reason });
  }

  async purgeAll(reason: PurgeReason): Promise<PurgeReport> {
    this.ensureInitialized();
    const startedAt = new Date().toISOString();
    const failures: { conversationId: string; error: string }[] = [];
    const conversations = Array.from(this.index.keys());

    for (const conversationId of conversations) {
      try {
        await this.deleteRecord(conversationId, reason);
      } catch (error: any) {
        failures.push({
          conversationId,
          error: error?.message ?? String(error),
        });
      }
    }

    const completedAt = new Date().toISOString();
    return {
      reason,
      startedAt,
      completedAt,
      purgedCount: conversations.length - failures.length,
      failures,
    };
  }

  async commitSnapshot(snapshot: RecoverySnapshot): Promise<void> {
    this.ensureInitialized();
    const payload = JSON.stringify(snapshot);
    const components = encryptPayload(this.key!, payload);
    await this.writeEncryptedBlob(
      snapshot.conversationId,
      components,
      payload,
      this.resolveSnapshotUri(snapshot.conversationId),
    );
  }

  async getSnapshot(
    conversationId: string,
  ): Promise<RecoverySnapshot | undefined> {
    this.ensureInitialized();
    try {
      const content = await vscode.workspace.fs.readFile(
        this.resolveSnapshotUri(conversationId),
      );
      const record = await this.deserializeBlob(conversationId, content);
      return JSON.parse(record.toString('utf8')) as RecoverySnapshot;
    } catch (error: any) {
      if (error?.code === 'FileNotFound' || error?.name === 'EntryNotFound') {
        return undefined;
      }
      this.logger.warn('Failed to read recovery snapshot', {
        conversationId,
        error: error?.message ?? error,
      });
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ConversationStorageService is not initialized');
    }
  }

  private async hydrateIndex(): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(this.storageRoot);
    for (const [name, type] of entries) {
      if (!name.endsWith('.vpconv') || type !== vscode.FileType.File) {
        continue;
      }
      const hash = name.replace('.vpconv', '');
      const payload = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(this.storageRoot, `${hash}.vpconv`),
      );
      try {
        const conversationId = await this.extractConversationId(payload);
        if (!conversationId) {
          continue;
        }
        const record = await this.deserializeRecord(conversationId, payload);
        const summary = this.deriveSummary(
          record.conversationId,
          record.title,
          record.createdAt,
          record.messages,
          record.metrics,
          record.retention,
        );
        summary.storage = record.storage;
        summary.privacy = record.privacy;
        summary.lastInteractionAt = record.lastInteractionAt;
        summary.messageCount = record.messages.length;
        this.index.set(conversationId, summary);
        this.registerRetention(conversationId, summary);
      } catch (error: any) {
        this.logger.warn('Failed to hydrate stored conversation; purging blob', {
          file: name,
          error: error?.message ?? error,
        });
        await this.deleteCorruptedBlob(name);
      }
    }
  }

  private async extractConversationId(payload: Uint8Array): Promise<string> {
    const blob = JSON.parse(Buffer.from(payload).toString('utf8')) as EncryptedBlob;
    return blob.conversationId;
  }

  private async deleteCorruptedBlob(fileName: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(
        vscode.Uri.joinPath(this.storageRoot, fileName),
      );
    } catch (error: any) {
      this.logger.debug('Failed to delete corrupted blob during hydration', {
        fileName,
        error: error?.message ?? error,
      });
    }
  }

  private resolveRecordUri(conversationId: string): vscode.Uri {
    const hash = createHash('sha256').update(conversationId).digest('hex');
    return vscode.Uri.joinPath(
      this.storageRoot,
      `${hash.substring(0, 32)}.vpconv`,
    );
  }

  private resolveSnapshotUri(conversationId: string): vscode.Uri {
    const hash = createHash('sha256').update(conversationId).digest('hex');
    return vscode.Uri.joinPath(
      this.snapshotRoot,
      `${hash.substring(0, 32)}.vpsnap`,
    );
  }

  private deriveSummary(
    conversationId: string,
    title: string,
    createdAt: string,
    messages: MessageFrame[],
    metrics: ConversationMetrics,
    retention: RetentionInfo,
  ): ConversationRecordSummary {
    const lastInteractionAt = this.resolveLastInteraction(messages) ?? createdAt;
    return {
      conversationId,
      title,
      createdAt,
      lastInteractionAt,
      messageCount: messages.length,
      retention,
      metrics,
      storage: {
        blobUri: this.resolveRecordUri(conversationId).toString(),
        blobVersion: 1,
        sizeBytes: 0,
        checksum: '',
      },
      privacy: {
        classification: 'Confidential',
        exportable: false,
      },
    };
  }

  private resolveLastInteraction(messages: MessageFrame[]): string {
    if (!messages.length) {
      return new Date().toISOString();
    }
    const last = messages.reduce((latest, current) =>
      new Date(current.createdAt).getTime() >
      new Date(latest.createdAt).getTime()
        ? current
        : latest,
    );
    return last.createdAt;
  }

  private buildRetentionInfo(createdAt: string): RetentionInfo {
    const retentionSeconds = this.privacy.getRetentionSeconds('final-transcript');
    return {
      retentionExpiresAt: calculateRetentionExpiry(createdAt, retentionSeconds),
      retentionPolicy: 'workspace-default',
    };
  }

  private normalizeMetrics(partial?: Partial<ConversationMetrics>): ConversationMetrics {
    return {
      userUtteranceCount: partial?.userUtteranceCount ?? 0,
      assistantUtteranceCount: partial?.assistantUtteranceCount ?? 0,
      durationMs: partial?.durationMs ?? 0,
      averageLatencyMs: partial?.averageLatencyMs ?? 0,
    };
  }

  private async persistRecord(record: ConversationRecord): Promise<PersistResult> {
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(
        `Conversation payload exceeds ${MAX_UNCOMPRESSED_BYTES} byte limit`,
      );
    }
    const components = encryptPayload(this.key!, serialized);
    const fileUri = this.resolveRecordUri(record.conversationId);
    await this.writeEncryptedBlob(
      record.conversationId,
      components,
      serialized,
      fileUri,
    );
    const checksum = createHash('sha256').update(serialized).digest('hex');
    const summary = this.deriveSummary(
      record.conversationId,
      record.title,
      record.createdAt,
      record.messages,
      record.metrics,
      record.retention,
    );
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    const blobVersion = record.storage.blobVersion;
    summary.storage = {
      blobUri: fileUri.toString(),
      blobVersion,
      sizeBytes,
      checksum,
      lastCompactedAt:
        blobVersion % 5 === 0 ? new Date().toISOString() : undefined,
    };
    summary.privacy = record.privacy;
    const updatedRecord: ConversationRecord = {
      ...record,
      storage: summary.storage,
    };
    return { record: updatedRecord, summary };
  }

  private async writeEncryptedBlob(
    conversationId: string,
    components: EncryptionComponents,
    plaintext: string,
    uri: vscode.Uri,
  ): Promise<void> {
    const blob: EncryptedBlob = {
      conversationId,
      schemaVersion: SCHEMA_VERSION,
      cipherText: components.cipherText.toString('base64'),
      iv: components.iv.toString('base64'),
      authTag: components.authTag.toString('base64'),
      createdAt: new Date().toISOString(),
      checksum: createHash('sha256').update(plaintext).digest('hex'),
    };
    const buffer = Buffer.from(JSON.stringify(blob), 'utf8');
    const started = performance.now();
    await vscode.workspace.fs.writeFile(uri, buffer);
    const elapsed = performance.now() - started;
    if (elapsed > 150) {
      this.logger.warn('Conversation storage write exceeded latency budget', {
        conversationId,
        latencyMs: Math.round(elapsed),
      });
    }
  }

  private async deserializeRecord(
    conversationId: string,
    payload: Uint8Array,
  ): Promise<ConversationRecord> {
    const plaintext = await this.deserializeBlob(conversationId, payload);
    return JSON.parse(plaintext.toString('utf8')) as ConversationRecord;
  }

  private async deserializeBlob(
    conversationId: string,
    payload: Uint8Array,
  ): Promise<Buffer> {
    const blob = JSON.parse(Buffer.from(payload).toString('utf8')) as EncryptedBlob;
    if (blob.conversationId !== conversationId) {
      throw new Error('Encrypted blob conversation mismatch');
    }
    const decrypted = decryptPayload(this.key!, {
      cipherText: Buffer.from(blob.cipherText, 'base64'),
      iv: Buffer.from(blob.iv, 'base64'),
      authTag: Buffer.from(blob.authTag, 'base64'),
    });
    const checksum = createHash('sha256').update(decrypted).digest('hex');
    if (checksum !== blob.checksum) {
      throw new Error('Conversation blob checksum mismatch');
    }
    return decrypted;
  }

  private registerRetention(
    conversationId: string,
    summary: ConversationRecordSummary,
  ): void {
    this.disposeRetention(conversationId);
    const disposable = this.privacy.registerRetention({
      id: `conversation:${conversationId}`,
      target: 'transcripts',
      category: 'final-transcript',
      classification: 'Confidential',
      createdAt: summary.createdAt,
      metadata: {
        conversationId,
        title: summary.title,
      },
      purge: async (reason) => {
        await this.deleteRecord(conversationId, reason);
        return 1;
      },
    });
    this.retentionDisposables.set(conversationId, disposable);
  }

  private disposeRetention(conversationId: string): void {
    const disposable = this.retentionDisposables.get(conversationId);
    disposable?.dispose();
    this.retentionDisposables.delete(conversationId);
  }

  private async secureDelete(uri: vscode.Uri, size: number): Promise<void> {
    try {
      const zeros = Buffer.alloc(size);
      await vscode.workspace.fs.writeFile(uri, zeros);
    } catch (error: any) {
      this.logger.warn('Failed to zero-fill conversation blob', {
        uri: uri.toString(),
        error: error?.message ?? error,
      });
    }
  }

  private async deleteSnapshot(conversationId: string): Promise<void> {
    const uri = this.resolveSnapshotUri(conversationId);
    try {
      await vscode.workspace.fs.delete(uri);
    } catch (error: any) {
      if (error?.code !== 'FileNotFound' && error?.name !== 'EntryNotFound') {
        this.logger.debug('Snapshot delete failed', {
          conversationId,
          error: error?.message ?? error,
        });
      }
    }
  }

  private async performRetentionSweep(): Promise<void> {
    const now = Date.now();
    // Optimization: Collect expired entries directly without intermediate array
    const expired: ConversationRecordSummary[] = [];
    for (const summary of this.index.values()) {
      const isExpired = !summary.retention.manualHold && 
                        new Date(summary.retention.retentionExpiresAt).getTime() <= now;
      if (isExpired) {
        expired.push(summary);
      }
    }
    
    for (const summary of expired) {
      try {
        await this.deleteRecord(summary.conversationId, 'retention-expired');
      } catch (error: any) {
        this.logger.warn('Retention sweep failed for conversation', {
          conversationId: summary.conversationId,
          error: error?.message ?? error,
        });
      }
    }
  }

  private async resolveStorageRoot(): Promise<vscode.Uri> {
    const candidates: Array<{ uri: vscode.Uri; source: 'workspace' | 'global' }> = [];
    if (this.context.storageUri) {
      candidates.push({ uri: this.context.storageUri, source: 'workspace' });
    }
    if (this.context.globalStorageUri) {
      candidates.push({ uri: this.context.globalStorageUri, source: 'global' });
    }

    for (const candidate of candidates) {
      try {
        await vscode.workspace.fs.createDirectory(candidate.uri);
        if (candidate.source === 'global' && !this.context.storageUri) {
          this.logger.warn('Missing workspace storageUri; using globalStorageUri for conversation storage');
        }
        return candidate.uri;
      } catch (error: any) {
        this.logger.warn('Unable to prepare conversation storage root candidate', {
          source: candidate.source,
          uri: candidate.uri.toString(),
          error: error?.message ?? error,
        });
      }
    }

    const extensionIdentifier = this.context.extensionUri
      ? createHash('sha1').update(this.context.extensionUri.fsPath).digest('hex').substring(0, 16)
      : 'agentvoice';
    const fallbackPath = path.join(
      tmpdir(),
      STORAGE_NAMESPACE,
      extensionIdentifier,
      'workspace',
    );
    const fallbackUri = vscode.Uri.file(fallbackPath);
    await vscode.workspace.fs.createDirectory(fallbackUri);
    this.logger.warn(
      'Conversation storage using temporary filesystem fallback due to unavailable VS Code storage directories',
      {
        fallbackPath,
      },
    );
    return fallbackUri;
  }
}

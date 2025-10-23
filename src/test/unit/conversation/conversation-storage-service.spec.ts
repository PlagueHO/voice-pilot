import { createHash } from 'crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Logger } from '../../../core/logger';
import { ConversationStorageServiceImpl } from '../../../services/conversation/conversation-storage-service';
import type {
  PrivacyController,
  RetentionRegistration,
} from '../../../services/privacy/privacy-controller';
import type {
  ConversationRecordInput,
  MessageFrame,
  RecoverySnapshot,
} from '../../../types/conversation-storage';
import type { PurgeReason } from '../../../types/privacy';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

class TestSecretStorage implements vscode.SecretStorage {
  private readonly secrets = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async storeSecret(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
    this.emitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
    this.emitter.fire({ key });
  }

  // SecretStorage interface expects `store`, `get`, `delete`
  store(key: string, value: string): Thenable<void> {
    return this.storeSecret(key, value);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}

class PrivacyControllerStub {
  readonly registered = new Map<string, RetentionRegistration>();
  private readonly disposables = new Map<string, vscode.Disposable>();
  private seconds = 3600;

  setRetentionSeconds(seconds: number): void {
    this.seconds = seconds;
  }

  getRetentionSeconds(_: unknown = undefined): number {
    return this.seconds;
  }

  registerRetention(registration: RetentionRegistration): vscode.Disposable {
    this.registered.set(registration.id, registration);
    const disposable = new vscode.Disposable(() => {
      this.registered.delete(registration.id);
      this.disposables.delete(registration.id);
    });
    this.disposables.set(registration.id, disposable);
    return disposable;
  }
}

function createConversationInput(conversationId: string, createdAt = new Date().toISOString()): ConversationRecordInput {
  const message: MessageFrame = {
    frameId: `${conversationId}-frame-1`,
    sequence: 1,
    role: 'user',
    content: 'Hello VoicePilot',
    createdAt,
    privacy: {
      containsSecrets: false,
      redactionRulesApplied: [],
    },
  };
  return {
    conversationId,
    title: `Conversation ${conversationId}`,
    createdAt,
    participants: [
      { id: 'user', role: 'user', displayName: 'Test User' },
      { id: 'assistant', role: 'assistant', displayName: 'VoicePilot' },
    ],
    messages: [message],
  };
}

function createTestLogger() {
  const entries: { level: 'info' | 'warn' | 'error' | 'debug'; message: string }[] = [];
  const logger = {
    info(message: string) {
      entries.push({ level: 'info', message });
    },
    warn(message: string) {
      entries.push({ level: 'warn', message });
    },
    error(message: string) {
      entries.push({ level: 'error', message });
    },
    debug(message: string) {
      entries.push({ level: 'debug', message });
    },
  } as unknown as Logger;
  return { logger, entries };
}

suite('Unit: ConversationStorageServiceImpl', () => {
  let service: ConversationStorageServiceImpl;
  let context: vscode.ExtensionContext;
  let secrets: TestSecretStorage;
  let privacy: PrivacyControllerStub;
  let tempDir: string;
  let restoreFs: (() => void) | undefined;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vp-conv-'));
    secrets = new TestSecretStorage();
    privacy = new PrivacyControllerStub();
    const { logger } = createTestLogger();

    restoreFs = stubWorkspaceFs();

    context = {
      storageUri: vscode.Uri.file(tempDir),
      secrets,
    } as unknown as vscode.ExtensionContext;

    service = new ConversationStorageServiceImpl(
      context,
      privacy as unknown as PrivacyController,
      logger,
    );
    await service.initialize();
  });

  afterEach(async () => {
    service.dispose();
    restoreFs?.();
    restoreFs = undefined;
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  test('creates and retrieves encrypted conversation records', async () => {
    const input = createConversationInput('conv-1');
    const record = await service.createRecord(input);

    expect(record.conversationId).to.equal('conv-1');
    expect(record.messages).to.have.length(1);

    const hashed = createHash('sha256').update('conv-1').digest('hex').substring(0, 32);
    const fileUri = vscode.Uri.joinPath(
      context.storageUri!,
      'voicepilot',
      'conversations',
      `${hashed}.vpconv`,
    );
    const stored = await vscode.workspace.fs.readFile(fileUri);
    expect(Buffer.from(stored).toString('utf8')).to.not.include('Hello VoicePilot');

    const fetched = await service.getRecord('conv-1');
    expect(fetched?.messages[0].content).to.equal('Hello VoicePilot');
  });

  test('retention sweep purges expired conversations', async () => {
    await service.createRecord(createConversationInput('conv-2'));
    const index = (service as any).index as Map<string, any>;
    const summary = index.get('conv-2');
    summary.retention.retentionExpiresAt = new Date(Date.now() - 10).toISOString();

    await (service as any).performRetentionSweep();

    expect(await service.getRecord('conv-2')).to.be.undefined;
  });

  test('listRecords honours cursor pagination', async () => {
    const createdAtA = new Date(Date.now() - 2000).toISOString();
    const createdAtB = new Date(Date.now() - 1000).toISOString();
    await service.createRecord(createConversationInput('conv-3', createdAtA));
    await service.createRecord(createConversationInput('conv-4', createdAtB));

    const pageOne = await service.listRecords({ limit: 1 });
    expect(pageOne.items).to.have.length(1);
    expect(pageOne.nextCursor).to.be.a('string');
    expect(pageOne.items[0].conversationId).to.equal('conv-4');

    const pageTwo = await service.listRecords({ limit: 1, cursor: pageOne.nextCursor });
    expect(pageTwo.items).to.have.length(1);
    expect(pageTwo.items[0].conversationId).to.equal('conv-3');
    expect(pageTwo.nextCursor).to.be.undefined;
  });

  test('commitSnapshot persists and commitConversation clears snapshot', async () => {
    await service.createRecord(createConversationInput('conv-5'));

    const snapshot: RecoverySnapshot = {
      conversationId: 'conv-5',
      sessionId: 'session-5',
      lastInteractionAt: new Date().toISOString(),
      pendingMessages: [],
      updatedAt: new Date().toISOString(),
    };

    await service.commitSnapshot(snapshot);
    const materialised = await service.getSnapshot('conv-5');
    expect(materialised?.sessionId).to.equal('session-5');

    await service.commitConversation('conv-5', {});
    const afterCommit = await service.getSnapshot('conv-5');
    expect(afterCommit).to.be.undefined;
  });

  test('purgeAll removes conversations and reports counts', async () => {
    await service.createRecord(createConversationInput('conv-6'));
    await service.createRecord(createConversationInput('conv-7'));

    const report = await service.purgeAll('workspace-reset' as PurgeReason);
    expect(report.purgedCount).to.equal(2);
    expect(report.failures).to.be.empty;
    const records = await service.listRecords();
    expect(records.items).to.be.empty;
  });

  test('updateRecord throws for unknown conversation', async () => {
    await expect(
      service.updateRecord('missing', { title: 'noop' }),
    ).to.eventually.be.rejectedWith('does not exist');
  });
});

function stubWorkspaceFs(): () => void {
  const original = vscode.workspace.fs;

  const overrides: Partial<typeof original> = {
    async createDirectory(uri: vscode.Uri): Promise<void> {
      await fsp.mkdir(uri.fsPath, { recursive: true });
    },
    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
      await fsp.mkdir(path.dirname(uri.fsPath), { recursive: true });
      await fsp.writeFile(uri.fsPath, Buffer.from(content));
    },
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
      try {
        const buffer = await fsp.readFile(uri.fsPath);
        return new Uint8Array(buffer);
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          const notFound = new Error('File not found');
          (notFound as any).code = 'FileNotFound';
          (notFound as any).name = 'EntryNotFound';
          throw notFound;
        }
        throw error;
      }
    },
    async delete(uri: vscode.Uri): Promise<void> {
      try {
        await fsp.rm(uri.fsPath, { recursive: true, force: false });
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          const notFound = new Error('File not found');
          (notFound as any).code = 'FileNotFound';
          (notFound as any).name = 'EntryNotFound';
          throw notFound;
        }
        throw error;
      }
    },
    async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
      try {
        const entries = await fsp.readdir(uri.fsPath, { withFileTypes: true });
        return entries.map((entry) => [
          entry.name,
          entry.isDirectory()
            ? vscode.FileType.Directory
            : entry.isFile()
              ? vscode.FileType.File
              : vscode.FileType.Unknown,
        ]);
      } catch (error: any) {
        if (error?.code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },
  };

  const fsAdapter = Object.assign(Object.create(null), original, overrides);

  (vscode.workspace as any).fs = fsAdapter;

  return () => {
    (vscode.workspace as any).fs = original;
  };
}

import { expect } from "chai";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { ConversationStorageServiceImpl } from "../../../services/conversation/conversation-storage-service";
import type { RetentionRegistration } from "../../../services/privacy/privacy-controller";
import { SessionManagerImpl } from "../../../session/session-manager";
import { SessionTimerManagerImpl } from "../../../session/session-timer-manager";
import { afterEach, beforeEach, suite, test } from "../../mocha-globals";

class TestSecretStorage implements vscode.SecretStorage {
  private readonly secrets = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
    this.emitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
    this.emitter.fire({ key });
  }

  async keys(): Promise<string[]> {
    return Array.from(this.secrets.keys());
  }
}

class PrivacyControllerStub {
  readonly registrations = new Map<string, RetentionRegistration>();
  private seconds = 3600;

  setRetentionSeconds(seconds: number): void {
    this.seconds = seconds;
  }

  getRetentionSeconds(_category?: unknown): number {
    return this.seconds;
  }

  registerRetention(registration: RetentionRegistration): vscode.Disposable {
    this.registrations.set(registration.id, registration);
    return new vscode.Disposable(() => {
      this.registrations.delete(registration.id);
    });
  }

  async issuePurge() {
    return {
      target: "all",
      status: "success",
      clearedCount: 0,
      retainedCount: 0,
    };
  }
}

function createTestLogger() {
  const entries: { level: string; message: string }[] = [];
  const logger = {
    info(message: string) {
      entries.push({ level: "info", message });
    },
    warn(message: string) {
      entries.push({ level: "warn", message });
    },
    error(message: string) {
      entries.push({ level: "error", message });
    },
    debug(message: string) {
      entries.push({ level: "debug", message });
    },
  } as any;
  return { logger, entries };
}

suite("Integration: Conversation storage handoff", () => {
  let tempDir: string;
  let restoreFs: (() => void) | undefined;
  let context: vscode.ExtensionContext;
  let secrets: TestSecretStorage;
  let privacy: PrivacyControllerStub;
  let conversationStorage: ConversationStorageServiceImpl | undefined;
  let sessionManager: SessionManagerImpl | undefined;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "vp-conv-int-"));
    restoreFs = stubWorkspaceFs();
    secrets = new TestSecretStorage();
    privacy = new PrivacyControllerStub();
    const { logger } = createTestLogger();

    context = {
      storageUri: vscode.Uri.file(tempDir),
      secrets,
    } as unknown as vscode.ExtensionContext;

    conversationStorage = new ConversationStorageServiceImpl(
      context,
      privacy as unknown as any,
      logger,
    );
    await conversationStorage.initialize();

    const keyServiceStub = createKeyServiceStub();
    const configStub = createConfigStub();
    const timerManager = new SessionTimerManagerImpl(logger, async () => undefined, async () => undefined, async () => undefined, undefined);

    sessionManager = new SessionManagerImpl(
      keyServiceStub as any,
      timerManager,
      configStub as any,
      logger,
      privacy as unknown as any,
      undefined,
      undefined,
      undefined,
      conversationStorage,
    );
    sessionManager.setConversationStorage(conversationStorage);
    await sessionManager.initialize();
  });

  afterEach(async () => {
    sessionManager?.dispose();
    conversationStorage?.dispose();
    restoreFs?.();
    restoreFs = undefined;
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  test("commits conversation snapshots during session end", async () => {
    const session = await sessionManager!.startSession();

    const finalEventTimestamp = new Date().toISOString();
    await (sessionManager as any).handleTranscriptForConversationStorage({
      type: "transcript-final",
      sessionId: session.sessionId,
      utteranceId: "utt-final",
      content: "Integration test message",
      confidence: 0.92,
      timestamp: finalEventTimestamp,
      metadata: {
        startOffsetMs: 0,
        chunkCount: 1,
        locale: "en-US",
        redactionsApplied: [],
      },
    });

    const conversationId = session.conversationId!;

    await sessionManager!.endSession(session.sessionId);

    const record = await conversationStorage!.getRecord(conversationId);
    expect(record).to.exist;
    expect(record?.messages).to.have.length(1);
    expect(record?.messages[0].content).to.equal(
      "Integration test message",
    );

    const snapshot = await conversationStorage!.getSnapshot(conversationId);
    expect(snapshot).to.be.undefined;

    const summaries = await conversationStorage!.listRecords();
    expect(summaries.items[0]?.messageCount).to.equal(1);
    expect((sessionManager as any).conversationSnapshots.size).to.equal(0);
  });
});

function createKeyServiceStub() {
  let currentKey: any = {
    sessionId: "stub-session",
  };
  return {
    isInitialized: () => true,
    requestEphemeralKey: async () => ({
      success: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
    getCurrentKey: () => currentKey,
    renewKey: async () => ({
      success: true,
      expiresAt: new Date(Date.now() + 60000),
    }),
    revokeCurrentKey: async () => undefined,
    endSession: async () => undefined,
    onKeyRenewed: () => ({ dispose() {} }),
    onKeyExpired: () => ({ dispose() {} }),
    onAuthenticationError: () => ({ dispose() {} }),
    isInitializedLifecycle: () => true,
  };
}

function createConfigStub() {
  return {
    isInitialized: () => true,
  };
}

function stubWorkspaceFs(): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    vscode.workspace,
    "fs",
  );
  const original = originalDescriptor?.get
    ? originalDescriptor.get.call(vscode.workspace)
    : vscode.workspace.fs;

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
        if (error?.code === "ENOENT") {
          const notFound = new Error("File not found");
          (notFound as any).code = "FileNotFound";
          (notFound as any).name = "EntryNotFound";
          throw notFound;
        }
        throw error;
      }
    },
    async delete(uri: vscode.Uri): Promise<void> {
      try {
        await fsp.rm(uri.fsPath, { recursive: true, force: false });
      } catch (error: any) {
        if (error?.code === "ENOENT") {
          const notFound = new Error("File not found");
          (notFound as any).code = "FileNotFound";
          (notFound as any).name = "EntryNotFound";
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
        if (error?.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
  };

  const fsAdapter = Object.assign(Object.create(null), original, overrides);

  if (originalDescriptor?.configurable) {
    Object.defineProperty(vscode.workspace, "fs", {
      configurable: true,
      get: () => fsAdapter,
    });

    return () => {
      Object.defineProperty(vscode.workspace, "fs", originalDescriptor);
    };
  }

  const patched = new Map<string, unknown>();
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      const existing = (original as any)[key];
      patched.set(key, existing);
      Object.defineProperty(original, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
  }

  return () => {
    for (const [key, value] of patched) {
      Object.defineProperty(original, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
  };
}

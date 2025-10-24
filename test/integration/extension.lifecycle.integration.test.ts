import { expect } from "chai";
import * as vscode from "vscode";
import { EphemeralKeyServiceImpl } from "../../src/auth/ephemeral-key-service";
import { ConfigurationManager } from "../../src/config/configuration-manager";
import { Logger } from "../../src/core/logger";
import { SessionManager } from "../../src/session/session-manager";
import { VoiceControlPanel } from "../../src/ui/voice-control-panel";
import { afterEach, beforeEach, suite, test } from "../mocha-globals";

suite("Integration: Extension lifecycle", () => {
  let disposables: vscode.Disposable[];
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    disposables = [];
    context = {
      subscriptions: disposables,
      extensionUri: vscode.Uri.parse("file://test"),
      environmentVariableCollection: {} as any,
      asAbsolutePath: (p: string) => p,
      storagePath: undefined,
      globalStoragePath: "",
      logPath: "",
      extensionPath: "",
      globalState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      } as any,
      workspaceState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      } as any,
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined,
      } as any,
    } as vscode.ExtensionContext;
  });

  afterEach(() => {
    disposables.forEach((d) => d.dispose());
  });

  test("services initialize and dispose in correct order", async () => {
    const events: string[] = [];
    const logger = new Logger("TestLogger");
    const config = new ConfigurationManager(context, logger);
    const credentialManager: { isInitialized(): boolean; getAzureOpenAIKey(): Promise<string> } = {
      isInitialized: () => true,
      getAzureOpenAIKey: async () => "test-key",
    };
    const keyService = new EphemeralKeyServiceImpl(
      credentialManager as any,
      config,
      logger,
    );

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "session-test",
          model: "gpt-4o-realtime-preview",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          client_secret: {
            value: "ephemeral-key-test",
            expires_at: Math.floor(Date.now() / 1000) + 60,
          },
        }),
      }) as Response;

      const session = new SessionManager(keyService, undefined, config, logger);
      const panel = new VoiceControlPanel(context);

      const originalPanelDispose = panel.dispose.bind(panel);
      panel.dispose = () => {
        events.push("panel");
        originalPanelDispose();
      };
      const originalSessionDispose = session.dispose.bind(session);
      session.dispose = () => {
        events.push("session");
        originalSessionDispose();
      };
      const originalKeyDispose = keyService.dispose.bind(keyService);
      keyService.dispose = () => {
        events.push("key");
        originalKeyDispose();
      };
      const originalConfigDispose = config.dispose.bind(config);
      config.dispose = () => {
        events.push("config");
        originalConfigDispose();
      };

      await config.initialize();
      expect(config.isInitialized(), "Config should be initialized").to.be.true;

      await keyService.initialize();
      expect(keyService.isInitialized(), "Key service should be initialized").to.be.true;

      expect((session as any).keyService, "Session should have the keyService").to.equal(
        keyService,
      );
      expect((session as any).keyService.isInitialized(), "Session keyService should be initialized").to.be.true;

      await session.initialize();
      expect(session.isInitialized(), "Session should be initialized").to.be.true;

      await panel.initialize();
      expect(panel.isInitialized(), "Panel should be initialized").to.be.true;

      panel.dispose();
      session.dispose();
      keyService.dispose();
      config.dispose();

      expect(events).to.deep.equal([
        "panel",
        "session",
        "key",
        "config",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("panel can be shown and disposed", async () => {
    const panel = new VoiceControlPanel(context);

  await panel.initialize();

  await panel.show();
  expect(panel.isVisible(), "Panel should be visible after show").to.be.true;

  panel.dispose();
  expect(panel.isVisible(), "Panel should not be visible after dispose").to.be.false;
  });

  test("session manager tracks session state", async () => {
    const logger = new Logger("TestLogger");
    const config = new ConfigurationManager(context, logger);
    const credentialManager: { isInitialized(): boolean; getAzureOpenAIKey(): Promise<string> } = {
      isInitialized: () => true,
      getAzureOpenAIKey: async () => "test-key",
    };
    const keyService = new EphemeralKeyServiceImpl(
      credentialManager as any,
      config,
      logger,
    );

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "session-test",
          model: "gpt-4o-realtime-preview",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          client_secret: {
            value: "ephemeral-key-test",
            expires_at: Math.floor(Date.now() / 1000) + 60,
          },
        }),
      }) as Response;

      await config.initialize();
      await keyService.initialize();

      expect(config.isInitialized(), "Config should be initialized").to.be.true;
      expect(keyService.isInitialized(), "Key service should be initialized").to.be.true;

      const session = new SessionManager(keyService, undefined, config, logger);

      expect((session as any).keyService, "Session should have the keyService").to.equal(
        keyService,
      );
      expect((session as any).keyService.isInitialized(), "Session keyService should be initialized").to.be.true;

      await session.initialize();

      expect(session.isSessionActive(), "Session should not be active initially").to.be.false;
      expect(session.isInitialized(), "Session manager should be initialized").to.be.true;

      session.dispose();
      keyService.dispose();
      config.dispose();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

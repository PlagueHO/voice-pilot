import * as assert from "assert";
import * as vscode from "vscode";
import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import { Logger } from "../core/logger";
import { SessionManager } from "../session/session-manager";
import { VoiceControlPanel } from "../ui/voice-control-panel";

describe("Extension Lifecycle", () => {
  const disposables: vscode.Disposable[] = [];
  let context: vscode.ExtensionContext;

  before(async () => {
    // Create mock extension context
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

  after(() => {
    // Clean up any disposables
    disposables.forEach((d) => d.dispose());
  });

  it("Services initialize and dispose in correct order", async () => {
    const events: string[] = [];
    const logger = new Logger("TestLogger");
    const config = new ConfigurationManager(context, logger);
    // Mock credential manager (minimal interface for EphemeralKeyService)
    const credentialManager: any = {
      isInitialized: () => true,
      getAzureOpenAIKey: async () => "test-key",
    };
    const keyService = new EphemeralKeyServiceImpl(
      credentialManager,
      config,
      logger,
    );
    // Mock fetch for authentication test inside EphemeralKeyService.initialize
    const originalFetch = (global as any).fetch;
    (global as any).fetch = async () => ({
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
    });
    const session = new SessionManager(keyService, undefined, config, logger);
    const panel = new VoiceControlPanel(context);

    // Track disposal order
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

    // Test individual service lifecycle
    await config.initialize();
    assert.ok(config.isInitialized(), "Config should be initialized");

    await keyService.initialize();
    assert.ok(keyService.isInitialized(), "Key service should be initialized");

    // Debug: Verify the keyService is properly set in session
    assert.ok(
      session["keyService"] === keyService,
      "Session should have the keyService",
    );
    assert.ok(
      session["keyService"].isInitialized(),
      "Session keyService should be initialized",
    );

    await session.initialize();
    assert.ok(session.isInitialized(), "Session should be initialized");

    await panel.initialize();
    assert.ok(panel.isInitialized(), "Panel should be initialized");

    // Dispose in reverse order
    panel.dispose();
    session.dispose();
    keyService.dispose();
    config.dispose();
    // Restore fetch
    (global as any).fetch = originalFetch;

    assert.deepStrictEqual(
      events,
      ["panel", "session", "key", "config"],
      "Services should dispose in reverse order",
    );
  });

  it("Panel can be shown and disposed", async () => {
    const logger = new Logger("TestLogger2");
    const panel = new VoiceControlPanel(context);

    await panel.initialize();

    // Test panel visibility
    await panel.show();
    assert.ok(panel.isVisible(), "Panel should be visible after show");

    panel.dispose();
    assert.strictEqual(
      panel.isVisible(),
      false,
      "Panel should not be visible after dispose",
    );
  });

  it("Session manager tracks session state", async () => {
    const logger = new Logger("TestLogger");
    const config = new ConfigurationManager(context, logger);
    // Mock credential manager for EphemeralKeyService
    const credentialManager: any = {
      isInitialized: () => true,
      getAzureOpenAIKey: async () => "test-key",
    };
    const keyService = new EphemeralKeyServiceImpl(
      credentialManager,
      config,
      logger,
    );

    // Mock fetch for authentication test
    const originalFetch = (global as any).fetch;
    (global as any).fetch = async () => ({
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
    });

    // Initialize dependencies first
    await config.initialize();
    await keyService.initialize();

    // Verify initialization before creating SessionManager
    assert.ok(config.isInitialized(), "Config should be initialized");
    assert.ok(keyService.isInitialized(), "Key service should be initialized");

    // Now create SessionManager with proper dependencies
    const session = new SessionManager(keyService, undefined, config, logger);

    // Debug: Verify the keyService is properly set in session
    assert.ok(
      session["keyService"] === keyService,
      "Session should have the keyService",
    );
    assert.ok(
      session["keyService"].isInitialized(),
      "Session keyService should be initialized",
    );

    await session.initialize();

    assert.strictEqual(
      session.isSessionActive(),
      false,
      "Session should not be active initially",
    );
    assert.ok(session.isInitialized(), "Session manager should be initialized");

    session.dispose();
    keyService.dispose();
    config.dispose();

    // Restore fetch
    (global as any).fetch = originalFetch;
  });
});

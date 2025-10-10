import * as assert from "assert";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../auth/credential-manager";
import { Logger } from "../../core/logger";
import { activate, deactivate } from "../../extension";
import { afterEach, beforeEach, suite, test } from "../mocha-globals";
import { sanitizeLogEntry } from "../utils/sanitizers";

suite("Integration: Activation Telemetry", () => {
  const disposables: vscode.Disposable[] = [];
  const captured: string[] = [];
  const capturedWarnings: string[] = [];

  let context: vscode.ExtensionContext;
  let originalFetch: typeof fetch;
  let originalShowInformationMessage:
    | typeof vscode.window.showInformationMessage
    | undefined;
  let originalGetAzureKey:
    | CredentialManagerImpl["getAzureOpenAIKey"]
    | undefined;
  let originalTestCredentialAccess:
    | CredentialManagerImpl["testCredentialAccess"]
    | undefined;

  beforeEach(() => {
    captured.length = 0;
    capturedWarnings.length = 0;

    const secretsStore = new Map<string, string>();
    const subscriptions: vscode.Disposable[] = [];
    context = {
      subscriptions,
      extensionUri: vscode.Uri.parse("file://integration-telemetry"),
      extensionPath: "",
      extensionMode: vscode.ExtensionMode.Test,
      environmentVariableCollection: {} as any,
      globalStorageUri: vscode.Uri.parse("file://integration-telemetry/global"),
      logUri: vscode.Uri.parse("file://integration-telemetry/logs"),
      secrets: {
        get: async (key: string) => secretsStore.get(key),
        store: async (key: string, value: string) => {
          secretsStore.set(key, value);
        },
        delete: async (key: string) => {
          secretsStore.delete(key);
        },
      },
      workspaceState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      },
      globalState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => [],
      },
      asAbsolutePath: (p: string) => p,
    } as unknown as vscode.ExtensionContext;

    const logDisposable = Logger.onDidLog((entry) => {
      const sanitized = sanitizeLogEntry(entry);
      if (sanitized.level === "info" && sanitized.message.startsWith("Initializing")) {
        captured.push(sanitized.message);
      }
      if (sanitized.level === "warn" && sanitized.message.includes("Activation exceeded")) {
        capturedWarnings.push(sanitized.message);
      }
    });
    disposables.push(logDisposable);

    originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: "session-test",
        model: "gpt-realtime-test",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: "ephemeral-key-test",
          expires_at: Math.floor(Date.now() / 1000) + 60,
        },
      }),
    }) as Response;

    originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;

    originalGetAzureKey = CredentialManagerImpl.prototype.getAzureOpenAIKey;
    CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
      return "azure-openai-integration-test-key";
    };

    originalTestCredentialAccess =
      CredentialManagerImpl.prototype.testCredentialAccess;
    CredentialManagerImpl.prototype.testCredentialAccess = async function () {
      return {
        secretStorageAvailable: true,
        credentialsAccessible: true,
        errors: [],
      };
    };
  });

  afterEach(async () => {
    disposables.splice(0).forEach((d) => d.dispose());
    await deactivate();
    globalThis.fetch = originalFetch;

    if (originalShowInformationMessage) {
      (vscode.window as any).showInformationMessage =
        originalShowInformationMessage;
    }
    if (originalGetAzureKey) {
      CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
    }
    if (originalTestCredentialAccess) {
      CredentialManagerImpl.prototype.testCredentialAccess =
        originalTestCredentialAccess;
    }
  });

  test("emits initialization telemetry in dependency order", async function () {
    this.timeout(15000);

    await activate(context);

    const getIndex = (keyword: string) =>
      captured.findIndex((message) => message.includes(keyword));

    const configIdx = getIndex("configuration manager");
    const authIdx = getIndex("ephemeral key service");
    const sessionIdx = getIndex("session manager");
    const uiIdx = getIndex("voice control panel");

    assert.ok(configIdx !== -1, "Expected configuration manager initialization log");
    assert.ok(authIdx !== -1, "Expected ephemeral key service initialization log");
    assert.ok(sessionIdx !== -1, "Expected session manager initialization log");
    assert.ok(uiIdx !== -1, "Expected voice control panel initialization log");

    assert.ok(configIdx < authIdx, "Configuration should initialize before authentication");
    assert.ok(authIdx < sessionIdx, "Authentication should initialize before session");
    assert.ok(sessionIdx < uiIdx, "Session should initialize before UI");

    assert.strictEqual(
      capturedWarnings.filter((message) => message.includes("Activation exceeded")).length,
      0,
      "Activation should not exceed latency constraint",
    );
  });
});

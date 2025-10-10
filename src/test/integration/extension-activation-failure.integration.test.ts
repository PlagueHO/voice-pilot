import * as assert from "assert";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../auth/credential-manager";
import { ConfigurationManager } from "../../config/configuration-manager";
import { Logger } from "../../core/logger";
import { activate, deactivate } from "../../extension";
import { afterEach, beforeEach, suite, test } from "../mocha-globals";
import { sanitizeLogEntry } from "../utils/sanitizers";

suite("Integration: Activation Failure Handling", () => {
  const captured: Array<ReturnType<typeof sanitizeLogEntry>> = [];
  const disposables: vscode.Disposable[] = [];

  let context: vscode.ExtensionContext;
  let originalFetch: typeof fetch;
  let originalConfigInitialize:
    | ConfigurationManager["initialize"]
    | undefined;
  let originalShowInformationMessage:
    | typeof vscode.window.showInformationMessage
    | undefined;
  let originalShowErrorMessage:
    | typeof vscode.window.showErrorMessage
    | undefined;
  let originalGetAzureKey:
    | CredentialManagerImpl["getAzureOpenAIKey"]
    | undefined;
  let originalTestCredentialAccess:
    | CredentialManagerImpl["testCredentialAccess"]
    | undefined;

  beforeEach(() => {
    captured.length = 0;

    const secretsStore = new Map<string, string>();
    const subscriptions: vscode.Disposable[] = [];
    context = {
      subscriptions,
      extensionUri: vscode.Uri.parse("file://integration-failure"),
      extensionPath: "",
      extensionMode: vscode.ExtensionMode.Test,
      environmentVariableCollection: {} as any,
      globalStorageUri: vscode.Uri.parse("file://integration-failure/global"),
      logUri: vscode.Uri.parse("file://integration-failure/logs"),
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

    const loggerDisposable = Logger.onDidLog((entry) => {
      captured.push(sanitizeLogEntry(entry));
    });
    disposables.push(loggerDisposable);

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

    originalConfigInitialize =
      ConfigurationManager.prototype.initialize;

    originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;

    originalShowErrorMessage = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = async () => undefined;

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
    ConfigurationManager.prototype.initialize =
      originalConfigInitialize ?? ConfigurationManager.prototype.initialize;

    disposables.splice(0).forEach((disposable) => disposable.dispose());
    await deactivate();
    globalThis.fetch = originalFetch;

    if (originalShowInformationMessage) {
      (vscode.window as any).showInformationMessage =
        originalShowInformationMessage;
    }
    if (originalShowErrorMessage) {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
    if (originalGetAzureKey) {
      CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
    }
    if (originalTestCredentialAccess) {
      CredentialManagerImpl.prototype.testCredentialAccess =
        originalTestCredentialAccess;
    }
  });

  test("cleans up services when configuration initialization fails", async function () {
    this.timeout(10000);

    ConfigurationManager.prototype.initialize = async function () {
      throw new Error("Simulated configuration failure");
    };

    let activationError: unknown;
    try {
      await activate(context);
      assert.fail("Activation should throw when configuration initialization fails");
    } catch (error) {
      activationError = error;
    }

    assert.ok(activationError instanceof Error, "Expected activation to reject with Error");

    const failureLog = captured.find((entry) =>
      entry.message.includes("VoicePilot activation failed"),
    );
    assert.ok(failureLog, "Expected activation failure log entry");

    const disposeLogs = captured.filter((entry) =>
      entry.message.startsWith("Disposing"),
    );
    assert.ok(disposeLogs.length > 0, "Expected disposal logs during failure cleanup");

    const initializingLogs = captured.filter((entry) =>
      entry.message.startsWith("Initializing"),
    );
    assert.ok(initializingLogs.length > 0, "Expected initialization attempts to be logged");
  });
});

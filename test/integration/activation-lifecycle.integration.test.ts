import { expect } from "chai";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../src/auth/credential-manager";
import { EphemeralKeyServiceImpl } from "../../src/auth/ephemeral-key-service";
import { activate, deactivate } from "../../src/extension";
import { lifecycleTelemetry } from "../../src/telemetry/lifecycle-telemetry";
import { afterEach, before, suite, test } from "../mocha-globals";

const createTestContext = (namespace: string): vscode.ExtensionContext => {
  const secretsStore = new Map<string, string>();
  const subscriptions: vscode.Disposable[] = [];

  return {
    subscriptions,
    extensionUri: vscode.Uri.parse(`file://${namespace}`),
    extensionPath: "",
    extensionMode: vscode.ExtensionMode.Test,
    environmentVariableCollection: {} as any,
    globalStorageUri: vscode.Uri.parse(`file://${namespace}/global`),
    logUri: vscode.Uri.parse(`file://${namespace}/logs`),
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
};

suite("Integration: Activation lifecycle telemetry", () => {
  let originalGetAzureKey:
    | ((this: CredentialManagerImpl) => Promise<string | undefined>)
    | undefined;
  let originalTestCredentialAccess:
    | ((
        this: CredentialManagerImpl,
      ) => Promise<{
        secretStorageAvailable: boolean;
        credentialsAccessible: boolean;
        errors: string[];
      }>)
    | undefined;
  let originalEphemeralInitialize:
    | EphemeralKeyServiceImpl["initialize"]
    | undefined;
  let originalShowInformationMessage:
    | typeof vscode.window.showInformationMessage
    | undefined;

  before(() => {
    originalGetAzureKey = CredentialManagerImpl.prototype.getAzureOpenAIKey;
    originalTestCredentialAccess =
      CredentialManagerImpl.prototype.testCredentialAccess;
    originalEphemeralInitialize = EphemeralKeyServiceImpl.prototype.initialize;
    originalShowInformationMessage = vscode.window.showInformationMessage;
  });

  afterEach(async () => {
    if (originalGetAzureKey) {
      CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
    }
    if (originalTestCredentialAccess) {
      CredentialManagerImpl.prototype.testCredentialAccess =
        originalTestCredentialAccess;
    }
    if (originalEphemeralInitialize) {
      EphemeralKeyServiceImpl.prototype.initialize = originalEphemeralInitialize;
    }
    const originalIsInitialized = (EphemeralKeyServiceImpl.prototype as any)._originalIsInitialized;
    if (originalIsInitialized) {
      EphemeralKeyServiceImpl.prototype.isInitialized = originalIsInitialized;
      delete (EphemeralKeyServiceImpl.prototype as any)._originalIsInitialized;
    }
    if (originalShowInformationMessage) {
      (vscode.window as any).showInformationMessage =
        originalShowInformationMessage;
    }
    lifecycleTelemetry.reset();
    await deactivate();
  });

  test("emits configuration → authentication → session → UI order", async function () {
    this.timeout(15000);
    lifecycleTelemetry.reset();

    await deactivate();

    (vscode.window as any).showInformationMessage = async () => undefined;

    // Mock credentials and ephemeral key service
    CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
      return "azure-openai-test-key";
    };

    CredentialManagerImpl.prototype.testCredentialAccess = async function () {
      return {
        secretStorageAvailable: true,
        credentialsAccessible: true,
        errors: [],
      };
    };

    const originalIsInitialized = EphemeralKeyServiceImpl.prototype.isInitialized;

    EphemeralKeyServiceImpl.prototype.initialize = async function () {
      // Mark as initialized without performing authentication test
      (this as any)._isInitialized = true;
    };

    EphemeralKeyServiceImpl.prototype.isInitialized = function () {
      return (this as any)._isInitialized === true;
    };

    // Store original for cleanup
    (EphemeralKeyServiceImpl.prototype as any)._originalIsInitialized = originalIsInitialized;

    const context = createTestContext("activation-lifecycle-telemetry");

    await activate(context);

    const events = lifecycleTelemetry
      .getEvents()
      .filter((event) => event.endsWith(".initialized"));
    expect(events).to.deep.equal([
      "config.initialized",
      "auth.initialized",
      "session.initialized",
      "ui.initialized",
    ]);
  });
});

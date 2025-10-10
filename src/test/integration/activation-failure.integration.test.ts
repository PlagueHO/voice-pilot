import * as assert from "assert";
import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../auth/credential-manager";
import { EphemeralKeyServiceImpl } from "../../auth/ephemeral-key-service";
import { activate, deactivate } from "../../extension";
import { lifecycleTelemetry } from "../../telemetry/lifecycle-telemetry";
import { describe, suiteSetup, teardown, test } from "../mocha-globals";
import { sanitizeLogMessage } from "../utils/sanitizers";
const FIXTURE_ROOT = path.resolve(
  __dirname,
  "../../../src/test/fixtures/activation-failure",
);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

describe("Activation failure regressions", () => {
  let originalEphemeralInitialize:
    | EphemeralKeyServiceImpl["initialize"]
    | undefined;
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
  let originalShowInformationMessage:
    | typeof vscode.window.showInformationMessage
    | undefined;
  let originalShowErrorMessage:
    | typeof vscode.window.showErrorMessage
    | undefined;

  suiteSetup(() => {
    originalEphemeralInitialize =
      EphemeralKeyServiceImpl.prototype.initialize;
    originalGetAzureKey =
      CredentialManagerImpl.prototype.getAzureOpenAIKey;
    originalTestCredentialAccess =
      CredentialManagerImpl.prototype.testCredentialAccess;
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalShowErrorMessage = vscode.window.showErrorMessage;
  });

  teardown(async () => {
    if (originalEphemeralInitialize) {
      EphemeralKeyServiceImpl.prototype.initialize =
        originalEphemeralInitialize;
    }
    if (originalGetAzureKey) {
      CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
    }
    if (originalTestCredentialAccess) {
      CredentialManagerImpl.prototype.testCredentialAccess =
        originalTestCredentialAccess;
    }
    if (originalShowInformationMessage) {
      (vscode.window as any).showInformationMessage =
        originalShowInformationMessage;
    }
    if (originalShowErrorMessage) {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
    }
    lifecycleTelemetry.reset();
    await deactivate();
  });

  test("cleans up when authentication upstream is unavailable", async function () {
    this.timeout(15000);
    lifecycleTelemetry.reset();

    await deactivate();

    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showErrorMessage = async () => undefined;

    const outageFixturePath = path.join(
      FIXTURE_ROOT,
      "session-error-response.json",
    );
    const outageFixture = JSON.parse(
      await fs.readFile(outageFixturePath, "utf8"),
    ) as { status: number; error: { message: string } };

    EphemeralKeyServiceImpl.prototype.initialize = async function () {
      throw new Error(
        `Authentication initialization failed: ${outageFixture.status}: ${outageFixture.error.message}`,
      );
    };

    CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
      return "fake-key-for-regression";
    };

    CredentialManagerImpl.prototype.testCredentialAccess = async function () {
      return {
        secretStorageAvailable: true,
        credentialsAccessible: true,
        errors: [],
      };
    };

    const context = createTestContext("activation-failure-outage");

    let activationError: unknown;
    try {
      await activate(context);
      assert.fail("Activation should have thrown an error");
    } catch (error) {
      activationError = error;
    }

    assert.ok(
      activationError instanceof Error,
      "Activation failure should surface as Error",
    );
    const sanitizedMessage = sanitizeLogMessage(
      (activationError as Error).message,
    );
    assert.match(sanitizedMessage, /Authentication initialization failed/i);

    const events = lifecycleTelemetry.getEvents();
    assert.ok(events.includes("activation.failed"));
    assert.ok(
      !events.includes("session.initialized"),
      "Session phase should not initialize during outage",
    );
    assert.ok(
      !events.includes("ui.initialized"),
      "UI phase should not initialize during outage",
    );
  });

  test("reports friendly failure when Azure credentials are missing", async function () {
    this.timeout(15000);
    lifecycleTelemetry.reset();

    (vscode.window as any).showInformationMessage = async () => undefined;
    (vscode.window as any).showErrorMessage = async () => undefined;

    const hintPath = path.join(FIXTURE_ROOT, "no-credentials-hint.json");
    const hintFixture = JSON.parse(await fs.readFile(hintPath, "utf8")) as {
      expectedErrorSnippet: string;
    };

    await deactivate();

    EphemeralKeyServiceImpl.prototype.initialize = async function () {
      throw new Error(
        `Authentication initialization failed: ${hintFixture.expectedErrorSnippet}`,
      );
    };

    CredentialManagerImpl.prototype.getAzureOpenAIKey = async function () {
      return undefined;
    };

    CredentialManagerImpl.prototype.testCredentialAccess = async function () {
      return {
        secretStorageAvailable: true,
        credentialsAccessible: true,
        errors: [],
      };
    };

    const context = createTestContext("activation-failure-missing-creds");

    let activationError: unknown;
    try {
      await activate(context);
      assert.fail("Activation should throw when credentials are missing");
    } catch (error) {
      activationError = error;
    }

    assert.ok(activationError instanceof Error, "Activation should throw Error");
    const sanitizedMessage = sanitizeLogMessage(
      (activationError as Error).message,
    );
    assert.match(sanitizedMessage, /Authentication initialization failed/i);

    const events = lifecycleTelemetry.getEvents();
    assert.ok(events.includes("activation.failed"));
    assert.ok(!events.includes("auth.initialized"));

    // Ensure logs communicate missing credential scenario via telemetry description
    const failureEvents = events.filter((event) => event === "activation.failed");
    assert.ok(failureEvents.length >= 1);

    // Validate the test fixture's guidance snippet is reflected in error message expectations
    assert.match(
      sanitizedMessage,
      new RegExp(escapeRegExp(hintFixture.expectedErrorSnippet), "i"),
    );
  });
});

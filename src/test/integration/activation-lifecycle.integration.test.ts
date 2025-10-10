import { expect } from "chai";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../auth/credential-manager";
import { lifecycleTelemetry } from "../../telemetry/lifecycle-telemetry";
import { afterEach, beforeEach, suite, test } from "../mocha-globals";

const manifest = require("../../../package.json") as {
  name: string;
  publisher: string;
};

const EXTENSION_ID = `${manifest.publisher}.${manifest.name}`.toLowerCase();

const getVoicePilotExtension = (): vscode.Extension<any> | undefined => {
  const direct = vscode.extensions.getExtension(EXTENSION_ID);
  if (direct) {
    return direct;
  }
  return vscode.extensions.all.find(
    (extension) => extension.id.toLowerCase() === EXTENSION_ID,
  );
};

suite("Integration: Activation lifecycle telemetry", () => {
  let activatedExtension: vscode.Extension<any> | undefined;
  let originalGetAzureKey:
    | CredentialManagerImpl["getAzureOpenAIKey"]
    | undefined;
  let originalTestCredentialAccess:
    | CredentialManagerImpl["testCredentialAccess"]
    | undefined;
  let originalShowInformationMessage:
    | typeof vscode.window.showInformationMessage
    | undefined;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    lifecycleTelemetry.reset();
    activatedExtension = getVoicePilotExtension();
    expect(activatedExtension, "VoicePilot extension should be discoverable").to.exist;

    originalGetAzureKey = CredentialManagerImpl.prototype.getAzureOpenAIKey;
    originalTestCredentialAccess =
      CredentialManagerImpl.prototype.testCredentialAccess;
    originalShowInformationMessage = vscode.window.showInformationMessage;
    originalFetch = globalThis.fetch;

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

    (vscode.window as any).showInformationMessage = async () => undefined;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "session-test",
          model: "gpt-realtime",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          client_secret: {
            value: "ephemeral-test",
            expires_at: Math.floor(Date.now() / 1000) + 60,
          },
        }),
      }) as Response;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
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
    lifecycleTelemetry.reset();
    await activatedExtension?.exports?.deactivate?.();
  });

  test("emits configuration → authentication → session → UI order", async function () {
    this.timeout(15000);

    await activatedExtension!.activate();
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

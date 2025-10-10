import * as assert from "assert";
import * as vscode from "vscode";
import { CredentialManagerImpl } from "../../auth/credential-manager";
import { lifecycleTelemetry } from "../../telemetry/lifecycle-telemetry";
import { suite, test } from "../mocha-globals";

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

suite("Activation lifecycle telemetry", () => {
  test("emits configuration → authentication → session → UI order", async function () {
    this.timeout(15000);
    lifecycleTelemetry.reset();
    const extension = getVoicePilotExtension();
    assert.ok(extension, "VoicePilot extension should be discoverable");

    const originalGetAzureKey =
      CredentialManagerImpl.prototype.getAzureOpenAIKey;
    const originalTestCredentialAccess =
      CredentialManagerImpl.prototype.testCredentialAccess;

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

    const originalShowInformationMessage = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;

    const originalFetch = globalThis.fetch;
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

    try {
      await extension.activate();
      const events = lifecycleTelemetry
        .getEvents()
        .filter((event) => event.endsWith(".initialized"));
      assert.deepStrictEqual(events, [
        "config.initialized",
        "auth.initialized",
        "session.initialized",
        "ui.initialized",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      CredentialManagerImpl.prototype.getAzureOpenAIKey = originalGetAzureKey;
      CredentialManagerImpl.prototype.testCredentialAccess =
        originalTestCredentialAccess;
      (vscode.window as any).showInformationMessage =
        originalShowInformationMessage;
      await extension.exports?.deactivate?.();
    }
  });
});

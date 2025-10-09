import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExtensionController } from '../../core/extension-controller';
import { Logger } from '../../core/logger';
import { activate, deactivate } from '../../extension';
import * as copilot from '../../helpers/ensure-copilot';
import { lifecycleTelemetry } from '../../telemetry/lifecycle-telemetry';
import * as statusBarModule from '../../ui/status-bar';
import { VoiceControlPanel } from '../../ui/voice-control-panel';
import { createExtensionContextStub } from '../utils/extension-context';

function createStubRegistry() {
  const restorers: Array<() => void> = [];
  return {
    stub<T extends object, K extends keyof T>(target: T, key: K, replacement: T[K]): void {
      const original = target[key];
      (target as any)[key] = replacement;
      restorers.push(() => {
        (target as any)[key] = original;
      });
    },
    async dispose(): Promise<void> {
      while (restorers.length > 0) {
        const restore = restorers.pop();
        if (restore) {
          restore();
        }
      }
    },
  };
}

describe('Unit: extension activation lifecycle', () => {
  let registry: ReturnType<typeof createStubRegistry>;

  beforeEach(() => {
    registry = createStubRegistry();
    class StubStatusBar {
      showReady(): void {}
      showInfo(): void {}
      showError(): void {}
      dispose(): void {}
    }
    registry.stub(statusBarModule as any, 'StatusBar', StubStatusBar);
  });

  afterEach(async () => {
    await deactivate();
    await registry.dispose();
  });

  it('activates extension and updates contexts when Copilot is available', async () => {
    const availability: boolean[] = [];
  registry.stub(VoiceControlPanel.prototype as any, 'setCopilotAvailable', function (available: boolean) {
      availability.push(available);
    });

    let initializeCalls = 0;
  registry.stub(ExtensionController.prototype as any, 'initialize', async function () {
      initializeCalls += 1;
    });

    let disposeCalls = 0;
  registry.stub(ExtensionController.prototype as any, 'dispose', function () {
      disposeCalls += 1;
    });

    let ensureCalls = 0;
  registry.stub(copilot as any, 'isCopilotChatAvailable', () => true);
  registry.stub(copilot as any, 'ensureCopilotChatInstalled', async () => {
      ensureCalls += 1;
      return true;
    });

    const executed: Array<{ command: string; args: unknown[] }> = [];
  registry.stub(vscode.commands as any, 'executeCommand', (command: string, ...args: unknown[]) => {
      executed.push({ command, args });
      return Promise.resolve(undefined);
    });

    let resetCalled = false;
  registry.stub(lifecycleTelemetry as any, 'reset', () => {
      resetCalled = true;
    });

    const nowValues = [0, 1500];
  registry.stub(performance as any, 'now', () => nowValues.shift() ?? 1500);

  const context = createExtensionContextStub();
    await activate(context);

    assert.strictEqual(resetCalled, true, 'telemetry.reset should be invoked');
    assert.strictEqual(initializeCalls, 1, 'controller.initialize should be called once');
    assert.strictEqual(ensureCalls, 0, 'ensure install should not be called when Copilot is already available');
    assert.deepStrictEqual(availability, [true], 'voice panel should reflect Copilot availability');
    assert.ok(
      executed.some(
        (entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.copilotAvailable' && entry.args[1] === true,
      ),
    );
    assert.ok(
      executed.some(
        (entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.activated' && entry.args[1] === true,
      ),
    );
    assert.ok(context.subscriptions.length >= 2, 'disposables should be registered on the context');

    await deactivate();
    assert.strictEqual(disposeCalls, 1, 'controller.dispose should be called exactly once during deactivate');
  });

  it('warns when activation exceeds the five second threshold', async () => {
    registry.stub(copilot as any, 'isCopilotChatAvailable', () => true);
    registry.stub(copilot as any, 'ensureCopilotChatInstalled', async () => true);

    registry.stub(ExtensionController.prototype as any, 'initialize', async () => {});
    registry.stub(ExtensionController.prototype as any, 'dispose', () => {});

    const warns: Array<{ message: string; data: unknown }> = [];
    registry.stub(Logger.prototype as any, 'warn', function (message: string, data?: unknown) {
      warns.push({ message, data });
    });

    registry.stub(vscode.commands as any, 'executeCommand', () => Promise.resolve(undefined));

    const nowValues = [0, 6005];
    registry.stub(performance as any, 'now', () => nowValues.shift() ?? 6005);

  const context = createExtensionContextStub();
    await activate(context);

    const warning = warns.find((entry) => entry.message === 'Activation exceeded 5s constraint');
    assert.ok(warning, 'warning should be logged when activation duration exceeds threshold');
    assert.ok((warning?.data as any)?.duration > 5000, 'warning payload should include activation duration');
  });

  it('falls back when Copilot remains unavailable after prompt', async () => {
    const availability: boolean[] = [];
    registry.stub(VoiceControlPanel.prototype as any, 'setCopilotAvailable', function (available: boolean) {
      availability.push(available);
    });

    registry.stub(copilot as any, 'isCopilotChatAvailable', () => false);
    let ensureCalls = 0;
    registry.stub(copilot as any, 'ensureCopilotChatInstalled', async () => {
      ensureCalls += 1;
      return false;
    });

    registry.stub(ExtensionController.prototype as any, 'initialize', async () => {});
    registry.stub(ExtensionController.prototype as any, 'dispose', () => {});

    const executed: Array<{ command: string; args: unknown[] }> = [];
    registry.stub(vscode.commands as any, 'executeCommand', (command: string, ...args: unknown[]) => {
      executed.push({ command, args });
      return Promise.resolve(undefined);
    });

    const nowValues = [0, 1200];
    registry.stub(performance as any, 'now', () => nowValues.shift() ?? 1200);

  const context = createExtensionContextStub();
    await activate(context);

    assert.strictEqual(ensureCalls, 1, 'ensure install should be attempted when Copilot is unavailable');
    assert.deepStrictEqual(availability, [false], 'voice panel should mark Copilot as unavailable');
    const availabilityContext = executed.find(
      (entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.copilotAvailable',
    );
    assert.ok(availabilityContext, 'setContext for copilot availability should be executed');
    assert.strictEqual(availabilityContext?.args[1], false);
  });

  it('surfaces errors when controller initialization fails', async () => {
    registry.stub(copilot as any, 'isCopilotChatAvailable', () => true);
    registry.stub(copilot as any, 'ensureCopilotChatInstalled', async () => true);

    registry.stub(ExtensionController.prototype as any, 'initialize', async () => {
      throw new Error('controller init failed');
    });

    let disposeCalls = 0;
    registry.stub(ExtensionController.prototype as any, 'dispose', function () {
      disposeCalls += 1;
    });

    const errorMessages: string[] = [];
    registry.stub(vscode.window as any, 'showErrorMessage', (message: string) => {
      errorMessages.push(message);
      return Promise.resolve(undefined);
    });

    const recorded: string[] = [];
    registry.stub(lifecycleTelemetry as any, 'record', (event: string) => {
      recorded.push(event);
    });

    registry.stub(vscode.commands as any, 'executeCommand', () => Promise.resolve(undefined));

    const nowValues = [0, 800];
    registry.stub(performance as any, 'now', () => nowValues.shift() ?? 800);

  const context = createExtensionContextStub();
    await assert.rejects(activate(context), /controller init failed/);

    assert.strictEqual(disposeCalls, 1, 'controller.dispose should be invoked after failure');
    assert.ok(
      errorMessages.some((msg) => msg.includes('VoicePilot activation failed: controller init failed')),
      'user-facing error should be shown',
    );
    assert.ok(recorded.includes('activation.failed'), 'lifecycle telemetry should record activation failure');
  });
});

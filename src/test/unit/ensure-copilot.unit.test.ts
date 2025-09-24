import * as assert from 'assert';
import * as vscode from 'vscode';
import { ensureCopilotChatInstalled, isCopilotChatAvailable } from '../../helpers/ensure-copilot';

// Utility to reset mutable vscode mock facets between tests
function resetVscodeMocks() {
  const extensionsApi = (vscode as any).extensions;
  if (extensionsApi && typeof extensionsApi === 'object') {
    extensionsApi.getExtension = () => undefined;
  }
  (vscode as any).window.showInformationMessage = () => Promise.resolve(undefined);
  (vscode as any).window.showErrorMessage = () => Promise.resolve(undefined as any);
  (vscode as any).commands.executeCommand = () => Promise.resolve(undefined);
}

describe('Unit: ensure-copilot helper', () => {
  beforeEach(() => {
    resetVscodeMocks();
  });

  it('returns true when Copilot Chat is already installed and active', async () => {
    let activated = false;
    (vscode as any).extensions.getExtension = () => ({ isActive: true, activate: () => { activated = true; } });

    const availablePre = isCopilotChatAvailable();
    const result = await ensureCopilotChatInstalled();

    assert.strictEqual(availablePre, true, 'Extension should be reported available');
    assert.strictEqual(result, true, 'Should resolve true');
    assert.strictEqual(activated, false, 'Should not call activate when already active');
  });

  it('activates extension when installed but inactive', async () => {
    let activateCalls = 0;
    (vscode as any).extensions.getExtension = () => ({ isActive: false, activate: async () => { activateCalls++; } });

    const result = await ensureCopilotChatInstalled();
    assert.strictEqual(result, true);
    assert.strictEqual(activateCalls, 1, 'Should activate inactive extension');
  });

  it('prompts and returns false when user declines install', async () => {
    let promptShown = false;
    (vscode as any).window.showInformationMessage = (msg: string, install: string, later: string) => {
      promptShown = true;
      return Promise.resolve(later); // user chooses Later
    };
    let installCalled = false;
    (vscode as any).commands.executeCommand = (cmd: string) => {
      if (cmd === 'workbench.extensions.installExtension') {installCalled = true;}
      return Promise.resolve();
    };

    const result = await ensureCopilotChatInstalled();
    assert.strictEqual(promptShown, true, 'Prompt should be shown');
    assert.strictEqual(installCalled, false, 'Install should not be triggered');
    assert.strictEqual(result, false, 'Result should be false when user declines');
  });

  it('installs and reloads when user accepts', async () => {
    const callSeq: string[] = [];
    // First information message -> accept install, second -> reload
    let infoCall = 0;
    (vscode as any).window.showInformationMessage = (msg: string, opt1?: string, opt2?: string) => {
      infoCall++;
      if (infoCall === 1) {
        callSeq.push('prompt-install');
        return Promise.resolve(opt1); // choose Install Copilot Chat
      } else {
        callSeq.push('prompt-reload');
        return Promise.resolve('Reload Window');
      }
    };
    let installed = false;
    let reloaded = false;
    (vscode as any).commands.executeCommand = (cmd: string) => {
      if (cmd === 'workbench.extensions.installExtension') {installed = true;}
      if (cmd === 'workbench.action.reloadWindow') {reloaded = true;}
      return Promise.resolve();
    };

    const result = await ensureCopilotChatInstalled();
    assert.strictEqual(result, true, 'Should return true after installation flow');
    assert.ok(installed, 'Install command should be executed');
    assert.ok(reloaded, 'Reload command should be executed');
    assert.deepStrictEqual(callSeq, ['prompt-install', 'prompt-reload']);
  });

  it('shows error and returns false when install throws', async () => {
    let errorShown: string | undefined;
    (vscode as any).window.showInformationMessage = () => Promise.resolve('Install Copilot Chat');
    (vscode as any).window.showErrorMessage = (m: string) => { errorShown = m; return Promise.resolve(undefined as any); };
    (vscode as any).commands.executeCommand = (cmd: string) => {
      if (cmd === 'workbench.extensions.installExtension') {
        return Promise.reject(new Error('network failure'));
      }
      return Promise.resolve();
    };

    const result = await ensureCopilotChatInstalled();
    assert.strictEqual(result, false, 'Should return false on install failure');
    assert.ok(errorShown && /Failed to install Copilot Chat/.test(errorShown), 'Should show install failure error');
  });
});

import * as vscode from 'vscode';
import { ensureCopilotChatInstalled, isCopilotChatAvailable } from '../../src/helpers/ensure-copilot';
import { expect } from "../helpers/chai-setup";
import { beforeEach, suite, test } from '../mocha-globals';

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

suite('Unit: ensure-copilot helper', () => {
  beforeEach(() => {
    resetVscodeMocks();
  });

  test('returns true when Copilot Chat is already installed and active', async () => {
    let activated = false;
    (vscode as any).extensions.getExtension = () => ({ isActive: true, activate: () => { activated = true; } });

    const availablePre = isCopilotChatAvailable();
    const result = await ensureCopilotChatInstalled();

    expect(availablePre, 'Extension should be reported available').to.equal(true);
    expect(result, 'Should resolve true').to.equal(true);
    expect(activated, 'Should not call activate when already active').to.equal(false);
  });

  test('activates extension when installed but inactive', async () => {
    let activateCalls = 0;
    (vscode as any).extensions.getExtension = () => ({ isActive: false, activate: async () => { activateCalls++; } });

    const result = await ensureCopilotChatInstalled();
    expect(result).to.equal(true);
    expect(activateCalls, 'Should activate inactive extension').to.equal(1);
  });

  test('returns false when activation throws', async () => {
    (vscode as any).extensions.getExtension = () => ({
      isActive: false,
      activate: async () => {
        throw new Error('activation failure');
      },
    });

    const result = await ensureCopilotChatInstalled();
    expect(result, 'Should return false when activation fails').to.equal(false);
  });

  test('prompts and returns false when user declines install', async () => {
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
    expect(promptShown, 'Prompt should be shown').to.equal(true);
    expect(installCalled, 'Install should not be triggered').to.equal(false);
    expect(result, 'Result should be false when user declines').to.equal(false);
  });

  test('installs and reloads when user accepts', async () => {
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
    expect(result, 'Should return true after installation flow').to.equal(true);
    expect(installed, 'Install command should be executed').to.equal(true);
    expect(reloaded, 'Reload command should be executed').to.equal(true);
    expect(callSeq).to.deep.equal(['prompt-install', 'prompt-reload']);
  });

  test('shows error and returns false when install throws', async () => {
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
    expect(result, 'Should return false on install failure').to.equal(false);
    expect(errorShown && /Failed to install Copilot Chat/.test(errorShown), 'Should show install failure error').to.equal(true);
  });
});

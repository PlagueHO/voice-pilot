import * as vscode from 'vscode';

const COPILOT_ID = 'GitHub.copilot-chat';

export async function ensureCopilotChatInstalled(): Promise<boolean> {
  const ext = vscode.extensions.getExtension(COPILOT_ID);
  if (ext) {
    try {
      if (!ext.isActive) {
        await ext.activate();
      }
    } catch (e) {
      // activation failed, but extension exists
    }
    return true;
  }

  const install = 'Install Copilot Chat';
  const later = 'Later';
  const choice = await vscode.window.showInformationMessage(
    'The GitHub Copilot Chat extension is recommended for Copilot-based actions. Install it now?',
    install,
    later
  );

  if (choice !== install) {
    return false;
  }

  try {
    // Trigger marketplace install. This will prompt the user as needed.
    await vscode.commands.executeCommand('workbench.extensions.installExtension', COPILOT_ID);
    // After install, ask the user to reload to activate both extensions.
    const reload = 'Reload Window';
    const doReload = await vscode.window.showInformationMessage('Copilot Chat installed. Reload to finish setup.', reload);
    if (doReload === reload) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to install Copilot Chat: ${String(err)}`);
    return false;
  }
}

export function isCopilotChatAvailable(): boolean {
  return !!vscode.extensions.getExtension(COPILOT_ID);
}

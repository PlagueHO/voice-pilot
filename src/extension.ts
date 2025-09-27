import * as vscode from 'vscode';
import { ConfigurationManager } from './config/configuration-manager';
import { ExtensionController } from './core/extension-controller';
import { Logger } from './core/logger';
import { ensureCopilotChatInstalled, isCopilotChatAvailable } from './helpers/ensure-copilot';
import { PrivacyController } from './services/privacy/privacy-controller';
import { SessionManagerImpl } from './session/session-manager';
import { VoiceControlPanel } from './ui/voice-control-panel';

let controller: ExtensionController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const start = performance.now();
  const logger = new Logger();
  const configurationManager = new ConfigurationManager(context, logger);
  const sessionManager = new SessionManagerImpl();
  const voicePanel = new VoiceControlPanel(context);
  const privacyController = new PrivacyController(configurationManager, logger);
  controller = new ExtensionController(
    context,
    configurationManager,
    sessionManager,
    voicePanel,
    privacyController,
    logger
  );

  try {
    // Prompt user to install Copilot Chat optionally; continue regardless
    const copilotInstalled = isCopilotChatAvailable() || (await ensureCopilotChatInstalled());
    voicePanel.setCopilotAvailable(!!copilotInstalled);
    await vscode.commands.executeCommand('setContext', 'voicepilot.copilotAvailable', !!copilotInstalled);
    await controller.initialize();
    await vscode.commands.executeCommand('setContext', 'voicepilot.activated', true);
    const duration = performance.now() - start;
    logger.info(`Activation completed in ${duration.toFixed(2)}ms`);
    if (duration > 5000) {
      logger.warn('Activation exceeded 5s constraint', { duration });
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`VoicePilot activation failed: ${err.message}`);
  }
}

export function deactivate() {
  controller?.dispose();
  controller = undefined;
}

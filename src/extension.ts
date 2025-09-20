import * as vscode from 'vscode';
import { ConfigurationManager } from './config/ConfigurationManager';
import { ExtensionController } from './core/ExtensionController';
import { Logger } from './core/logger';
import { SessionManager } from './session/SessionManager';
import { VoiceControlPanel } from './ui/VoiceControlPanel';

let controller: ExtensionController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const start = performance.now();
  const logger = new Logger();
  const configurationManager = new ConfigurationManager(context, logger);
  const sessionManager = new SessionManager();
  const voicePanel = new VoiceControlPanel(context);
  controller = new ExtensionController(
    context,
    configurationManager,
    sessionManager,
    voicePanel,
    logger
  );

  try {
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

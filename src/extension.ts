import * as vscode from 'vscode';
import { EphemeralKeyService } from './auth/EphemeralKeyService';
import { ConfigurationManager } from './config/ConfigurationManager';
import { ExtensionController } from './core/ExtensionController';
import { Logger } from './core/logger';
import { SessionManager } from './session/SessionManager';
import { VoiceControlPanel } from './ui/VoiceControlPanel';

let controller: ExtensionController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const start = performance.now();
  const configurationManager = new ConfigurationManager();
  const keyService = new EphemeralKeyService();
  const sessionManager = new SessionManager();
  const voicePanel = new VoiceControlPanel(context);

  const logger = new Logger();
  controller = new ExtensionController(
    context,
    configurationManager,
    keyService,
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

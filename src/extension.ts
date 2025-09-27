import * as vscode from 'vscode';
import { ConfigurationManager } from './config/configuration-manager';
import { ExtensionController } from './core/extension-controller';
import { Logger } from './core/logger';
import {
  ensureCopilotChatInstalled,
  isCopilotChatAvailable,
} from './helpers/ensure-copilot';
import { PrivacyController } from './services/privacy/privacy-controller';
import { SessionManagerImpl } from './session/session-manager';
import { VoiceControlPanel } from './ui/voice-control-panel';

let controller: ExtensionController | undefined;

/**
 * Activates the VoicePilot extension following the documented configuration → auth → session → UI boot order.
 *
 * @remarks
 * Registers shared resources on the {@link vscode.ExtensionContext.subscriptions | extension context} so they
 * are disposed automatically, verifies the Copilot Chat dependency, and initializes the
 * {@link ExtensionController}. Any activation failure is logged and surfaced to the user while ensuring
 * partially initialized services are torn down.
 *
 * @param context VS Code extension context provided by the host during activation.
 * @returns A promise that resolves once activation has completed or an error has been handled.
 */
export async function activate(context: vscode.ExtensionContext) {
  const start = performance.now();
  const logger = new Logger();
  context.subscriptions.push(logger);
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
    logger,
  );

  const controllerDisposable = new vscode.Disposable(() => {
    controller?.dispose();
    controller = undefined;
  });
  context.subscriptions.push(controllerDisposable);

  try {
    // Prompt user to install Copilot Chat optionally; continue regardless
    const copilotInstalled =
      isCopilotChatAvailable() ||
      (await ensureCopilotChatInstalled({ logger }));
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
    logger.error('VoicePilot activation failed', { error: err?.message ?? err });
    vscode.window.showErrorMessage(`VoicePilot activation failed: ${err.message}`);
    controller?.dispose();
    controller = undefined;
  }
}

/**
 * Disposes the cached {@link ExtensionController} when the extension is deactivated by VS Code.
 *
 * @returns A promise that resolves after disposal has completed.
 */
export async function deactivate(): Promise<void> {
  try {
    controller?.dispose();
  } finally {
    controller = undefined;
  }
}

import * as vscode from 'vscode';
import { ConfigurationManager } from './config/configuration-manager';
import { ExtensionController } from './core/extension-controller';
import { Logger } from './core/logger';
import {
    ensureCopilotChatInstalled,
    isCopilotChatAvailable,
} from './helpers/ensure-copilot';
import { IntentProcessorImpl } from './intent/intent-processor-impl';
import { PrivacyController } from './services/privacy/privacy-controller';
import { SessionManagerImpl } from './session/session-manager';
import { lifecycleTelemetry } from './telemetry/lifecycle-telemetry';
import { VoiceControlPanel } from './ui/voice-control-panel';

let controller: ExtensionController | undefined;

/**
 * Activates the Agent Voice extension following the documented configuration → auth → session → UI boot order.
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
  lifecycleTelemetry.reset();
  const logger = new Logger();
  context.subscriptions.push(logger);
  const configurationManager = new ConfigurationManager(context, logger);
  const sessionManager = new SessionManagerImpl();
  const intentProcessor = new IntentProcessorImpl(logger);
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

  // Initialize intent processor after session manager
  await intentProcessor.initialize();
  context.subscriptions.push(new vscode.Disposable(() => intentProcessor.dispose()));

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
    await vscode.commands.executeCommand('setContext', 'agentvoice.copilotAvailable', !!copilotInstalled);
    await controller.initialize();
    // Check if configuration is complete after controller initializes
    voicePanel.setConfigurationComplete(configurationManager.isConfigured());
    await vscode.commands.executeCommand('setContext', 'agentvoice.activated', true);
    const duration = performance.now() - start;
    logger.info(`Activation completed in ${duration.toFixed(2)}ms`);
    if (duration > 5000) {
      logger.warn('Activation exceeded 5s constraint', { duration });
    }
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Agent Voice activation failed', { error: error.message });
    lifecycleTelemetry.record('activation.failed');
    vscode.window.showErrorMessage(`Agent Voice activation failed: ${error.message}`);
    controller?.dispose();
    controller = undefined;
    throw error;
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

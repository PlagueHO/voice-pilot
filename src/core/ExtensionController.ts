import * as vscode from 'vscode';
import { EphemeralKeyService } from '../auth/EphemeralKeyService';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SessionManager } from '../session/SessionManager';
import { VoiceControlPanel } from '../ui/VoiceControlPanel';
import { ServiceInitializable } from './ServiceInitializable';
import { Logger } from './logger';

export class ExtensionController implements ServiceInitializable {
  private initialized = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configurationManager: ConfigurationManager,
    private readonly keyService: EphemeralKeyService,
    private readonly sessionManager: SessionManager,
    private readonly voicePanel: VoiceControlPanel,
    private readonly logger: Logger
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) { return; }

    // Initialize in dependency order with error handling
    const initializedServices: Array<{ name: string, dispose: () => void }> = [];
    try {
      this.logger.info('Initializing configuration manager');
      await this.configurationManager.initialize();
      initializedServices.push({ name: 'configurationManager', dispose: () => this.configurationManager.dispose() });

      this.logger.info('Initializing ephemeral key service');
      await this.keyService.initialize();
      initializedServices.push({ name: 'keyService', dispose: () => this.keyService.dispose() });

      this.logger.info('Initializing session manager');
      await this.sessionManager.initialize();
      initializedServices.push({ name: 'sessionManager', dispose: () => this.sessionManager.dispose() });

      this.logger.info('Initializing voice control panel');
      await this.voicePanel.initialize();
      initializedServices.push({ name: 'voicePanel', dispose: () => this.voicePanel.dispose() });

      this.registerCommands();
      this.initialized = true;
    } catch (err: any) {
      this.logger.error(`Error during initialization: ${err && err.message ? err.message : err}`);
      // Dispose any services that were initialized before the error
      for (const svc of initializedServices.reverse()) {
        try {
          this.logger.info(`Disposing ${svc.name} due to failed initialization`);
          svc.dispose();
        } catch (disposeErr: any) {
          this.logger.error(`Error disposing ${svc.name}: ${disposeErr && disposeErr.message ? disposeErr.message : disposeErr}`);
        }
      }
      throw err;
    }
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    this.logger.info('Disposing voice panel');
    try {
      this.voicePanel.dispose();
    } catch (err: any) {
      this.logger.error('Error disposing voice panel:', err);
    }
    this.logger.info('Disposing session manager');
    try {
      this.sessionManager.dispose();
    } catch (err: any) {
      this.logger.error('Error disposing session manager:', err);
    }
    this.logger.info('Disposing key service');
    try {
      this.keyService.dispose();
    } catch (err: any) {
      this.logger.error('Error disposing key service:', err);
    }
    this.logger.info('Disposing configuration manager');
    try {
      this.configurationManager.dispose();
    } catch (err: any) {
      this.logger.error('Error disposing configuration manager:', err);
    }
    this.logger.info('Disposed all services');
  }

  private registerCommands(): void {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      vscode.commands.registerCommand('voicepilot.startConversation', async () => {
        try {
          await this.sessionManager.startSession();
          await this.voicePanel.show();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to start conversation: ${err.message}`);
        }
      })
    );

    disposables.push(
      vscode.commands.registerCommand('voicepilot.endConversation', async () => {
        try {
          await this.sessionManager.endSession();
        } catch (err: any) {
          vscode.window.showErrorMessage(`Failed to end conversation: ${err.message}`);
        }
      })
    );

    disposables.push(
      vscode.commands.registerCommand('voicepilot.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:voicepilot');
      })
    );

    this.context.subscriptions.push(...disposables);
  }

  // Accessors
  getConfigurationManager(): ConfigurationManager { return this.configurationManager; }
  getSessionManager(): SessionManager { return this.sessionManager; }
  getEphemeralKeyService(): EphemeralKeyService { return this.keyService; }
  getVoiceControlPanel(): VoiceControlPanel { return this.voicePanel; }
}

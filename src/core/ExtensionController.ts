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
    if (this.initialized) {return;}

    // Initialize in dependency order
  this.logger.info('Initializing configuration manager');
  await this.configurationManager.initialize();
  this.logger.info('Initializing ephemeral key service');
  await this.keyService.initialize();
  this.logger.info('Initializing session manager');
  await this.sessionManager.initialize();
  this.logger.info('Initializing voice control panel');
  await this.voicePanel.initialize();

    this.registerCommands();
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
  this.logger.info('Disposing voice panel');
  this.voicePanel.dispose();
  this.logger.info('Disposing session manager');
  this.sessionManager.dispose();
  this.logger.info('Disposing key service');
  this.keyService.dispose();
  this.logger.info('Disposing configuration manager');
  this.configurationManager.dispose();
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

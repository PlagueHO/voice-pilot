import * as vscode from 'vscode';
import { CredentialManagerImpl } from '../auth/CredentialManager';
import { EphemeralKeyServiceImpl } from '../auth/EphemeralKeyService';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { SessionManager } from '../session/SessionManager';
import { VoiceControlPanel } from '../ui/VoiceControlPanel';
import { ServiceInitializable } from './ServiceInitializable';
import { Logger } from './logger';

export class ExtensionController implements ServiceInitializable {
  private initialized = false;
  private credentialManager!: CredentialManagerImpl;
  private ephemeralKeyService!: EphemeralKeyServiceImpl;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configurationManager: ConfigurationManager,
    private readonly sessionManager: SessionManager,
    private readonly voicePanel: VoiceControlPanel,
    private readonly logger: Logger
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initialized: Array<{ name: string; dispose: () => void }> = [];
    try {
      // Initialize credential manager first
      this.credentialManager = new CredentialManagerImpl(this.context, this.logger);
      await this.safeInit('credential manager', () => this.credentialManager.initialize(), () => this.credentialManager.dispose(), initialized, 'credentialManager');

      // Initialize configuration manager
      await this.safeInit('configuration manager', () => this.configurationManager.initialize(), () => this.configurationManager.dispose(), initialized, 'configurationManager');

      // Initialize ephemeral key service with dependencies
      this.ephemeralKeyService = new EphemeralKeyServiceImpl(this.credentialManager, this.configurationManager, this.logger);
      await this.safeInit('ephemeral key service', () => this.ephemeralKeyService.initialize(), () => this.ephemeralKeyService.dispose(), initialized, 'ephemeralKeyService');

      // Initialize remaining services
      await this.safeInit('session manager', () => this.sessionManager.initialize(), () => this.sessionManager.dispose(), initialized, 'sessionManager');
      await this.safeInit('voice control panel', () => this.voicePanel.initialize(), () => this.voicePanel.dispose(), initialized, 'voicePanel');

      this.registerCommands();
      this.initialized = true;
    } catch (err: any) {
      this.logger.error(`Initialization failed: ${err?.message || err}`);
      for (const svc of initialized.reverse()) {
        try { svc.dispose(); } catch (e: any) { this.logger.error(`Error disposing ${svc.name}: ${e?.message || e}`); }
      }
      throw err;
    }
  }

  private async safeInit(label: string, initFn: () => Promise<void>, disposeFn: () => void, list: Array<{ name: string; dispose: () => void }>, name: string) {
    this.logger.info(`Initializing ${label}`);
    await initFn();
    list.push({ name, dispose: disposeFn });
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    const steps: Array<[string, () => void]> = [
      ['voice panel', () => this.voicePanel.dispose()],
      ['session manager', () => this.sessionManager.dispose()],
      ['ephemeral key service', () => this.ephemeralKeyService?.dispose()],
      ['credential manager', () => this.credentialManager?.dispose()],
      ['configuration manager', () => this.configurationManager.dispose()]
    ];
    for (const [name, fn] of steps) {
      this.logger.info(`Disposing ${name}`);
      try { fn(); } catch (err: any) { this.logger.error(`Error disposing ${name}: ${err?.message || err}`); }
    }
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

  getConfigurationManager(): ConfigurationManager { return this.configurationManager; }
  getCredentialManager(): CredentialManagerImpl { return this.credentialManager; }
  getSessionManager(): SessionManager { return this.sessionManager; }
  getEphemeralKeyService(): EphemeralKeyServiceImpl { return this.ephemeralKeyService; }
  getVoiceControlPanel(): VoiceControlPanel { return this.voicePanel; }
}

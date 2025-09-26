import * as vscode from 'vscode';
import { CredentialManagerImpl } from '../auth/credential-manager';
import { EphemeralKeyServiceImpl } from '../auth/ephemeral-key-service';
import { ConfigurationManager } from '../config/configuration-manager';
import { InterruptionEngineImpl } from '../session/interruption-engine';
import { SessionManagerImpl } from '../session/session-manager';
import { SessionTimerManagerImpl } from '../session/session-timer-manager';
import { ConversationConfig } from '../types/configuration';
import { InterruptionPolicyConfig } from '../types/conversation';
import { VoiceControlPanel } from '../ui/voice-control-panel';
import { Logger } from './logger';
import { ServiceInitializable } from './service-initializable';

export class ExtensionController implements ServiceInitializable {
  private initialized = false;
  private credentialManager!: CredentialManagerImpl;
  private ephemeralKeyService!: EphemeralKeyServiceImpl;
  private sessionTimerManager!: SessionTimerManagerImpl;
  private readonly interruptionEngine: InterruptionEngineImpl;
  private readonly controllerDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configurationManager: ConfigurationManager,
    private readonly sessionManager: SessionManagerImpl,
    private readonly voicePanel: VoiceControlPanel,
    private readonly logger: Logger,
    interruptionEngine?: InterruptionEngineImpl
  ) {
    this.interruptionEngine = interruptionEngine ?? new InterruptionEngineImpl({ logger: this.logger });
  }

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

      // Initialize session timer manager
      // Note: SessionTimerManager will be created by SessionManager internally, but we need to inject dependencies

      // Initialize session manager with all required dependencies
      // The SessionManager constructor should create its own SessionTimerManager
      if (!this.sessionManager.isInitialized()) {
        // Inject dependencies into session manager
        (this.sessionManager as any).keyService = this.ephemeralKeyService;
        (this.sessionManager as any).configManager = this.configurationManager;
        (this.sessionManager as any).logger = this.logger;
      }
      await this.safeInit('session manager', () => this.sessionManager.initialize(), () => this.sessionManager.dispose(), initialized, 'sessionManager');

      await this.safeInit(
        'interruption engine',
        async () => {
          await this.interruptionEngine.initialize();
          await this.applyConversationPolicy();
          this.registerConversationObservers();
        },
        () => this.interruptionEngine.dispose(),
        initialized,
        'interruptionEngine'
      );

      await this.safeInit('voice control panel', () => this.voicePanel.initialize(), () => this.voicePanel.dispose(), initialized, 'voicePanel');

      this.registerCommands();
      this.initialized = true;
    } catch (err: any) {
      this.logger.error(`Initialization failed: ${err?.message || err}`);
      this.disposeControllerDisposables();
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
      ['controller observers', () => this.disposeControllerDisposables()],
      ['voice panel', () => this.voicePanel.dispose()],
      ['session manager', () => this.sessionManager.dispose()],
      ['interruption engine', () => this.interruptionEngine.dispose()],
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
    this.controllerDisposables.push(...disposables);
  }

  getConfigurationManager(): ConfigurationManager { return this.configurationManager; }
  getCredentialManager(): CredentialManagerImpl { return this.credentialManager; }
  getSessionManager(): SessionManagerImpl { return this.sessionManager; }
  getEphemeralKeyService(): EphemeralKeyServiceImpl { return this.ephemeralKeyService; }
  getVoiceControlPanel(): VoiceControlPanel { return this.voicePanel; }
  getInterruptionEngine(): InterruptionEngineImpl { return this.interruptionEngine; }

  private async applyConversationPolicy(): Promise<void> {
    try {
      const conversationConfig = this.configurationManager.getConversationConfig();
      const policy = this.derivePolicyFromConfig(conversationConfig);
      await this.interruptionEngine.configure(policy);
    } catch (error: any) {
      this.logger.error('Failed to apply conversation policy', { error: error?.message ?? error });
    }
  }

  private derivePolicyFromConfig(config: ConversationConfig): InterruptionPolicyConfig {
    const base = {
      profile: config.policyProfile,
      allowBargeIn: config.allowBargeIn,
      interruptionBudgetMs: config.interruptionBudgetMs,
      completionGraceMs: config.completionGraceMs,
      speechStopDebounceMs: config.speechStopDebounceMs,
      fallbackMode: config.fallbackMode
    } as const;

    const policy: InterruptionPolicyConfig = { ...base };
    switch (config.policyProfile) {
      case 'assertive':
        policy.interruptionBudgetMs = Math.min(policy.interruptionBudgetMs, 220);
        policy.completionGraceMs = Math.min(policy.completionGraceMs, 120);
        break;
      case 'hands-free':
        policy.allowBargeIn = false;
        policy.completionGraceMs = Math.max(policy.completionGraceMs, 400);
        break;
      default:
        break;
    }
    return policy;
  }

  private registerConversationObservers(): void {
    const configDisposable = this.configurationManager.onConfigurationChanged(async change => {
      if (change.section === 'conversation') {
        await this.applyConversationPolicy();
      }
    });
    const eventDisposable = this.interruptionEngine.onEvent(async event => {
      try {
        await vscode.commands.executeCommand('setContext', 'voicepilot.conversationState', event.state);
      } catch (error: any) {
        this.logger.warn('Failed to update conversation state context', { error: error?.message ?? error });
      }
    });
    this.context.subscriptions.push(configDisposable, eventDisposable);
    this.controllerDisposables.push(configDisposable, eventDisposable);

    void vscode.commands
      .executeCommand('setContext', 'voicepilot.conversationState', this.interruptionEngine.getConversationState())
      .then(undefined, (error: unknown) => {
        const message = error instanceof Error ? error.message : error;
        this.logger.warn('Failed to set initial conversation state', { error: message });
      });
  }

  private disposeControllerDisposables(): void {
    while (this.controllerDisposables.length) {
      const disposable = this.controllerDisposables.pop();
      try {
        disposable?.dispose();
      } catch (error: any) {
        this.logger.warn('Failed to dispose controller disposable', { error: error?.message ?? error });
      }
    }
  }
}

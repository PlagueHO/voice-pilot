import * as vscode from 'vscode';
import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import { AudioConfig, AzureOpenAIConfig, AzureRealtimeConfig, CommandsConfig, ConfigurationChange, ConfigurationChangeHandler, ConversationConfig, GitHubConfig, ValidationResult } from '../types/configuration';
import { AudioSection } from './sections/audio-config-section';
import { AzureOpenAISection } from './sections/azure-openai-config-section';
import { AzureOpenAIRealtimeSection } from './sections/azure-openai-realtime-config-section';
import { CommandsSection } from './sections/commands-config-section';
import { ConversationSection } from './sections/conversation-config-section';
import { GitHubSection } from './sections/github-config-section';
import { ConfigurationValidator } from './validators/configuration-validator';

/**
 * Central configuration manager. Responsibilities:
 *  - Provide typed accessors to configuration sections
 *  - Cache values for fast repeated access
 *  - Validate configuration on initialization and on change
 *  - Emit structured change events with affected services classification
 *  - Roll back cache entries when a change handler fails
 */
export class ConfigurationManager implements ServiceInitializable {
  private initialized = false;
  private cache = new Map<string, any>();
  private changeHandlers: ConfigurationChangeHandler[] = [];
  private lastValidation: ValidationResult | undefined;
  private disposables: vscode.Disposable[] = [];

  // Section singletons
  private azureOpenAISection: AzureOpenAISection;
  private audioSection: AudioSection;
  private azureRealtimeSection: AzureOpenAIRealtimeSection;
  private commandsSection: CommandsSection;
  private conversationSection: ConversationSection;
  private gitHubSection: GitHubSection;
  private validator: ConfigurationValidator;

  private context!: vscode.ExtensionContext;
  private logger!: Logger;

  constructor(context?: vscode.ExtensionContext, logger?: Logger) {
    if (!context) {
      // Fallback minimal context for legacy tests calling no-arg constructor
      context = { subscriptions: [], extensionUri: vscode.Uri.parse('file://fallback') } as any;
    }
    if (!logger) {
      logger = new Logger('VoicePilot');
    }
  this.context = context as vscode.ExtensionContext;
  this.logger = logger as Logger;
  this.azureOpenAISection = new AzureOpenAISection();
  this.azureRealtimeSection = new AzureOpenAIRealtimeSection();
  this.audioSection = new AudioSection();
    this.commandsSection = new CommandsSection();
    this.conversationSection = new ConversationSection();
    this.gitHubSection = new GitHubSection();
    this.validator = new ConfigurationValidator(this.logger, {
      getAzureOpenAI: () => this.getAzureOpenAIConfig(),
      getAzureRealtime: () => this.getAzureRealtimeConfig(),
      getAudio: () => this.getAudioConfig(),
      getCommands: () => this.getCommandsConfig(),
      getGitHub: () => this.getGitHubConfig(),
      getConversation: () => this.getConversationConfig()
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) {return;}
    const start = performance.now();
    // Prime cache
    this.refreshAll();
    this.lastValidation = await this.validator.validateAll();
    if (!this.lastValidation.isValid) {
      this.logger.warn('Configuration validation failed', { errors: this.lastValidation.errors });
    }
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('voicepilot')) {
        this.handleConfigurationChange(e).catch(err => this.logger.error('Error handling configuration change', err));
      }
    }));
    const dur = performance.now() - start;
    if (dur > 1000) {
      this.logger.warn('Configuration load exceeded 1s constraint', { duration: dur });
    }
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.disposables = [];
  }

  // Accessors --------------------------------------------------------------
  getAzureOpenAIConfig(): AzureOpenAIConfig { return this.cached('azureOpenAI', () => this.azureOpenAISection.read()); }
  getAzureRealtimeConfig(): AzureRealtimeConfig { return this.cached('azureRealtime', () => this.azureRealtimeSection.read()); }
  // AzureSpeech config removed; callers should use Azure OpenAI realtime settings
  getAudioConfig(): AudioConfig { return this.cached('audio', () => this.audioSection.read()); }
  getCommandsConfig(): CommandsConfig { return this.cached('commands', () => this.commandsSection.read()); }
  getGitHubConfig(): GitHubConfig { return this.cached('github', () => this.gitHubSection.read()); }
  getConversationConfig(): ConversationConfig { return this.cached('conversation', () => this.conversationSection.read()); }

  getDiagnostics(): ValidationResult | undefined { return this.lastValidation; }

  onConfigurationChanged(handler: ConfigurationChangeHandler): vscode.Disposable {
    this.changeHandlers.push(handler);
    return { dispose: () => {
      const idx = this.changeHandlers.indexOf(handler);
      if (idx >= 0) {this.changeHandlers.splice(idx, 1);}
    }};
  }

  // Validation -------------------------------------------------------------
  async revalidate(): Promise<ValidationResult> {
    this.lastValidation = await this.validator.validateAll();
    return this.lastValidation;
  }

  // Internal ---------------------------------------------------------------
  private cached<T>(key: string, loader: () => T): T {
    if (this.cache.has(key)) {return this.cache.get(key);}
    const v = loader();
    this.cache.set(key, v);
    return v;
  }

  private refreshAll() {
    this.cache.clear();
    this.getAzureOpenAIConfig();
    this.getAzureRealtimeConfig();
  // removed: getAzureSpeechConfig
    this.getAudioConfig();
    this.getCommandsConfig();
    this.getGitHubConfig();
  this.getConversationConfig();
  }

  private async handleConfigurationChange(e: vscode.ConfigurationChangeEvent): Promise<void> {
    const before = { ...Object.fromEntries(this.cache.entries()) };
    this.refreshAll();
    const after = { ...Object.fromEntries(this.cache.entries()) };
    const diffs: ConfigurationChange[] = [];
    for (const section of Object.keys(after)) {
      if (JSON.stringify((before as any)[section]) !== JSON.stringify((after as any)[section])) {
        diffs.push(...this.diffSection(section, (before as any)[section], (after as any)[section]));
      }
    }
    if (diffs.length === 0) {return;}

    // Revalidate lazily (non-blocking): awaits to ensure sequence
    await this.revalidate();

    for (const change of diffs) {
      for (const handler of this.changeHandlers.slice()) {
        try {
          await handler(change);
        } catch (err: any) {
          this.logger.error('Configuration change handler failed, rolling back key', { change, error: err?.message || err });
          // rollback only this key to previous value
          (after as any)[change.section][change.key] = change.oldValue;
          this.cache.set(change.section, after[change.section]);
        }
      }
    }
  }

  private diffSection(section: string, oldVal: any, newVal: any): ConfigurationChange[] {
    if (!oldVal) {oldVal = {};}
    if (!newVal) {newVal = {};}
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    const criticalKeys = new Set([
      'azureOpenAI.endpoint','azureOpenAI.deploymentName','azureOpenAI.region'
    ]);
    const changes: ConfigurationChange[] = [];
    for (const k of keys) {
      const fullKey = `${section}.${k}`;
      if (JSON.stringify(oldVal[k]) !== JSON.stringify(newVal[k])) {
        changes.push({
          section,
            key: k,
            oldValue: oldVal[k],
            newValue: newVal[k],
            affectedServices: this.mapAffectedServices(section, k, criticalKeys.has(fullKey))
        });
      }
    }
    return changes;
  }

  private mapAffectedServices(section: string, key: string, critical: boolean): string[] {
    const base: string[] = [];
    switch (section) {
      case 'azureOpenAI':
        base.push('azureService');
        break;
      case 'azureRealtime':
        base.push('azureService');
        base.push('transcriptionService');
        break;
      case 'audio':
        base.push('audioService');
        break;
      case 'commands':
        base.push('sessionManager');
        break;
      case 'conversation':
        base.push('interruptionEngine');
        base.push('audioService');
        break;
      case 'github':
        base.push('githubService');
        break;
    }
    if (critical) {base.push('sessionRestartRequired');}
    return base;
  }
}


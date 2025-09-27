import * as vscode from 'vscode';
import { ConfigurationManager } from '../../config/configuration-manager';
import { Logger } from '../../core/logger';
import { ServiceInitializable } from '../../core/service-initializable';
import {
    calculateRetentionExpiry,
    DataClassification,
    DEFAULT_PRIVACY_POLICY,
    PrivacyAnnotatedTranscript,
    PrivacyIndicators,
    PrivacyPolicySnapshot,
    PrivacyTranscriptMetadata,
    PurgeCommand,
    PurgeReason,
    PurgeResult
} from '../../types/privacy';

export type RetentionCategory = 'audio' | 'partial-transcript' | 'final-transcript' | 'diagnostics';

type RetentionCallback = (reason: PurgeReason) => Promise<number | void> | number | void;

export interface RetentionRegistration {
  id: string;
  target: PurgeCommand['target'];
  category: RetentionCategory;
  classification: DataClassification;
  createdAt?: string;
  metadata?: Record<string, unknown>;
  purge: RetentionCallback;
}

interface RetentionEntry extends Required<Omit<RetentionRegistration, 'createdAt'>> {
  createdAt: number;
  expiresAt: number;
}

type PurgeListener = (command: PurgeCommand, result: PurgeResult) => void;

type TranscriptBuilderInput = {
  utteranceId: string;
  sessionId: string;
  content: string;
  classification?: Extract<DataClassification, 'Sensitive' | 'Confidential'>;
  redactions?: PrivacyAnnotatedTranscript['redactions'];
  createdAt?: string;
  metadata: Omit<PrivacyTranscriptMetadata, 'privacyIndicators'> & {
    privacyIndicators?: Partial<PrivacyIndicators>;
  };
};

type TranscriptBuilderOptions = TranscriptBuilderInput & {
  indicators?: Partial<PrivacyIndicators>;
};

function shallowEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class PrivacyController implements ServiceInitializable {
  private readonly retentionEntries = new Map<string, RetentionEntry>();
  private readonly purgeListeners = new Set<PurgeListener>();
  private initialized = false;
  private policy: PrivacyPolicySnapshot | undefined;
  private scheduler?: NodeJS.Timeout;
  private sweepInFlight = false;
  private configSubscription?: vscode.Disposable;

  constructor(
    private readonly configuration: ConfigurationManager,
    private readonly logger: Logger
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.reloadPolicy('initialize');
    this.scheduler = setInterval(() => {
      void this.runRetentionSweep('scheduler');
    }, 1000).unref?.();

    this.configSubscription = this.configuration.onConfigurationChanged(async change => {
      if (change.section === 'privacyPolicy') {
        await this.reloadPolicy('configuration-change');
      }
    });

    this.initialized = true;
  }

  dispose(): void {
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = undefined;
    }
    this.configSubscription?.dispose();
    this.configSubscription = undefined;
    this.retentionEntries.clear();
    this.purgeListeners.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getPolicySnapshot(): PrivacyPolicySnapshot {
    this.ensureInitialized();
    return this.policy!;
  }

  getRetentionSeconds(category: RetentionCategory): number {
    const snapshot = this.getPolicySnapshot();
    const { retention } = snapshot;
    switch (category) {
      case 'audio':
        return retention.audioSeconds;
      case 'partial-transcript':
        return retention.partialTranscriptSeconds;
      case 'final-transcript':
        return retention.finalTranscriptSeconds;
      case 'diagnostics':
        return retention.diagnosticsHours * 3600;
      default:
        return retention.finalTranscriptSeconds;
    }
  }

  onPurge(listener: PurgeListener): vscode.Disposable {
    this.purgeListeners.add(listener);
    return new vscode.Disposable(() => {
      this.purgeListeners.delete(listener);
    });
  }

  registerRetention(registration: RetentionRegistration): vscode.Disposable {
    this.ensureInitialized();
    const existing = this.retentionEntries.get(registration.id);
    const createdAt = existing?.createdAt ?? this.parseTimestamp(registration.createdAt) ?? Date.now();
    const expiresAt = this.computeExpiry(createdAt, registration.category);
    const entry: RetentionEntry = {
      ...registration,
      createdAt,
      expiresAt,
      metadata: registration.metadata ?? {}
    };
    this.retentionEntries.set(registration.id, entry);
    return new vscode.Disposable(() => {
      this.retentionEntries.delete(registration.id);
    });
  }

  updateRetention(id: string, updates: Partial<Omit<RetentionRegistration, 'id' | 'purge'>>): void {
    this.ensureInitialized();
    const entry = this.retentionEntries.get(id);
    if (!entry) {
      return;
    }
    if (updates.category) {
      entry.category = updates.category;
    }
    if (updates.classification) {
      entry.classification = updates.classification;
    }
    if (updates.metadata) {
      entry.metadata = { ...entry.metadata, ...updates.metadata };
    }
    if (updates.createdAt) {
      entry.createdAt = this.parseTimestamp(updates.createdAt) ?? entry.createdAt;
    }
    entry.expiresAt = this.computeExpiry(entry.createdAt, entry.category);
    this.retentionEntries.set(id, entry);
  }

  async issuePurge(command: PurgeCommand): Promise<PurgeResult> {
    this.ensureInitialized();
    const targets = this.selectEntries(command.target);
    const start = performance.now();
    const result = await this.executePurgeGroup(targets, command.reason, command.target);
    result.durationMs = performance.now() - start;
    this.emitPurge(command, result);
    return result;
  }

  buildTranscriptPayload(input: TranscriptBuilderOptions): PrivacyAnnotatedTranscript {
    this.ensureInitialized();
    const createdAt = input.createdAt ?? new Date().toISOString();
    const classification = input.classification ?? 'Sensitive';
    const category = classification === 'Sensitive' ? 'partial-transcript' : 'final-transcript';
    const retentionSeconds = this.getRetentionSeconds(category);
    const indicators: PrivacyIndicators = {
      containsPII: false,
      containsSecrets: false,
      profanityFiltered: input.metadata.privacyIndicators?.profanityFiltered ?? false,
      ...input.indicators,
      ...input.metadata.privacyIndicators
    } as PrivacyIndicators;

    const metadata: PrivacyTranscriptMetadata = {
      speaker: input.metadata.speaker,
      confidence: input.metadata.confidence,
      azureResponseId: input.metadata.azureResponseId,
      source: input.metadata.source ?? 'realtime',
      privacyIndicators: {
        containsPII: indicators.containsPII,
        containsSecrets: indicators.containsSecrets,
        profanityFiltered: indicators.profanityFiltered
      }
    };

    return {
      utteranceId: input.utteranceId,
      sessionId: input.sessionId,
      content: input.content,
      classification,
      redactions: input.redactions ?? [],
      createdAt,
      retentionExpiresAt: calculateRetentionExpiry(createdAt, retentionSeconds),
      metadata
    };
  }

  private async reloadPolicy(reason: 'initialize' | 'configuration-change'): Promise<void> {
    const config = this.configuration.getPrivacyPolicyConfig();
    const snapshot: PrivacyPolicySnapshot = {
      ...config,
      updatedAt: new Date().toISOString(),
      source: shallowEqual(config, DEFAULT_PRIVACY_POLICY) ? 'default' : 'user'
    };

    if (this.policy && shallowEqual(this.policy, snapshot)) {
      return;
    }

    this.policy = snapshot;
    this.logger.info('Privacy policy reloaded', {
      source: snapshot.source,
      reason
    });

    this.recalculateRetentionWindows();
    await this.runRetentionSweep('policy-change');
  }

  private recalculateRetentionWindows(): void {
    const now = Date.now();
    for (const entry of this.retentionEntries.values()) {
      entry.expiresAt = this.computeExpiry(entry.createdAt, entry.category);
      if (entry.expiresAt < now) {
        entry.expiresAt = now;
      }
    }
  }

  private selectEntries(target: PurgeCommand['target']): RetentionEntry[] {
    if (target === 'all') {
      return Array.from(this.retentionEntries.values());
    }
    return Array.from(this.retentionEntries.values()).filter(entry => entry.target === target);
  }

  private async executePurgeGroup(entries: RetentionEntry[], reason: PurgeReason, target: PurgeCommand['target']): Promise<PurgeResult> {
    let clearedCount = 0;
    let retainedCount = 0;
    const notes: string[] = [];

    for (const entry of entries) {
      try {
        const result = await entry.purge(reason);
        const cleared = typeof result === 'number' ? result : 1;
        clearedCount += cleared;
        this.retentionEntries.delete(entry.id);
      } catch (error: any) {
        retainedCount += 1;
        notes.push(`${entry.id}: ${error?.message ?? error}`);
        this.logger.warn('Retention purge failed', {
          entryId: entry.id,
          target: entry.target,
          error: error?.message ?? error
        });
      }
    }

    const status: PurgeResult['status'] = retainedCount === 0
      ? 'success'
      : clearedCount > 0
        ? 'partial'
        : 'failed';

    return {
      target,
      status,
      clearedCount,
      retainedCount,
      retentionNotes: notes.length ? notes : undefined
    };
  }

  private emitPurge(command: PurgeCommand, result: PurgeResult): void {
    for (const listener of this.purgeListeners) {
      try {
        listener(command, result);
      } catch (error: any) {
        this.logger.warn('Privacy purge listener failed', {
          error: error?.message ?? error
        });
      }
    }
  }

  private async runRetentionSweep(trigger: 'scheduler' | 'policy-change'): Promise<void> {
    if (this.sweepInFlight || this.retentionEntries.size === 0) {
      return;
    }
    this.sweepInFlight = true;
    try {
      const now = Date.now();
      const byTarget = new Map<PurgeCommand['target'], RetentionEntry[]>();
      for (const entry of this.retentionEntries.values()) {
        if (entry.expiresAt <= now) {
          const list = byTarget.get(entry.target) ?? [];
          list.push(entry);
          byTarget.set(entry.target, list);
        }
      }

      for (const [target, entries] of byTarget.entries()) {
        const command: PurgeCommand = {
          type: 'privacy.purge',
          target,
          reason: 'policy-update',
          issuedAt: new Date().toISOString(),
          correlationId: `${target}-${now}`
        };
        const result = await this.executePurgeGroup(entries, 'policy-update', target);
        result.durationMs = 0;
        this.emitPurge(command, result);
      }
    } catch (error: any) {
      this.logger.error('Retention sweep failed', {
        trigger,
        error: error?.message ?? error
      });
    } finally {
      this.sweepInFlight = false;
    }
  }

  private computeExpiry(createdAt: number, category: RetentionCategory): number {
    const retentionSeconds = this.getRetentionSeconds(category);
    return createdAt + retentionSeconds * 1000;
  }

  private parseTimestamp(value?: string): number | undefined {
    if (!value) {
      return undefined;
    }
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PrivacyController is not initialized');
    }
  }
}

import { randomUUID } from 'crypto';
import { Disposable } from 'vscode';
import {
    ConversationInterruptionMetrics,
    createInterruptionMetrics,
    incrementCooldownActivations,
    incrementFallbackActivations,
    recordInterruptionLatency
} from '../audio/audio-metrics';
import { Logger } from '../core/logger';
import {
    ConversationState,
    InterruptionEngine,
    InterruptionEngineHooks,
    InterruptionInfo,
    InterruptionPolicyConfig,
    PlaybackActivityEvent,
    SpeechActivityEvent,
    TurnDescriptor,
    TurnEvent,
    TurnEventDiagnostics,
    TurnHints
} from '../types/conversation';

const DEFAULT_POLICY: InterruptionPolicyConfig = {
  profile: 'default',
  allowBargeIn: true,
  interruptionBudgetMs: 250,
  completionGraceMs: 150,
  speechStopDebounceMs: 200,
  fallbackMode: 'hybrid'
};

const INTERRUPTION_HISTORY_WINDOW_MS = 60_000;
const COOLDOWN_DURATION_MS = 2_000;

interface PendingResponseRequest {
  hints?: TurnHints;
  createdAt: number;
}

export class InterruptionEngineImpl implements InterruptionEngine {
  private initialized = false;
  private readonly logger: Logger;
  private policy: InterruptionPolicyConfig = { ...DEFAULT_POLICY };
  private readonly listeners = new Set<(event: TurnEvent) => void>();
  private conversationState: ConversationState = 'idle';
  private activeTurn: TurnDescriptor | null = null;
  private hooks: InterruptionEngineHooks = {};
  private fallbackActive = false;
  private assistantSpeaking = false;
  private userSpeaking = false;
  private pendingUserTurnQueued = false;
  private readonly interruptionHistory: number[] = [];
  private cooldownEndsAt = 0;
  private lastAssistantStartAt = 0;
  private pendingResponse?: PendingResponseRequest;
  private pendingResponseTimer?: NodeJS.Timeout;
  private metrics: ConversationInterruptionMetrics = createInterruptionMetrics();
  private pendingResponseHints?: TurnHints;

  constructor(options?: { logger?: Logger; hooks?: InterruptionEngineHooks; policy?: Partial<InterruptionPolicyConfig> }) {
    this.logger = options?.logger ?? new Logger('InterruptionEngine');
    if (options?.hooks) {
      this.hooks = { ...options.hooks };
    }
    if (options?.policy) {
      void this.configure({ ...DEFAULT_POLICY, ...options.policy });
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.logger.debug('Interruption engine initialized', { policy: this.policy.profile });
  }

  dispose(): void {
    this.clearPendingResponseTimer();
    this.listeners.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async configure(policy: InterruptionPolicyConfig): Promise<void> {
    this.policy = this.validatePolicy(policy);
    this.emitEvent('policy-updated', { diagnostics: this.buildDiagnostics() });
    this.logger.info('Interruption policy applied', this.policy);
  }

  async handleSpeechEvent(event: SpeechActivityEvent): Promise<void> {
    this.ensureReady('handleSpeechEvent');
    if (event.type !== 'vad-degraded' && this.fallbackActive) {
      this.setFallbackState(false, 'speech-activity');
    }

    const timestampMs = this.parseTimestamp(event.timestamp);
    switch (event.type) {
      case 'user-speech-start':
        this.userSpeaking = true;
        if (!this.isCurrentTurn('user')) {
          this.beginTurn('user', event.timestamp);
        }
        if (this.assistantSpeaking) {
          await this.evaluateBargeIn(event, timestampMs);
        } else {
          this.transitionState('listening', 'User speech started');
        }
        break;
      case 'user-speech-stop':
        this.userSpeaking = false;
        this.completeTurn('user', event.timestamp);
        this.transitionState('thinking', 'User speech stopped');
        this.scheduleAssistantResponse();
        break;
      case 'assistant-speech-start':
        this.assistantSpeaking = true;
        this.lastAssistantStartAt = timestampMs ?? Date.now();
        if (!this.isCurrentTurn('assistant')) {
          this.beginTurn('assistant', event.timestamp);
        }
        this.transitionState('speaking', 'Assistant speech started');
        break;
      case 'assistant-speech-stop':
        this.assistantSpeaking = false;
        this.completeTurn('assistant', event.timestamp);
        this.onAssistantStopped();
        break;
      case 'vad-degraded':
        this.setFallbackState(true, 'azure-vad-degraded');
        this.transitionState('recovering', 'Azure VAD degraded');
        this.emitEvent('degraded', { diagnostics: this.buildDiagnostics() });
        break;
      default:
        this.logger.warn('Unhandled speech activity event', event);
    }
  }

  async handlePlaybackEvent(event: PlaybackActivityEvent): Promise<void> {
    this.ensureReady('handlePlaybackEvent');
    const timestamp = event.timestamp ?? new Date().toISOString();
    switch (event.type) {
      case 'assistant-playback-started':
        await this.handleSpeechEvent({
          type: 'assistant-speech-start',
          source: 'manual',
          timestamp,
          latencyMs: event.latencyMs
        });
        break;
      case 'assistant-playback-ended':
        await this.handleSpeechEvent({
          type: 'assistant-speech-stop',
          source: 'manual',
          timestamp,
          latencyMs: event.latencyMs
        });
        break;
      case 'assistant-playback-cancelled':
        this.assistantSpeaking = false;
        this.completeTurn('assistant', timestamp);
        this.onAssistantStopped();
        this.emitEvent('turn-ended', { diagnostics: this.buildDiagnostics() });
        break;
      default:
        this.logger.warn('Unhandled playback activity event', event);
    }
  }

  async requestAssistantYield(reason: string): Promise<void> {
    this.ensureReady('requestAssistantYield');
    if (!this.assistantSpeaking) {
      return;
    }
    await this.cancelAssistantPlayback('policy-yield', reason);
    this.assistantSpeaking = false;
    const info: InterruptionInfo = {
      type: 'policy-yield',
      detectedAt: new Date().toISOString(),
      latencyMs: 0,
      source: 'system',
      reasonCode: reason
    };
    if (this.activeTurn && this.activeTurn.role === 'assistant') {
      this.activeTurn.interruption = info;
      this.completeTurn('assistant', new Date().toISOString());
    }
    this.transitionState('listening', 'Assistant yield requested');
    this.emitEvent('interruption', {
      turn: this.cloneTurn(this.activeTurn),
      diagnostics: this.buildDiagnostics()
    });
  }

  async grantAssistantTurn(hints?: TurnHints): Promise<void> {
    this.ensureReady('grantAssistantTurn');
    this.pendingResponse = undefined;
    this.pendingResponseHints = hints;
    if (!this.assistantSpeaking) {
      this.beginTurn('assistant', new Date().toISOString());
      this.transitionState('speaking', 'Assistant response granted');
    }
  }

  getConversationState(): ConversationState {
    return this.conversationState;
  }

  getActiveTurn(): TurnDescriptor | null {
    const turn = this.cloneTurn(this.activeTurn);
    return turn ?? null;
  }

  onEvent(listener: (event: TurnEvent) => void): Disposable {
    this.listeners.add(listener);
    return new Disposable(() => {
      this.listeners.delete(listener);
    });
  }

  updateHooks(hooks: InterruptionEngineHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  // Internal helpers ---------------------------------------------------

  private ensureReady(operation: string): void {
    if (!this.initialized) {
      throw new Error(`InterruptionEngine must be initialized before ${operation}`);
    }
  }

  private validatePolicy(policy: InterruptionPolicyConfig): InterruptionPolicyConfig {
    const merged = { ...DEFAULT_POLICY, ...policy };
    if (merged.interruptionBudgetMs <= 0 || merged.interruptionBudgetMs > 750) {
      throw new Error('Interruption budget must be between 1 and 750 ms');
    }
    if (merged.speechStopDebounceMs < 50) {
      throw new Error('Speech stop debounce must be at least 50 ms');
    }
    if (merged.completionGraceMs < 0) {
      throw new Error('Completion grace must be a positive value');
    }
    return merged;
  }

  private async evaluateBargeIn(event: SpeechActivityEvent, timestampMs: number | undefined): Promise<void> {
    const now = Date.now();
    if (!this.policy.allowBargeIn || this.isCooldownActive(now)) {
      this.pendingUserTurnQueued = true;
      this.logger.debug('Barge-in suppressed due to policy or cooldown');
      return;
    }

    const latency = this.calculateLatencyMs(event, timestampMs);
    await this.cancelAssistantPlayback('barge-in', 'user-speech-start');
    this.assistantSpeaking = false;
    const interruptionInfo: InterruptionInfo = {
      type: 'barge-in',
      detectedAt: new Date().toISOString(),
      latencyMs: latency,
  source: this.normalizeInterruptionSource(event.source),
      interruptionCount: this.registerInterruption(now)
    };

    if (!this.userSpeaking) {
      this.userSpeaking = true;
    }
    if (!this.isCurrentTurn('user')) {
      this.beginTurn('user', event.timestamp);
    }
    if (this.activeTurn) {
      this.activeTurn.interruption = interruptionInfo;
    }
    this.metrics = recordInterruptionLatency(this.metrics, latency);
    const diagnostics = this.buildDiagnostics({ interruptionLatencyMs: latency });
    this.transitionState('listening', 'User barge-in detected', diagnostics);
  this.emitEvent('interruption', { turn: this.cloneTurn(this.activeTurn), diagnostics });
  }

  private registerInterruption(now: number): number {
    this.interruptionHistory.push(now);
    while (this.interruptionHistory.length && now - this.interruptionHistory[0] > INTERRUPTION_HISTORY_WINDOW_MS) {
      this.interruptionHistory.shift();
    }
    if (this.interruptionHistory.length >= 3) {
      this.cooldownEndsAt = now + Math.max(COOLDOWN_DURATION_MS, this.policy.completionGraceMs);
      this.metrics = incrementCooldownActivations(this.metrics);
    }
    return this.interruptionHistory.length;
  }

  private isCooldownActive(now: number): boolean {
    return now < this.cooldownEndsAt;
  }

  private onAssistantStopped(): void {
    this.transitionState(this.userSpeaking ? 'listening' : 'thinking', 'Assistant speech stopped');
    if (this.pendingUserTurnQueued) {
      this.pendingUserTurnQueued = false;
      this.transitionState('listening', 'User turn queued');
    }
  }

  private async cancelAssistantPlayback(type: string, reason: string): Promise<void> {
    if (!this.hooks.cancelAssistantPlayback) {
      this.logger.debug('No assistant playback cancellation hook');
      return;
    }
    const start = Date.now();
    try {
      await this.hooks.cancelAssistantPlayback({ reason, source: type });
      const latency = Date.now() - start;
      if (latency > this.policy.interruptionBudgetMs) {
        this.logger.warn('Assistant cancellation exceeded budget', { latency, budget: this.policy.interruptionBudgetMs });
      }
    } catch (error: any) {
      this.logger.error('Failed to cancel assistant playback', { error: error?.message ?? error });
    }
  }

  private scheduleAssistantResponse(): void {
    this.clearPendingResponseTimer();
    this.pendingResponse = { createdAt: Date.now(), hints: this.pendingResponseHints };
    this.pendingResponseTimer = setTimeout(() => this.triggerAssistantResponse(), this.policy.speechStopDebounceMs);
  }

  private clearPendingResponseTimer(): void {
    if (this.pendingResponseTimer) {
      clearTimeout(this.pendingResponseTimer);
      this.pendingResponseTimer = undefined;
    }
  }

  private async triggerAssistantResponse(): Promise<void> {
    if (!this.pendingResponse) {
      return;
    }
    const request = this.pendingResponse;
    this.pendingResponse = undefined;
    if (!this.hooks.requestAssistantResponse) {
      return;
    }
    try {
      await this.hooks.requestAssistantResponse({ hints: request.hints });
    } catch (error: any) {
      this.logger.error('Failed to request assistant response', { error: error?.message ?? error });
    }
  }

  private beginTurn(role: 'user' | 'assistant', timestamp: string): void {
    const nowIso = timestamp ?? new Date().toISOString();
    if (this.activeTurn && !this.activeTurn.endedAt) {
      this.activeTurn.endedAt = nowIso;
  this.emitEvent('turn-ended', { turn: this.cloneTurn(this.activeTurn) });
    }
    this.activeTurn = {
      turnId: `${role}-${randomUUID()}`,
      role,
      startedAt: nowIso,
      policyProfile: this.policy.profile
    };
  this.emitEvent('turn-started', { turn: this.cloneTurn(this.activeTurn) });
  }

  private completeTurn(role: 'user' | 'assistant', timestamp: string): void {
    if (!this.activeTurn || this.activeTurn.role !== role) {
      return;
    }
    if (!this.activeTurn.endedAt) {
      this.activeTurn.endedAt = timestamp ?? new Date().toISOString();
    }
  this.emitEvent('turn-ended', { turn: this.cloneTurn(this.activeTurn) });
  }

  private isCurrentTurn(role: 'user' | 'assistant'): boolean {
    return this.activeTurn?.role === role && !this.activeTurn?.endedAt;
  }

  private transitionState(state: ConversationState, reason: string, diagnostics?: TurnEventDiagnostics): void {
    if (this.conversationState === state) {
      return;
    }
    this.conversationState = state;
    this.emitEvent('state-changed', {
      diagnostics: diagnostics ?? this.buildDiagnostics(),
  turn: this.cloneTurn(this.activeTurn)
    });
    this.logger.debug('Conversation state changed', { state, reason });
  }

  private setFallbackState(active: boolean, reason: string): void {
    if (this.fallbackActive === active) {
      return;
    }
    this.fallbackActive = active;
    if (active) {
      this.metrics = incrementFallbackActivations(this.metrics, Date.now());
    }
    this.hooks.onFallbackChanged?.(active, reason);
    if (!active) {
      this.emitEvent('recovered', { diagnostics: this.buildDiagnostics() });
    }
  }

  private emitEvent(type: TurnEvent['type'], payload: Partial<TurnEvent> = {}): void {
    if (this.listeners.size === 0) {
      return;
    }
    const event: TurnEvent = {
      type,
      state: this.conversationState,
      timestamp: new Date().toISOString(),
  turn: payload.turn ?? this.cloneTurn(this.activeTurn),
      diagnostics: payload.diagnostics ?? this.buildDiagnostics(),
    };
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (error: any) {
        this.logger.error('Interruption listener failed', { error: error?.message ?? error, type: event.type });
      }
    }
  }

  private buildDiagnostics(overrides?: TurnEventDiagnostics): TurnEventDiagnostics {
    const diagnostics: TurnEventDiagnostics = {
      interruptionCount: this.interruptionHistory.length,
      cooldownActive: this.isCooldownActive(Date.now()),
      fallbackActive: this.fallbackActive,
      ...overrides
    };
    return diagnostics;
  }

  private cloneTurn(turn: TurnDescriptor | null): TurnDescriptor | undefined {
    if (!turn) {
      return undefined;
    }
    return { ...turn, interruption: turn.interruption ? { ...turn.interruption } : undefined };
  }

  private calculateLatencyMs(event: SpeechActivityEvent, timestampMs?: number): number {
    if (typeof event.latencyMs === 'number') {
      return event.latencyMs;
    }
    const now = Date.now();
    if (typeof timestampMs === 'number') {
      return Math.max(0, now - timestampMs);
    }
    return 0;
  }

  private parseTimestamp(timestamp: string | undefined): number | undefined {
    if (!timestamp) {
      return undefined;
    }
    const value = Date.parse(timestamp);
    return Number.isNaN(value) ? undefined : value;
  }

  private normalizeInterruptionSource(source: SpeechActivityEvent['source']): InterruptionInfo['source'] {
    if (source === 'manual') {
      return 'system';
    }
    return source;
  }
}

export type { InterruptionEngineImpl as DefaultInterruptionEngine };

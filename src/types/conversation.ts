import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';

export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'recovering';

export type PolicyProfileId = 'default' | 'assertive' | 'hands-free' | 'custom';

export interface InterruptionPolicyConfig {
  profile: PolicyProfileId;
  allowBargeIn: boolean;
  interruptionBudgetMs: number;
  completionGraceMs: number;
  speechStopDebounceMs: number;
  fallbackMode: 'manual' | 'hybrid';
}

export interface InterruptionInfo {
  type: 'barge-in' | 'manual-stop' | 'policy-yield';
  detectedAt: string;
  latencyMs: number;
  source: 'azure-vad' | 'client-hint' | 'ui-command' | 'system';
  reasonCode?: string;
  interruptionCount?: number;
}

export interface TurnDescriptor {
  turnId: string;
  role: 'user' | 'assistant';
  startedAt: string;
  endedAt?: string;
  interruption?: InterruptionInfo;
  policyProfile: PolicyProfileId;
}

export interface TurnEventDiagnostics {
  interruptionLatencyMs?: number;
  interruptionCount?: number;
  cooldownActive?: boolean;
  fallbackActive?: boolean;
}

export interface TurnEvent {
  type:
    | 'state-changed'
    | 'turn-started'
    | 'turn-ended'
    | 'interruption'
    | 'policy-updated'
    | 'degraded'
    | 'recovered';
  state: ConversationState;
  turn?: TurnDescriptor;
  timestamp: string;
  diagnostics?: TurnEventDiagnostics;
}

export interface SpeechActivityEvent {
  type:
    | 'user-speech-start'
    | 'user-speech-stop'
    | 'assistant-speech-start'
    | 'assistant-speech-stop'
    | 'vad-degraded';
  source: 'azure-vad' | 'client-hint' | 'manual';
  timestamp: string;
  latencyMs?: number;
}

export interface PlaybackActivityEvent {
  type: 'assistant-playback-started' | 'assistant-playback-ended' | 'assistant-playback-cancelled';
  handleId?: string;
  timestamp: string;
  latencyMs?: number;
}

export interface TurnHints {
  expectResponse?: boolean;
  autoResponseDelayMs?: number;
  copilotRequestId?: string;
}

export interface InterruptionEngineHooks {
  cancelAssistantPlayback?: (context: { reason: string; source: string }) => Promise<void> | void;
  requestAssistantResponse?: (context: { hints?: TurnHints }) => Promise<void> | void;
  onFallbackChanged?: (active: boolean, reason: string) => void;
}

export interface InterruptionEngine extends ServiceInitializable {
  configure(policy: InterruptionPolicyConfig): Promise<void>;
  handleSpeechEvent(event: SpeechActivityEvent): Promise<void> | void;
  handlePlaybackEvent(event: PlaybackActivityEvent): Promise<void> | void;
  requestAssistantYield(reason: string): Promise<void>;
  grantAssistantTurn(hints?: TurnHints): Promise<void>;
  getConversationState(): ConversationState;
  getActiveTurn(): TurnDescriptor | null;
  onEvent(listener: (event: TurnEvent) => void): vscode.Disposable;
  updateHooks(hooks: InterruptionEngineHooks): void;
}

export interface InterruptionEngineDiagnostics {
  fallbackActive: boolean;
  interruptionCount: number;
  cooldownEndsAt?: number;
}

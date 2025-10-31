import type { ServiceInitializable } from '../../core/service-initializable';
import type {
    AgentVoiceFaultDomain,
    AgentVoiceSeverity,
    AgentVoiceUserImpact,
} from './error-taxonomy';

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  openedAt?: Date;
  lastAttemptAt?: Date;
  failureCount: number;
  threshold: number;
  cooldownMs: number;
}

export interface RetryPlan {
  policy: 'none' | 'immediate' | 'exponential' | 'linear' | 'hybrid' | 'custom';
  attempt: number;
  maxAttempts: number;
  initialDelayMs: number;
  multiplier?: number;
  jitter?: number;
  nextAttemptAt?: Date;
  circuitBreaker?: CircuitBreakerState;
}

export interface RecoveryOutcome {
  success: boolean;
  durationMs: number;
  error?: AgentVoiceError;
}

export interface RecoveryStep {
  id: string;
  description: string;
  execute(): Promise<RecoveryOutcome>;
  compensatingAction?: () => Promise<void>;
}

export type RecoveryFallbackMode = 'safe-mode' | 'degraded-features' | 'manual-intervention';

export interface RecoveryPlan {
  steps: RecoveryStep[];
  fallbackMode?: RecoveryFallbackMode;
  notifyUser: boolean;
  suppressionWindowMs?: number;
  fallbackHandlers?: Partial<Record<RecoveryFallbackMode, () => Promise<void>>>;
}

export interface TelemetryDeviceInfo {
  platform: string;
  vscodeVersion: string;
  extensionVersion: string;
  networkType?: 'offline' | 'metered' | 'unmetered';
}

export interface TelemetryContext {
  correlationId: string;
  sessionId?: string;
  requestId?: string;
  connectionId?: string;
  deviceInfo?: TelemetryDeviceInfo;
}

export interface AgentVoiceError {
  id: string;
  faultDomain: AgentVoiceFaultDomain;
  severity: AgentVoiceSeverity;
  userImpact: AgentVoiceUserImpact;
  code: string;
  message: string;
  remediation: string;
  cause?: Error;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  retryPlan?: RetryPlan;
  recoveryPlan?: RecoveryPlan;
  telemetryContext?: TelemetryContext;
}

export interface ErrorEventHandler {
  (error: AgentVoiceError): Promise<void> | void;
}

export interface SubscriptionOptions {
  domains?: AgentVoiceFaultDomain[];
  severities?: AgentVoiceSeverity[];
  once?: boolean;
}

export interface ErrorEventBus extends ServiceInitializable {
  publish(error: AgentVoiceError): Promise<void>;
  subscribe(handler: ErrorEventHandler, options?: SubscriptionOptions): import('vscode').Disposable;
}

export interface ErrorPresentationAdapter {
  showStatusBarBadge(error: AgentVoiceError): Promise<void>;
  showPanelBanner(error: AgentVoiceError): Promise<void>;
  appendTranscriptNotice(error: AgentVoiceError): Promise<void>;
  clearSuppressedNotifications(domain: AgentVoiceFaultDomain): Promise<void>;
}

export interface RecoveryRegistrar {
  addStep(step: RecoveryStep): void;
  addFallback(mode: RecoveryFallbackMode, handler: () => Promise<void>): void;
  setNotification(options: { notifyUser?: boolean; suppressionWindowMs?: number }): void;
  toRecoveryPlan(defaults?: Partial<Omit<RecoveryPlan, 'steps'>>): RecoveryPlan;
}

export interface RecoveryContext {
  correlationId: string;
  sessionId?: string;
  operation: string;
  onRetryScheduled?: (plan: RetryPlan) => void;
  onRecoveryComplete?: (outcome: RecoveryOutcome) => void;
}

export interface RecoveryExecutionOptions extends RecoveryContext {
  faultDomain: AgentVoiceFaultDomain;
  code: string;
  message: string;
  remediation: string;
  severity: AgentVoiceSeverity;
  userImpact: AgentVoiceUserImpact;
  metadata?: Record<string, unknown>;
  retry?: {
    policy?: RetryPlan['policy'];
    maxAttempts?: number;
    initialDelayMs?: number;
    multiplier?: number;
    jitter?: number;
  };
  recoveryPlan?: RecoveryPlan;
  telemetryContext?: TelemetryContext;
}

export interface RecoveryExecutor {
  execute<T>(operation: () => Promise<T>, options: RecoveryExecutionOptions): Promise<T>;
}

export interface RecoverableService {
  domain: AgentVoiceFaultDomain;
  withRecovery<T>(operation: () => Promise<T>, context: RecoveryExecutionOptions): Promise<T>;
  registerRecoveryActions(registrar: RecoveryRegistrar): void;
}

export type { AgentVoiceFaultDomain, } from './error-taxonomy';

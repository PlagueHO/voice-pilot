import type {
    AgentVoiceFaultDomain,
    AgentVoiceSeverity,
} from "../../types/error/error-taxonomy";
import type {
    CircuitBreakerState,
    RetryPlan,
    AgentVoiceError,
} from "../../types/error/agent-voice-error";
import type { RetryDomainOverride, RetryEnvelope } from "../../types/retry";
import type { Logger } from "../logger";
import type { ServiceInitializable } from "../service-initializable";

export interface RetryClock {
  now(): number;
  wait(ms: number): Promise<void>;
}

export interface RetryFailureContext {
  readonly attempt: number;
  readonly envelope: RetryEnvelope;
  readonly error: unknown;
  readonly elapsedMs: number;
  readonly delayMs: number;
  readonly retryPlan: RetryPlan | undefined;
  readonly circuitBreaker: CircuitBreakerState | undefined;
}

export interface RetryFailureResult {
  error: AgentVoiceError;
  shouldRetry?: boolean;
  retryPlan?: RetryPlan;
}

export interface RetryOutcome {
  success: boolean;
  attempts: number;
  totalDurationMs: number;
  lastError?: AgentVoiceError;
  circuitBreakerOpened?: boolean;
}

export interface RetryMetricsSink {
  incrementAttempt(
    domain: AgentVoiceFaultDomain,
    severity: AgentVoiceSeverity,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  recordOutcome(
    domain: AgentVoiceFaultDomain,
    outcome: RetryOutcome,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}

export interface RetryExecutionContext {
  correlationId: string;
  sessionId?: string;
  operation: string;
  envelope: RetryEnvelope;
  clock: RetryClock;
  logger: Logger;
  metrics: RetryMetricsSink;
  severity?: AgentVoiceSeverity;
  metadata?: Record<string, unknown>;
  onAttempt?: (attempt: number, delayMs: number) => void | Promise<void>;
  onRetryScheduled?: (plan: RetryPlan, error?: AgentVoiceError) => void | Promise<void>;
  onFailure?: (
    context: RetryFailureContext,
  ) => RetryFailureResult | Promise<RetryFailureResult>;
  onComplete?: (outcome: RetryOutcome) => void | Promise<void>;
  onCircuitOpen?: (
    state: CircuitBreakerState,
  ) => AgentVoiceError | Promise<AgentVoiceError>;
}

export interface RetryExecutor extends ServiceInitializable {
  execute<T>(fn: () => Promise<T>, context: RetryExecutionContext): Promise<T>;
  getCircuitBreakerState(
    domain: AgentVoiceFaultDomain,
  ): CircuitBreakerState | undefined;
  reset(domain: AgentVoiceFaultDomain): void;
}

export interface RetryConfigurationValidation {
  isValid: boolean;
  errors: string[];
}

export interface RetryConfigurationProvider extends ServiceInitializable {
  getEnvelope(domain: AgentVoiceFaultDomain): RetryEnvelope;
  getOverride(
    domain: AgentVoiceFaultDomain,
  ): RetryDomainOverride | undefined;
  validateEnvelope(envelope: RetryEnvelope): RetryConfigurationValidation;
}

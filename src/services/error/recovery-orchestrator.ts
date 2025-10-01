import { setTimeout as timerSetTimeout } from 'timers/promises';
import { Logger } from '../../core/logger';
import type { ServiceInitializable } from '../../core/service-initializable';
import { createVoicePilotError } from '../../helpers/error/envelope';
import {
  DEFAULT_SEVERITY_FOR_DOMAIN,
  DEFAULT_USER_IMPACT_FOR_DOMAIN
} from '../../types/error/error-taxonomy';
import type {
  CircuitBreakerState,
  ErrorEventBus,
  RecoveryExecutionOptions,
  RecoveryExecutor,
  RetryPlan,
  VoicePilotError
} from '../../types/error/voice-pilot-error';
import type { RecoveryRegistrationCenter } from './recovery-registrar';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_JITTER = 0.2; // 20%
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;

/**
 * Dependencies required to construct and operate the recovery orchestrator.
 */
interface RecoveryOrchestratorDependencies {
  eventBus: ErrorEventBus;
  logger: Logger;
  registry?: RecoveryRegistrationCenter;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Coordinates recovery execution, including retry strategies, circuit breaker
 * enforcement, and recovery plan invocation when operations fail.
 */
export class RecoveryOrchestrator implements RecoveryExecutor, ServiceInitializable {
  private initialized = false;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly breakers = new Map<string, CircuitBreakerState>();

  /**
   * Builds a new orchestrator instance using the provided dependencies.
   *
   * @param deps - Collaborators required for recovery coordination.
   */
  constructor(private readonly deps: RecoveryOrchestratorDependencies) {
    this.wait = deps.wait ?? (async (ms: number) => {
      if (ms <= 0) {
        return;
      }
      await timerSetTimeout(ms);
    });
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Initializes the orchestrator and its dependencies, ensuring the event bus
   * is ready before processing recovery operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.deps.eventBus.isInitialized()) {
      await this.deps.eventBus.initialize();
    }
    this.initialized = true;
  }

  /**
   * Indicates whether the orchestrator has completed initialization.
   *
   * @returns True when initialization has run, otherwise false.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Disposes orchestrator state, including circuit breaker tracking.
   */
  dispose(): void {
    this.breakers.clear();
    this.initialized = false;
  }

  /**
   * Executes an operation with retry handling, circuit breaker enforcement, and
   * optional recovery plan execution upon failure.
   *
   * @typeParam T - Return type of the asynchronous operation.
   * @param operation - Asynchronous action to execute.
   * @param options - Recovery execution configuration and callbacks.
   * @returns Resolves with the operation result when successful.
   * @throws {@link VoicePilotError} when the operation ultimately fails or the
   * circuit breaker is open.
   */
  async execute<T>(operation: () => Promise<T>, options: RecoveryExecutionOptions): Promise<T> {
    const start = this.now();
    await this.ensureInitialized();

    const policy = options.retry?.policy ?? 'exponential';
    const maxAttempts = Math.max(options.retry?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, 1);
    const initialDelay = options.retry?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const multiplier = options.retry?.multiplier ?? DEFAULT_MULTIPLIER;
    const jitter = options.retry?.jitter ?? DEFAULT_JITTER;

    const breakerKey = `${options.faultDomain}:${options.operation}`;
    if (this.isCircuitOpen(breakerKey)) {
      throw createVoicePilotError({
        faultDomain: options.faultDomain,
        code: `${options.code}_CIRCUIT_OPEN`,
        message: `${options.message} (circuit breaker open)`,
        remediation: options.remediation,
        severity: DEFAULT_SEVERITY_FOR_DOMAIN[options.faultDomain],
        userImpact: DEFAULT_USER_IMPACT_FOR_DOMAIN[options.faultDomain],
        metadata: {
          ...options.metadata,
          circuitBreaker: this.breakers.get(breakerKey)
        }
      });
    }

    let attempt = 0;
    let lastError: VoicePilotError | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;
      const attemptStart = this.now();

      try {
        const result = await operation();
        const duration = this.now() - start;
        options.onRecoveryComplete?.({ success: true, durationMs: duration });
        this.resetCircuit(breakerKey);
        return result;
      } catch (error: unknown) {
        const duration = this.now() - attemptStart;
        lastError = this.handleFailure(error, options, attempt, maxAttempts, policy, initialDelay, multiplier, jitter, breakerKey, duration);

        if (attempt >= maxAttempts || policy === 'none') {
          await this.runRecoveryPlan(lastError, options);
          options.onRecoveryComplete?.({ success: false, durationMs: this.now() - start, error: lastError });
          throw lastError;
        }

        const retryPlan = lastError.retryPlan;
        if (!retryPlan) {
          await this.runRecoveryPlan(lastError, options);
          options.onRecoveryComplete?.({ success: false, durationMs: this.now() - start, error: lastError });
          throw lastError;
        }

        options.onRetryScheduled?.(retryPlan);
        await this.wait(Math.max(0, retryPlan.initialDelayMs));
      }
    }

    if (lastError) {
      await this.runRecoveryPlan(lastError, options);
      options.onRecoveryComplete?.({ success: false, durationMs: this.now() - start, error: lastError });
      throw lastError;
    }

    throw createVoicePilotError({
      faultDomain: options.faultDomain,
      code: `${options.code}_UNKNOWN_FAILURE`,
      message: `${options.message} failed for an unknown reason`,
      remediation: options.remediation,
      metadata: options.metadata
    });
  }

  /**
   * Ensures the orchestrator is initialized prior to executing recovery logic.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Converts an operation failure into a {@link VoicePilotError}, publishes it
   * on the event bus, and updates the circuit breaker state.
   *
   * @param error - Original error thrown by the operation.
   * @param options - Recovery execution configuration.
   * @param attempt - Current attempt index (1-based).
   * @param maxAttempts - Maximum permitted attempts.
   * @param policy - Retry policy in effect.
   * @param initialDelay - Base delay used for retry calculations.
   * @param multiplier - Backoff multiplier for exponential retry.
   * @param jitter - Jitter percentage applied to delay.
   * @param breakerKey - Key identifying the circuit breaker to update.
   * @param durationMs - Duration of the failed attempt in milliseconds.
   * @returns Structured {@link VoicePilotError} describing the failure.
   */
  private handleFailure(
    error: unknown,
    options: RecoveryExecutionOptions,
    attempt: number,
    maxAttempts: number,
    policy: RetryPlan['policy'],
    initialDelay: number,
    multiplier: number,
    jitter: number,
    breakerKey: string,
    durationMs: number
  ): VoicePilotError {
    const recoveryPlan = options.recoveryPlan ?? this.deps.registry?.get(options.faultDomain);
    const retryPlan = this.buildRetryPlan({
      attempt,
      maxAttempts,
      policy,
      initialDelay,
      multiplier,
      jitter,
      breakerKey
    });

    const voiceError = createVoicePilotError({
      faultDomain: options.faultDomain,
      code: options.code,
      message: options.message,
      remediation: options.remediation,
      severity: options.severity,
      userImpact: options.userImpact,
      metadata: {
        ...options.metadata,
        attempt,
        maxAttempts,
        durationMs,
        originalError: this.serializeError(error)
      },
      cause: error instanceof Error ? error : undefined,
      retryPlan,
      recoveryPlan,
      telemetryContext: options.telemetryContext
    });

    void this.deps.eventBus.publish(voiceError);
    this.tripCircuit(breakerKey, retryPlan);
    return voiceError;
  }

  /**
   * Creates a retry plan describing the next attempt, honoring the selected
   * policy and applying jitter when configured.
   *
   * @param params - Attributes describing the current retry state.
   * @returns Calculated retry plan or undefined when policy disables retries.
   */
  private buildRetryPlan(params: {
    attempt: number;
    maxAttempts: number;
    policy: RetryPlan['policy'];
    initialDelay: number;
    multiplier: number;
    jitter: number;
    breakerKey: string;
  }): RetryPlan | undefined {
    if (params.policy === 'none') {
      return undefined;
    }

    const nextAttemptAt = this.now();

    let delay = params.policy === 'immediate'
      ? 0
      : params.initialDelay * Math.pow(params.multiplier, Math.max(0, params.attempt - 1));

    if (params.jitter > 0 && delay > 0) {
      const jitterValue = delay * params.jitter;
      const variation = (Math.random() * jitterValue * 2) - jitterValue;
      delay = Math.max(0, delay + variation);
    }

    const breaker = this.breakers.get(params.breakerKey);

    return {
      policy: params.policy,
      attempt: params.attempt,
      maxAttempts: params.maxAttempts,
      initialDelayMs: delay,
      multiplier: params.multiplier,
      jitter: params.jitter,
      nextAttemptAt: new Date(nextAttemptAt + delay),
      circuitBreaker: breaker
    };
  }

  /**
   * Executes all steps and fallback handlers defined in the recovery plan tied
   * to the supplied error and execution options.
   *
   * @param error - VoicePilot error containing the resolved recovery plan.
   * @param options - Execution options that may include an explicit plan.
   */
  private async runRecoveryPlan(error: VoicePilotError, options: RecoveryExecutionOptions): Promise<void> {
    const plan = error.recoveryPlan ?? options.recoveryPlan ?? this.deps.registry?.get(options.faultDomain);
    if (!plan) {
      return;
    }

    for (const step of plan.steps) {
      try {
        const outcome = await step.execute();
        if (!outcome.success && step.compensatingAction) {
          await step.compensatingAction();
        }
      } catch (stepError: unknown) {
        this.deps.logger.warn('Recovery step failed', {
          step: step.id,
          error: this.toErrorMessage(stepError)
        });
      }
    }

    if (plan.fallbackMode && plan.fallbackHandlers?.[plan.fallbackMode]) {
      try {
        await plan.fallbackHandlers[plan.fallbackMode]!();
      } catch (fallbackError: unknown) {
        this.deps.logger.error('Fallback handler failed', {
          fallbackMode: plan.fallbackMode,
          error: this.toErrorMessage(fallbackError)
        });
      }
    }
  }

  /**
   * Determines whether the circuit breaker for the given key is currently
   * prohibiting execution.
   *
   * @param key - Circuit breaker identifier.
   * @returns True when the breaker is open and within its cooldown window.
   */
  private isCircuitOpen(key: string): boolean {
    const breaker = this.breakers.get(key);
    if (!breaker) {
      return false;
    }
    if (breaker.state !== 'open') {
      return false;
    }
    if (!breaker.openedAt) {
      return false;
    }
    const elapsed = this.now() - breaker.openedAt.getTime();
    if (elapsed > breaker.cooldownMs) {
      this.breakers.set(key, {
        ...breaker,
        state: 'half-open',
        failureCount: 0
      });
      return false;
    }
    return true;
  }

  /**
   * Resets the circuit breaker state to closed when present.
   *
   * @param key - Circuit breaker identifier.
   */
  private resetCircuit(key: string): void {
    if (this.breakers.has(key)) {
      this.breakers.set(key, {
        state: 'closed',
        failureCount: 0,
        threshold: CIRCUIT_THRESHOLD,
        cooldownMs: CIRCUIT_COOLDOWN_MS
      });
    }
  }

  /**
   * Increments the failure count for the circuit breaker and transitions to an
   * open state once the threshold is exceeded.
   *
   * @param key - Circuit breaker identifier.
   * @param plan - Retry plan used to source cooldown metadata, when available.
   */
  private tripCircuit(key: string, plan?: RetryPlan): void {
    const existing = this.breakers.get(key);
    const failureCount = (existing?.failureCount ?? 0) + 1;
    const state: CircuitBreakerState = {
      state: failureCount >= CIRCUIT_THRESHOLD ? 'open' : existing?.state ?? 'closed',
      failureCount,
      threshold: CIRCUIT_THRESHOLD,
      cooldownMs: plan?.circuitBreaker?.cooldownMs ?? CIRCUIT_COOLDOWN_MS,
      openedAt: failureCount >= CIRCUIT_THRESHOLD ? new Date(this.now()) : existing?.openedAt,
      lastAttemptAt: new Date(this.now())
    };
    this.breakers.set(key, state);
  }

  /**
   * Serializes an unknown error into structured metadata safe for telemetry
   * transport.
   *
   * @param error - Unknown error to serialize.
   * @returns Plain object describing the error when possible.
   */
  private serializeError(error: unknown): Record<string, unknown> | undefined {
    if (!error) {
      return undefined;
    }
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    if (typeof error === 'object') {
      try {
        return JSON.parse(JSON.stringify(error));
      } catch {
        return { message: String(error) };
      }
    }
    return { message: String(error) };
  }

  /**
   * Derives a human-readable error message from an unknown error value.
   *
   * @param error - Unknown error input.
   * @returns String representation suitable for logging.
   */
  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }
}

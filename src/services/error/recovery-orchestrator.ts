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

interface RecoveryOrchestratorDependencies {
  eventBus: ErrorEventBus;
  logger: Logger;
  registry?: RecoveryRegistrationCenter;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class RecoveryOrchestrator implements RecoveryExecutor, ServiceInitializable {
  private initialized = false;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly breakers = new Map<string, CircuitBreakerState>();

  constructor(private readonly deps: RecoveryOrchestratorDependencies) {
    this.wait = deps.wait ?? (async (ms: number) => {
      if (ms <= 0) {
        return;
      }
      await timerSetTimeout(ms);
    });
    this.now = deps.now ?? (() => Date.now());
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.deps.eventBus.isInitialized()) {
      await this.deps.eventBus.initialize();
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.breakers.clear();
    this.initialized = false;
  }

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
      } catch (error: any) {
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

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

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
      } catch (stepError: any) {
        this.deps.logger.warn('Recovery step failed', {
          step: step.id,
          error: stepError?.message ?? stepError
        });
      }
    }

    if (plan.fallbackMode && plan.fallbackHandlers?.[plan.fallbackMode]) {
      try {
        await plan.fallbackHandlers[plan.fallbackMode]!();
      } catch (fallbackError: any) {
        this.deps.logger.error('Fallback handler failed', {
          fallbackMode: plan.fallbackMode,
          error: fallbackError?.message ?? fallbackError
        });
      }
    }
  }

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
}

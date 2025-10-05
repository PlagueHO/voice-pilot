import { setTimeout as timerSetTimeout } from "timers/promises";
import { Logger } from "../../core/logger";
import type {
    RetryConfigurationProvider,
    RetryExecutionContext,
    RetryExecutor as RetryExecutorContract,
    RetryFailureContext,
    RetryFailureResult,
    RetryMetricsSink,
} from "../../core/retry/retry-types";
import type { ServiceInitializable } from "../../core/service-initializable";
import { createVoicePilotError } from "../../helpers/error/envelope";
import type { VoicePilotFaultDomain } from "../../types/error/error-taxonomy";
import {
    DEFAULT_SEVERITY_FOR_DOMAIN,
    DEFAULT_USER_IMPACT_FOR_DOMAIN,
} from "../../types/error/error-taxonomy";
import type {
    CircuitBreakerState,
    ErrorEventBus,
    RecoveryExecutionOptions,
    RecoveryExecutor,
    RetryPlan,
    VoicePilotError,
} from "../../types/error/voice-pilot-error";
import type { RetryEnvelope, RetryPolicy } from "../../types/retry";
import type { RecoveryRegistrationCenter } from "./recovery-registrar";

interface RecoveryOrchestratorDependencies {
  eventBus: ErrorEventBus;
  logger: Logger;
  registry?: RecoveryRegistrationCenter;
  retryProvider: RetryConfigurationProvider;
  retryExecutor: RetryExecutorContract;
  metrics: RetryMetricsSink;
  clock?: RetryExecutionContext["clock"];
}

export class RecoveryOrchestrator implements RecoveryExecutor, ServiceInitializable {
  private initialized = false;
  private readonly clock: RetryExecutionContext["clock"];

  constructor(private readonly deps: RecoveryOrchestratorDependencies) {
    this.clock =
      deps.clock ??
      ({
        now: () => Date.now(),
        wait: async (ms: number) => {
          if (ms <= 0) {
            return;
          }
          await timerSetTimeout(ms);
        },
      } satisfies RetryExecutionContext["clock"]);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (!this.deps.eventBus.isInitialized()) {
      await this.deps.eventBus.initialize();
    }
    if (!this.deps.retryProvider.isInitialized()) {
      await this.deps.retryProvider.initialize();
    }
    if (!this.deps.retryExecutor.isInitialized()) {
      await this.deps.retryExecutor.initialize();
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.deps.retryExecutor.dispose();
    this.deps.retryProvider.dispose();
    this.initialized = false;
  }

  getCircuitBreakerState(domain: VoicePilotFaultDomain): CircuitBreakerState | undefined {
    return this.deps.retryExecutor.getCircuitBreakerState(domain);
  }

  reset(domain: VoicePilotFaultDomain): void {
    this.deps.retryExecutor.reset(domain);
  }

  async execute<T>(operation: () => Promise<T>, options: RecoveryExecutionOptions): Promise<T> {
    const start = this.clock.now();
    await this.ensureInitialized();
    const envelope = this.resolveEnvelope(options);

    const context: RetryExecutionContext = {
      correlationId: options.correlationId,
      sessionId: options.sessionId,
      operation: options.operation,
      envelope,
      clock: this.clock,
      logger: this.deps.logger,
      metrics: this.deps.metrics,
      severity: options.severity,
      metadata: options.metadata,
      onRetryScheduled: (plan, error) => {
        if (options.onRetryScheduled) {
          options.onRetryScheduled(plan);
        }
        if (error) {
          this.deps.logger.debug("Retry scheduled with error context", {
            domain: envelope.domain,
            attempt: plan.attempt,
            error: error.code,
          });
        }
      },
      onFailure: (failureContext) => this.handleFailure(failureContext, options),
      onComplete: (outcome) => {
        options.onRecoveryComplete?.({
          success: outcome.success,
          durationMs: outcome.totalDurationMs,
          error: outcome.lastError,
        });
      },
      onCircuitOpen: (state) => this.handleCircuitOpen(options, state),
    };

    try {
      const result = await this.deps.retryExecutor.execute(operation, context);
      options.onRecoveryComplete?.({
        success: true,
        durationMs: this.clock.now() - start,
      });
      return result;
    } catch (error: unknown) {
      const voiceError = this.normalizeError(error, options);
      await this.runRecoveryPlan(voiceError, options);
      options.onRecoveryComplete?.({
        success: false,
        durationMs: this.clock.now() - start,
        error: voiceError,
      });
      throw voiceError;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private resolveEnvelope(options: RecoveryExecutionOptions): RetryEnvelope {
    const baseEnvelope = this.deps.retryProvider.getEnvelope(options.faultDomain);
    const envelope: RetryEnvelope = { ...baseEnvelope };
    const runtime = options.retry;

    if (runtime?.policy) {
      envelope.policy = runtime.policy as RetryPolicy;
    }
    if (runtime?.maxAttempts !== undefined) {
      envelope.maxAttempts = Math.max(1, runtime.maxAttempts);
    }
    if (runtime?.initialDelayMs !== undefined) {
      envelope.initialDelayMs = runtime.initialDelayMs;
    }
    if (runtime?.multiplier !== undefined) {
      envelope.multiplier = runtime.multiplier;
    }
    if (runtime?.jitter === 0) {
      envelope.jitterStrategy = "none";
    } else if (runtime?.jitter && runtime.jitter > 0) {
      envelope.jitterStrategy = "deterministic-full";
    }

    if (envelope.policy === "none") {
      envelope.maxAttempts = 1;
      envelope.initialDelayMs = 0;
      envelope.jitterStrategy = "none";
    }

    const validation = this.deps.retryProvider.validateEnvelope(envelope);
    if (!validation.isValid) {
      this.deps.logger.warn("Retry envelope validation failed; reverting to defaults", {
        domain: options.faultDomain,
        errors: validation.errors,
      });
      return baseEnvelope;
    }

    return envelope;
  }

  private async runRecoveryPlan(error: VoicePilotError, options: RecoveryExecutionOptions): Promise<void> {
    const plan =
      error.recoveryPlan ??
      options.recoveryPlan ??
      this.deps.registry?.get(options.faultDomain);
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
        this.deps.logger.warn("Recovery step failed", {
          step: step.id,
          error: this.toErrorMessage(stepError),
        });
      }
    }

    if (plan.fallbackMode && plan.fallbackHandlers?.[plan.fallbackMode]) {
      try {
        await plan.fallbackHandlers[plan.fallbackMode]!();
      } catch (fallbackError: unknown) {
        this.deps.logger.error("Fallback handler failed", {
          fallbackMode: plan.fallbackMode,
          error: this.toErrorMessage(fallbackError),
        });
      }
    }
  }

  private handleFailure(
    failure: RetryFailureContext,
    options: RecoveryExecutionOptions,
  ): RetryFailureResult {
    const retryPlan = failure.retryPlan ?? {
      policy: failure.envelope.policy as RetryPlan["policy"],
      attempt: failure.attempt,
      maxAttempts: failure.envelope.maxAttempts,
      initialDelayMs: failure.delayMs,
      multiplier: failure.envelope.multiplier,
      jitter: failure.envelope.jitterStrategy === "none" ? 0 : undefined,
      nextAttemptAt: new Date(this.clock.now() + failure.delayMs),
      circuitBreaker: failure.circuitBreaker,
    };

    const recoveryPlan =
      options.recoveryPlan ?? this.deps.registry?.get(options.faultDomain);

    const voiceError = createVoicePilotError({
      faultDomain: options.faultDomain,
      code: options.code,
      message: options.message,
      remediation: options.remediation,
      severity:
        options.severity ?? DEFAULT_SEVERITY_FOR_DOMAIN[options.faultDomain],
      userImpact:
        options.userImpact ?? DEFAULT_USER_IMPACT_FOR_DOMAIN[options.faultDomain],
      metadata: {
        ...options.metadata,
        attempt: failure.attempt,
        elapsedMs: failure.elapsedMs,
        failureBudgetMs: failure.envelope.failureBudgetMs,
        originalError: this.serializeError(failure.error),
      },
      cause: failure.error instanceof Error ? failure.error : undefined,
      retryPlan,
      recoveryPlan,
      telemetryContext: options.telemetryContext,
    });

    void this.deps.eventBus.publish(voiceError);

    const shouldRetry =
      options.retry?.policy === "none" || retryPlan.policy === "none"
        ? false
        : undefined;

    return {
      error: voiceError,
      shouldRetry,
      retryPlan,
    };
  }

  private handleCircuitOpen(
    options: RecoveryExecutionOptions,
    state: CircuitBreakerState,
  ): VoicePilotError {
    const error = createVoicePilotError({
      faultDomain: options.faultDomain,
      code: `${options.code}_CIRCUIT_OPEN`,
      message: `${options.message} (circuit breaker open)`,
      remediation: options.remediation,
      severity:
        options.severity ?? DEFAULT_SEVERITY_FOR_DOMAIN[options.faultDomain],
      userImpact:
        options.userImpact ?? DEFAULT_USER_IMPACT_FOR_DOMAIN[options.faultDomain],
      metadata: {
        ...options.metadata,
        circuitBreaker: state,
      },
    });
    void this.deps.eventBus.publish(error);
    return error;
  }

  private normalizeError(
    error: unknown,
    options: RecoveryExecutionOptions,
  ): VoicePilotError {
    if (error && typeof error === "object" && "code" in (error as any)) {
      return error as VoicePilotError;
    }
    return createVoicePilotError({
      faultDomain: options.faultDomain,
      code: `${options.code}_UNKNOWN_FAILURE`,
      message: `${options.message} failed for an unknown reason`,
      remediation: options.remediation,
      metadata: {
        ...options.metadata,
        originalError: this.serializeError(error),
      },
      severity:
        options.severity ?? DEFAULT_SEVERITY_FOR_DOMAIN[options.faultDomain],
      userImpact:
        options.userImpact ?? DEFAULT_USER_IMPACT_FOR_DOMAIN[options.faultDomain],
    });
  }

  private serializeError(error: unknown): Record<string, unknown> | undefined {
    if (!error) {
      return undefined;
    }
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    if (typeof error === "object") {
      try {
        return JSON.parse(JSON.stringify(error));
      } catch {
        return { message: String(error) };
      }
    }
    return { message: String(error) };
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return String(error);
  }
}

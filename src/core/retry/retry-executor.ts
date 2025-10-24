import { randomUUID } from "crypto";
import type { VoicePilotFaultDomain } from "../../types/error/error-taxonomy";
import type {
    CircuitBreakerState,
    VoicePilotError,
} from "../../types/error/voice-pilot-error";
import { Logger } from "../logger";
import type {
    RetryExecutionContext,
    RetryExecutor,
    RetryFailureContext,
    RetryFailureResult
} from "./retry-types";

const CIRCUIT_MIN_THRESHOLD = 2;

const jitterSeed = (correlationId: string, attempt: number): number => {
  let hash = 0;
  const input = `${correlationId}:${attempt}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffffffff;
};

const cloneCircuit = (state: CircuitBreakerState | undefined): CircuitBreakerState | undefined =>
  state
    ? {
        state: state.state,
        failureCount: state.failureCount,
        threshold: state.threshold,
        cooldownMs: state.cooldownMs,
        openedAt: state.openedAt ? new Date(state.openedAt) : undefined,
        lastAttemptAt: state.lastAttemptAt ? new Date(state.lastAttemptAt) : undefined,
      }
    : undefined;

export class RetryExecutorImpl implements RetryExecutor {
  private initialized = false;
  private readonly breakers = new Map<VoicePilotFaultDomain, CircuitBreakerState>();

  constructor(private readonly logger: Logger) {}

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.breakers.clear();
    this.initialized = false;
  }

  getCircuitBreakerState(domain: VoicePilotFaultDomain): CircuitBreakerState | undefined {
    return cloneCircuit(this.breakers.get(domain));
  }

  reset(domain: VoicePilotFaultDomain): void {
    this.breakers.delete(domain);
  }

  async execute<T>(fn: () => Promise<T>, context: RetryExecutionContext): Promise<T> {
    await this.ensureInitialized();
    const envelope = { ...context.envelope };
    const start = context.clock.now();
    const breaker = this.ensureBreaker(
      envelope.domain,
      envelope.coolDownMs,
      envelope.maxAttempts,
    );

    if (this.isCircuitOpen(breaker, context.clock.now())) {
      const circuitError = await this.resolveCircuitOpenError(context, breaker);
      throw circuitError;
    }

    let attempt = 0;
    let totalDuration = 0;
    let previousDelay = 0;
    let lastError: VoicePilotError | undefined;

    while (attempt < envelope.maxAttempts) {
      if (this.isCircuitOpen(breaker, context.clock.now())) {
        const circuitError = await this.resolveCircuitOpenError(
          context,
          breaker,
        );
        const totalDurationMs = context.clock.now() - start;
        await context.metrics.recordOutcome(envelope.domain, {
          success: false,
          attempts: attempt,
          totalDurationMs,
          lastError: circuitError,
          circuitBreakerOpened: true,
        });
        await context.onComplete?.({
          success: false,
          attempts: attempt,
          totalDurationMs,
          lastError: circuitError,
          circuitBreakerOpened: true,
        });
        throw circuitError;
      }

      attempt += 1;
      await context.onAttempt?.(attempt, previousDelay);

      try {
        const result = await fn();
        const total = context.clock.now() - start;
        await context.metrics.recordOutcome(envelope.domain, {
          success: true,
          attempts: attempt,
          totalDurationMs: total,
        });
        this.reset(envelope.domain);
        await context.onComplete?.({ success: true, attempts: attempt, totalDurationMs: total });
        return result;
      } catch (error: unknown) {
        totalDuration = context.clock.now() - start;

        const retryPlanDelay = this.calculateDelay(
          envelope,
          attempt,
          context.correlationId,
          totalDuration,
        );

        let retryPlan: RetryFailureContext["retryPlan"] = {
          policy: envelope.policy,
          attempt,
          maxAttempts: envelope.maxAttempts,
          initialDelayMs: retryPlanDelay.delayMs,
          multiplier: envelope.multiplier,
          jitter: retryPlanDelay.jitterMs,
          nextAttemptAt: new Date(context.clock.now() + retryPlanDelay.delayMs),
          circuitBreaker: cloneCircuit(this.breakers.get(envelope.domain)),
        };

        const failureContext: RetryFailureContext = {
          attempt,
          envelope,
          error,
          elapsedMs: totalDuration,
          delayMs: retryPlanDelay.delayMs,
          retryPlan,
          circuitBreaker: cloneCircuit(this.breakers.get(envelope.domain)),
        };

  const failureResult = await this.handleFailure(context, failureContext);
        if (failureResult.retryPlan) {
          retryPlan = failureResult.retryPlan;
        }
        lastError = failureResult.error;

        const plannedDelayMs = retryPlan?.initialDelayMs ?? retryPlanDelay.delayMs;

        await context.metrics.incrementAttempt(envelope.domain, context.severity ?? "error", {
          attempt,
          delayMs: plannedDelayMs,
          failureBudgetMs: envelope.failureBudgetMs,
          elapsedMs: totalDuration,
        });

        this.updateBreakerOnFailure(envelope.domain, breaker, attempt, envelope);

        const shouldRetry =
          failureResult.shouldRetry ??
          (attempt < envelope.maxAttempts &&
            totalDuration + plannedDelayMs <= envelope.failureBudgetMs);

        if (!shouldRetry) {
          await context.metrics.recordOutcome(envelope.domain, {
            success: false,
            attempts: attempt,
            totalDurationMs: totalDuration,
            lastError,
            circuitBreakerOpened: breaker.state === "open",
          });
          await context.onComplete?.({
            success: false,
            attempts: attempt,
            totalDurationMs: totalDuration,
            lastError,
            circuitBreakerOpened: breaker.state === "open",
          });
          throw lastError;
        }

        await context.onRetryScheduled?.(retryPlan!, lastError);
        previousDelay = plannedDelayMs;
        await context.clock.wait(previousDelay);
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error("Retry executor terminated without result");
  }

  private ensureBreaker(
    domain: VoicePilotFaultDomain,
    cooldownMs: number,
    maxAttempts: number,
  ): CircuitBreakerState {
    let breaker = this.breakers.get(domain);
    if (!breaker) {
      breaker = {
        state: "closed",
        failureCount: 0,
        threshold: Math.max(CIRCUIT_MIN_THRESHOLD, Math.ceil(maxAttempts / 2)),
        cooldownMs,
      };
      this.breakers.set(domain, breaker);
    } else {
      breaker.cooldownMs = cooldownMs;
      breaker.threshold = Math.max(CIRCUIT_MIN_THRESHOLD, Math.ceil(maxAttempts / 2));
    }
    return breaker;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private isCircuitOpen(state: CircuitBreakerState, now: number): boolean {
    if (state.state !== "open") {
      return false;
    }
    if (!state.openedAt) {
      return false;
    }
    if (now - state.openedAt.getTime() > state.cooldownMs) {
      state.state = "half-open";
      state.failureCount = 0;
      state.openedAt = undefined;
      return false;
    }
    return true;
  }

  private async resolveCircuitOpenError(
    context: RetryExecutionContext,
    breaker: CircuitBreakerState,
  ): Promise<VoicePilotError> {
    const error = await context.onCircuitOpen?.(cloneCircuit(breaker)!);
    if (error) {
      return error;
    }
    const fallback: VoicePilotError = {
      id: randomUUID(),
      faultDomain: context.envelope.domain,
      severity: context.severity ?? "error",
      userImpact: "degraded",
      code: "RETRY_CIRCUIT_OPEN",
      message: "Circuit breaker open",
      remediation: "Wait for the cool-down window before retrying.",
      timestamp: new Date(),
      metadata: {
        correlationId: context.correlationId,
        circuitBreaker: cloneCircuit(breaker),
      },
    };
    return fallback;
  }

  private calculateDelay(
    envelope: RetryExecutionContext["envelope"],
    attempt: number,
    correlationId: string,
    elapsedMs: number,
  ): { delayMs: number; jitterMs: number } {
    if (attempt >= envelope.maxAttempts) {
      return { delayMs: 0, jitterMs: 0 };
    }

    let baseDelay = 0;
    switch (envelope.policy) {
      case "none":
        baseDelay = 0;
        break;
      case "immediate":
        baseDelay = 0;
        break;
      case "linear":
        baseDelay = Math.min(
          envelope.initialDelayMs + (attempt - 1) * envelope.multiplier,
          envelope.maxDelayMs,
        );
        break;
      case "hybrid":
        if (attempt === 1) {
          baseDelay = 0;
        } else if (attempt === 2) {
          baseDelay = envelope.initialDelayMs;
        } else {
          baseDelay = Math.min(
            envelope.initialDelayMs * Math.pow(envelope.multiplier, attempt - 2),
            envelope.maxDelayMs,
          );
        }
        break;
      case "exponential":
      default:
        baseDelay = Math.min(
          envelope.initialDelayMs * Math.pow(envelope.multiplier, attempt - 1),
          envelope.maxDelayMs,
        );
        break;
    }

    const jitterScalar = jitterSeed(correlationId, attempt);
    let jitterMs = 0;
    switch (envelope.jitterStrategy) {
      case "deterministic-full":
        jitterMs = baseDelay * jitterScalar;
        break;
      case "deterministic-equal":
        jitterMs = baseDelay * 0.5 * (jitterScalar * 2 - 1);
        break;
      case "none":
      default:
        jitterMs = 0;
        break;
    }

    let delayMs = Math.max(0, baseDelay + jitterMs);
    if (envelope.policy === "none" || envelope.policy === "immediate") {
      delayMs = 0;
      jitterMs = 0;
    }

    if (elapsedMs + delayMs > envelope.failureBudgetMs) {
      delayMs = Math.max(0, envelope.failureBudgetMs - elapsedMs);
    }

    return { delayMs, jitterMs };
  }

  private async handleFailure(
    context: RetryExecutionContext,
    failureContext: RetryFailureContext,
  ): Promise<RetryFailureResult> {
    if (context.onFailure) {
      try {
        return await context.onFailure(failureContext);
      } catch (error: any) {
        this.logger.warn("Retry onFailure handler threw", {
          error: error?.message ?? error,
        });
      }
    }

    const fallbackError: VoicePilotError = {
      id: randomUUID(),
      faultDomain: context.envelope.domain,
      severity: context.severity ?? "error",
      userImpact: "degraded",
      code: "RETRY_OPERATION_FAILED",
      message: "Operation failed during retry execution",
      remediation: "Inspect logs for details and retry manually.",
      timestamp: new Date(),
      metadata: {
        correlationId: context.correlationId,
        attempt: failureContext.attempt,
        delayMs: failureContext.delayMs,
      },
    };

    return { error: fallbackError, shouldRetry: false };
  }

  private updateBreakerOnFailure(
    domain: VoicePilotFaultDomain,
    breaker: CircuitBreakerState,
    attempt: number,
    envelope: RetryExecutionContext["envelope"],
  ): void {
    breaker.lastAttemptAt = new Date();
    breaker.failureCount += 1;
    if (breaker.state === "half-open" && attempt === 1) {
      breaker.state = "open";
      breaker.openedAt = new Date();
      return;
    }
    if (breaker.failureCount >= breaker.threshold) {
      breaker.state = "open";
      breaker.openedAt = new Date();
      this.logger.warn("Retry circuit breaker opened", {
        domain,
        threshold: breaker.threshold,
        coolDownMs: breaker.cooldownMs,
      });
    }
    if (breaker.state === "closed" && envelope.policy === "none") {
      breaker.failureCount = breaker.threshold;
      breaker.state = "open";
      breaker.openedAt = new Date();
    }
  }
}

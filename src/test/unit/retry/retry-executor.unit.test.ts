import * as assert from "assert";
import { Logger } from "../../../core/logger";
import { RetryExecutorImpl } from "../../../core/retry/retry-executor";
import type {
    RetryClock,
    RetryExecutionContext,
    RetryMetricsSink,
    RetryOutcome,
} from "../../../core/retry/retry-types";
import { createVoicePilotError } from "../../../helpers/error/envelope";
import type {
    VoicePilotFaultDomain,
    VoicePilotSeverity,
} from "../../../types/error/error-taxonomy";
import type { CircuitBreakerState } from "../../../types/error/voice-pilot-error";
import type { RetryEnvelope } from "../../../types/retry";
import { afterEach, beforeEach, describe, it } from "../../mocha-globals";

class FakeClock implements RetryClock {
  nowMs = 0;
  readonly waits: number[] = [];

  now(): number {
    return this.nowMs;
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
    this.nowMs += ms;
  }

  advance(ms: number): void {
    this.nowMs += ms;
  }
}

class RecordingMetrics implements RetryMetricsSink {
  readonly attempts: Array<{
    domain: VoicePilotFaultDomain;
    severity: VoicePilotSeverity;
    metadata?: Record<string, unknown>;
  }> = [];
  readonly outcomes: Array<{
    domain: VoicePilotFaultDomain;
    outcome: RetryOutcome;
    metadata?: Record<string, unknown>;
  }> = [];

  async incrementAttempt(
    domain: VoicePilotFaultDomain,
    severity: VoicePilotSeverity,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.attempts.push({ domain, severity, metadata });
  }

  async recordOutcome(
    domain: VoicePilotFaultDomain,
    outcome: RetryOutcome,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.outcomes.push({ domain, outcome, metadata });
  }
}

const jitterSeed = (correlationId: string, attempt: number): number => {
  let hash = 0;
  const input = `${correlationId}:${attempt}`;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash / 0xffffffff;
};

const calculateExpectedDelay = (
  envelope: RetryEnvelope,
  attempt: number,
  correlationId: string,
  elapsedMs: number,
): number => {
  if (attempt >= envelope.maxAttempts) {
    return 0;
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

  let jitterMs = 0;
  switch (envelope.jitterStrategy) {
    case "deterministic-full":
      jitterMs = baseDelay * jitterSeed(correlationId, attempt);
      break;
    case "deterministic-equal":
      jitterMs = baseDelay * 0.5 * (jitterSeed(correlationId, attempt) * 2 - 1);
      break;
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

  return delayMs;
};

const createEnvelope = (
  overrides: Partial<RetryEnvelope> = {},
): RetryEnvelope => ({
  domain: overrides.domain ?? "auth",
  policy: overrides.policy ?? "exponential",
  initialDelayMs: overrides.initialDelayMs ?? 200,
  multiplier: overrides.multiplier ?? 2,
  maxDelayMs: overrides.maxDelayMs ?? 5_000,
  maxAttempts: overrides.maxAttempts ?? 4,
  jitterStrategy: overrides.jitterStrategy ?? "deterministic-full",
  coolDownMs: overrides.coolDownMs ?? 45_000,
  failureBudgetMs: overrides.failureBudgetMs ?? 120_000,
});

describe("RetryExecutorImpl", () => {
  let logger: Logger;
  let executor: RetryExecutorImpl;
  let clock: FakeClock;
  let metrics: RecordingMetrics;

  beforeEach(() => {
    logger = new Logger("RetryExecutorTest");
    logger.setLevel("debug");
    executor = new RetryExecutorImpl(logger);
    clock = new FakeClock();
    metrics = new RecordingMetrics();
  });

  afterEach(() => {
    executor.dispose();
    logger.dispose();
  });

  it("retries with deterministic jitter and succeeds", async () => {
  const envelope = createEnvelope({ domain: "transport", maxAttempts: 5 });
    const correlationId = "retry-correlation-001";
    const scheduledDelays: number[] = [];
    const outcomes: RetryOutcome[] = [];

    let invocation = 0;
    const context: RetryExecutionContext = {
      correlationId,
      operation: "transport.connect",
      envelope,
      clock,
      logger,
      metrics,
      severity: "error",
      onRetryScheduled: (plan) => {
        scheduledDelays.push(plan.initialDelayMs);
      },
      onFailure: async (failure) => {
        const error = createVoicePilotError({
          faultDomain: envelope.domain,
          code: "TEST_RETRY_FAILURE",
          message: "Injected retry failure",
          remediation: "retry",
          metadata: { attempt: failure.attempt },
        });
        return {
          error,
          shouldRetry: failure.attempt < envelope.maxAttempts,
          retryPlan: failure.retryPlan,
        };
      },
      onComplete: async (outcome) => {
        outcomes.push(outcome);
      },
    };

    const result = await executor.execute(async () => {
      invocation += 1;
      if (invocation < 3) {
        clock.advance(5);
        throw new Error("network glitch");
      }
      clock.advance(2);
      return "ok";
    }, context);

    assert.strictEqual(result, "ok");
    assert.strictEqual(invocation, 3);
    assert.strictEqual(scheduledDelays.length, 2, "expected retries to schedule two backoffs");

    let elapsed = 0;
    for (let attempt = 1; attempt <= scheduledDelays.length; attempt += 1) {
      const expected = calculateExpectedDelay(envelope, attempt, correlationId, elapsed);
      const actual = scheduledDelays[attempt - 1];
      elapsed += actual;
      assert.ok(
        Math.abs(actual - expected) < 1e-6,
        `deterministic jitter mismatch for attempt ${attempt}: expected ${expected}, got ${actual}`,
      );
    }

    assert.strictEqual(metrics.attempts.length, 2);
  assert.strictEqual(metrics.outcomes.length, 1);
  const lastOutcome = metrics.outcomes[0].outcome;
  assert.ok(lastOutcome.success, "final outcome should be recorded as success");
    assert.strictEqual(clock.waits.length, 2);
    assert.ok(outcomes.some((o) => o.success));
  });

  it("opens circuit after repeated failures and surfaces circuit error", async () => {
    const envelope = createEnvelope({
      domain: "auth",
      maxAttempts: 4,
      coolDownMs: 60_000,
      jitterStrategy: "none",
    });
    const correlationId = "retry-circuit-001";
    const circuitStates: CircuitBreakerState[] = [];

    const context: RetryExecutionContext = {
      correlationId,
      operation: "auth.token",
      envelope,
      clock,
      logger,
      metrics,
      severity: "error",
      onRetryScheduled: () => {},
      onFailure: async (failure) => {
        const error = createVoicePilotError({
          faultDomain: envelope.domain,
          code: "AUTH_RETRY_FAILED",
          message: "Auth failed",
          remediation: "retry",
          metadata: { attempt: failure.attempt },
        });
        return {
          error,
          shouldRetry: failure.attempt < envelope.maxAttempts,
          retryPlan: failure.retryPlan,
        };
      },
      onCircuitOpen: (state) => {
        circuitStates.push(state);
        return createVoicePilotError({
          faultDomain: envelope.domain,
          code: "AUTH_CIRCUIT_OPEN",
          message: "Circuit breaker open",
          remediation: "wait",
          metadata: { state },
        });
      },
    };

    await assert.rejects(
      executor.execute(async () => {
        clock.advance(1);
        throw new Error("auth failure");
      }, context),
      (error: any) => {
        assert.strictEqual(error.code, "AUTH_CIRCUIT_OPEN");
        return true;
      },
    );

  assert.strictEqual(circuitStates.length, 1, "circuit open callback should fire once");
    assert.strictEqual(circuitStates[0].state, "open");
  assert.strictEqual(metrics.attempts.length, 2);
  assert.strictEqual(metrics.outcomes.length, 1);
  const outcome = metrics.outcomes[0].outcome;
  assert.strictEqual(outcome.success, false);
  assert.ok(outcome.circuitBreakerOpened);
  assert.strictEqual(clock.waits.length, 2);
    const breaker = executor.getCircuitBreakerState(envelope.domain);
    assert.ok(breaker);
    assert.strictEqual(breaker?.state, "open");
  });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../../src/../core/logger");
const retry_executor_1 = require("../../src/../core/retry/retry-executor");
const envelope_1 = require("../../src/../helpers/error/envelope");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
class FakeClock {
    nowMs = 0;
    waits = [];
    now() {
        return this.nowMs;
    }
    async wait(ms) {
        this.waits.push(ms);
        this.nowMs += ms;
    }
    advance(ms) {
        this.nowMs += ms;
    }
}
class RecordingMetrics {
    attempts = [];
    outcomes = [];
    async incrementAttempt(domain, severity, metadata) {
        this.attempts.push({ domain, severity, metadata });
    }
    async recordOutcome(domain, outcome, metadata) {
        this.outcomes.push({ domain, outcome, metadata });
    }
}
const jitterSeed = (correlationId, attempt) => {
    let hash = 0;
    const input = `${correlationId}:${attempt}`;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
    }
    return hash / 0xffffffff;
};
const calculateExpectedDelay = (envelope, attempt, correlationId, elapsedMs) => {
    if (attempt >= envelope.maxAttempts) {
        return 0;
    }
    let baseDelay = 0;
    switch (envelope.policy) {
        case 'none':
            baseDelay = 0;
            break;
        case 'immediate':
            baseDelay = 0;
            break;
        case 'linear':
            baseDelay = Math.min(envelope.initialDelayMs + (attempt - 1) * envelope.multiplier, envelope.maxDelayMs);
            break;
        case 'hybrid':
            if (attempt === 1) {
                baseDelay = 0;
            }
            else if (attempt === 2) {
                baseDelay = envelope.initialDelayMs;
            }
            else {
                baseDelay = Math.min(envelope.initialDelayMs * Math.pow(envelope.multiplier, attempt - 2), envelope.maxDelayMs);
            }
            break;
        case 'exponential':
        default:
            baseDelay = Math.min(envelope.initialDelayMs * Math.pow(envelope.multiplier, attempt - 1), envelope.maxDelayMs);
            break;
    }
    let jitterMs = 0;
    switch (envelope.jitterStrategy) {
        case 'deterministic-full':
            jitterMs = baseDelay * jitterSeed(correlationId, attempt);
            break;
        case 'deterministic-equal':
            jitterMs = baseDelay * 0.5 * (jitterSeed(correlationId, attempt) * 2 - 1);
            break;
        default:
            jitterMs = 0;
            break;
    }
    let delayMs = Math.max(0, baseDelay + jitterMs);
    if (envelope.policy === 'none' || envelope.policy === 'immediate') {
        delayMs = 0;
        jitterMs = 0;
    }
    if (elapsedMs + delayMs > envelope.failureBudgetMs) {
        delayMs = Math.max(0, envelope.failureBudgetMs - elapsedMs);
    }
    return delayMs;
};
const createEnvelope = (overrides = {}) => ({
    domain: overrides.domain ?? 'auth',
    policy: overrides.policy ?? 'exponential',
    initialDelayMs: overrides.initialDelayMs ?? 200,
    multiplier: overrides.multiplier ?? 2,
    maxDelayMs: overrides.maxDelayMs ?? 5_000,
    maxAttempts: overrides.maxAttempts ?? 4,
    jitterStrategy: overrides.jitterStrategy ?? 'deterministic-full',
    coolDownMs: overrides.coolDownMs ?? 45_000,
    failureBudgetMs: overrides.failureBudgetMs ?? 120_000,
});
(0, mocha_globals_1.suite)('Unit: RetryExecutorImpl', () => {
    let logger;
    let executor;
    let clock;
    let metrics;
    (0, mocha_globals_1.beforeEach)(() => {
        logger = new logger_1.Logger('RetryExecutorTest');
        logger.setLevel('debug');
        executor = new retry_executor_1.RetryExecutorImpl(logger);
        clock = new FakeClock();
        metrics = new RecordingMetrics();
    });
    (0, mocha_globals_1.afterEach)(() => {
        executor.dispose();
        logger.dispose();
    });
    (0, mocha_globals_1.test)('retries with deterministic jitter and succeeds', async () => {
        const envelope = createEnvelope({ domain: 'transport', maxAttempts: 5 });
        const correlationId = 'retry-correlation-001';
        const scheduledDelays = [];
        const outcomes = [];
        let invocation = 0;
        const context = {
            correlationId,
            operation: 'transport.connect',
            envelope,
            clock,
            logger,
            metrics,
            severity: 'error',
            onRetryScheduled: (plan) => {
                scheduledDelays.push(plan.initialDelayMs);
            },
            onFailure: async (failure) => {
                const error = (0, envelope_1.createVoicePilotError)({
                    faultDomain: envelope.domain,
                    code: 'TEST_RETRY_FAILURE',
                    message: 'Injected retry failure',
                    remediation: 'retry',
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
                throw new Error('network glitch');
            }
            clock.advance(2);
            return 'ok';
        }, context);
        (0, chai_setup_1.expect)(result).to.equal('ok');
        (0, chai_setup_1.expect)(invocation).to.equal(3);
        (0, chai_setup_1.expect)(scheduledDelays.length, 'expected retries to schedule two backoffs').to.equal(2);
        let elapsed = 0;
        for (let attempt = 1; attempt <= scheduledDelays.length; attempt += 1) {
            const expected = calculateExpectedDelay(envelope, attempt, correlationId, elapsed);
            const actual = scheduledDelays[attempt - 1];
            elapsed += actual;
            (0, chai_setup_1.expect)(Math.abs(actual - expected), `deterministic jitter mismatch for attempt ${attempt}: expected ${expected}, got ${actual}`)
                .to.be.lessThan(1e-6);
        }
        (0, chai_setup_1.expect)(metrics.attempts).to.have.lengthOf(2);
        (0, chai_setup_1.expect)(metrics.outcomes).to.have.lengthOf(1);
        const lastOutcome = metrics.outcomes[0].outcome;
        (0, chai_setup_1.expect)(lastOutcome.success, 'final outcome should be recorded as success').to.equal(true);
        (0, chai_setup_1.expect)(clock.waits).to.have.lengthOf(2);
        (0, chai_setup_1.expect)(outcomes.some((o) => o.success)).to.equal(true);
    });
    (0, mocha_globals_1.test)('opens circuit after repeated failures and surfaces circuit error', async () => {
        const envelope = createEnvelope({
            domain: 'auth',
            maxAttempts: 4,
            coolDownMs: 60_000,
            jitterStrategy: 'none',
        });
        const correlationId = 'retry-circuit-001';
        const circuitStates = [];
        const context = {
            correlationId,
            operation: 'auth.token',
            envelope,
            clock,
            logger,
            metrics,
            severity: 'error',
            onRetryScheduled: () => { },
            onFailure: async (failure) => {
                const error = (0, envelope_1.createVoicePilotError)({
                    faultDomain: envelope.domain,
                    code: 'AUTH_RETRY_FAILED',
                    message: 'Auth failed',
                    remediation: 'retry',
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
                return (0, envelope_1.createVoicePilotError)({
                    faultDomain: envelope.domain,
                    code: 'AUTH_CIRCUIT_OPEN',
                    message: 'Circuit breaker open',
                    remediation: 'wait',
                    metadata: { state },
                });
            },
        };
        try {
            await executor.execute(async () => {
                clock.advance(1);
                throw new Error('auth failure');
            }, context);
            chai_setup_1.expect.fail('Expected circuit breaker error');
        }
        catch (error) {
            const circuitError = error;
            (0, chai_setup_1.expect)(circuitError.code).to.equal('AUTH_CIRCUIT_OPEN');
        }
        (0, chai_setup_1.expect)(circuitStates.length, 'circuit open callback should fire once').to.equal(1);
        (0, chai_setup_1.expect)(circuitStates[0].state).to.equal('open');
        (0, chai_setup_1.expect)(metrics.attempts).to.have.lengthOf(2);
        (0, chai_setup_1.expect)(metrics.outcomes).to.have.lengthOf(1);
        const outcome = metrics.outcomes[0].outcome;
        (0, chai_setup_1.expect)(outcome.success).to.equal(false);
        (0, chai_setup_1.expect)(outcome.circuitBreakerOpened).to.equal(true);
        (0, chai_setup_1.expect)(clock.waits).to.have.lengthOf(2);
        const breaker = executor.getCircuitBreakerState(envelope.domain);
        (0, chai_setup_1.expect)(breaker).to.exist;
        (0, chai_setup_1.expect)(breaker?.state).to.equal('open');
    });
});
//# sourceMappingURL=retry-executor.unit.test.js.map
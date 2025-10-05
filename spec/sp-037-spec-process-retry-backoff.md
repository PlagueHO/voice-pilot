---
title: Retry & Backoff Strategy Framework
version: 1.0
date_created: 2025-10-05
last_updated: 2025-10-05
owner: VoicePilot Reliability Engineering
tags: [process, reliability, retry, backoff, resilience]
---

<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the standardized retry and backoff strategy used by VoicePilot services when recovering from transient faults. It establishes uniform envelopes, jitter policies, instrumentation hooks, and integration touchpoints with the error handling framework so that automated remediation behaves predictably across authentication, transport, audio, and Copilot domains.

## 1. Purpose & Scope

The purpose of this specification is to prescribe how retries are planned, executed, observed, and escalated throughout the VoicePilot architecture. It applies to all host and webview services that perform recoverable operations, including Azure OpenAI interactions, session lifecycle management, WebRTC transport setup, audio pipelines, and Copilot adapters. The intended audience includes reliability engineers, service owners, and extension developers integrating with the `VoicePilotError` recovery contracts defined in SP-028. Assumptions:

- The error handling and recovery framework (SP-028) is available and initialized before retry execution.
- Services expose typed errors and integrate with the session state machine per SP-005 and SP-012.
- Configuration defaults are supplied by the configuration manager (SP-002) and may be overridden per workspace settings.

## 2. Definitions

- **Backoff Window**: Time interval between retry attempts determined by the active envelope.
- **Circuit Breaker**: A control that halts retries after repeated failures until a cool-down period elapses.
- **Deterministic Jitter**: A pseudo-random offset applied to backoff calculations using a seeded generator for reproducibility in tests.
- **Domain Envelope**: A retry template bound to a specific fault domain (auth, session, transport, audio, copilot, infrastructure).
- **Failure Budget**: Maximum cumulative retry time allowed before aborting and escalating.
- **Retry Envelope**: Structured parameters describing retry policy, attempts, and jitter behavior.
- **Retry Executor**: Component that schedules and executes retries in accordance with an envelope and recovery plan.
- **Suppression Window**: Interval preventing duplicate user notifications for the same fault (defined in SP-028).

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The framework SHALL provide predefined retry envelopes for each fault domain with default values covering attempts, delays, and backoff multipliers.
- **REQ-002**: The retry executor SHALL integrate with the `VoicePilotError.retryPlan` contract, updating attempt counts, next attempt timestamps, and circuit breaker state.
- **REQ-003**: Retry execution SHALL emit structured telemetry aligned with OBS-001/OBS-002 of SP-028, including correlation identifiers and duration metrics.
- **REQ-004**: Jitter SHALL be applied using deterministic seeding derived from the correlation identifier to prevent synchronized retries across services.
- **REQ-005**: Workspace configuration SHALL permit overriding domain envelopes while respecting minimum and maximum guardrails enforced by this specification.
- **REQ-006**: Retry decisions SHALL evaluate session state (SP-012) to avoid invalid transitions, aborting when the session is disposing or already degraded beyond recovery.
- **REQ-007**: The framework SHALL expose helper APIs (`withRetry`, `scheduleRetry`) to reduce duplicated retry logic in services.
- **REQ-008**: Circuit breaker state SHALL persist in-memory per domain for the lifetime of the activation and reset upon successful operation completion.
- **REQ-009**: The retry executor SHALL honour recovery plan suppression windows before re-notifying the user of the same underlying issue.
- **REQ-010**: The framework SHALL surface a retry completion callback enabling services to record success, failure, or fallback activation.
- **SEC-001**: Retry envelopes SHALL not log sensitive payloads; only sanitized metadata is permitted in telemetry or logs.
- **CON-001**: Maximum cumulative retry duration for any single operation MUST NOT exceed 120 seconds unless explicitly configured in workspace settings.
- **CON-002**: Backoff computations MUST complete within 2 milliseconds to stay within the activation time budget.
- **GUD-001**: Prefer exponential backoff with full jitter for network-bound domains and immediate retry with capped attempts for CPU-bound operations.
- **GUD-002**: Services SHOULD differentiate between transient and permanent errors before invoking the retry executor.
- **PAT-001**: Implement the Circuit Breaker pattern per PAT-002 of SP-028 with configurable cool-down periods.
- **PAT-002**: Use the Publish/Subscribe pattern for retry state changes so UI and telemetry listeners can subscribe without tight coupling.
- **PAT-003**: Encapsulate retry actions as commands to enable unit testing and integration with recovery plans.

## 4. Interfaces & Data Contracts

```typescript
export interface RetryEnvelope {
  domain: VoicePilotError['faultDomain'];
  policy: 'none' | 'immediate' | 'exponential' | 'linear' | 'hybrid';
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitterStrategy: 'none' | 'deterministic-full' | 'deterministic-equal';
  coolDownMs?: number; // for circuit breaker reset
  failureBudgetMs: number;
}

export interface RetryExecutionContext {
  correlationId: string;
  sessionId?: string;
  operation: string;
  envelope: RetryEnvelope;
  clock: { now(): number; wait(ms: number): Promise<void>; };
  logger: Logger;
  metrics: RetryMetricsSink;
  onAttempt?: (attempt: number, delayMs: number) => void;
  onComplete?: (outcome: RetryOutcome) => void;
}

export interface RetryOutcome {
  success: boolean;
  attempts: number;
  totalDurationMs: number;
  lastError?: VoicePilotError;
  fallbackMode?: RecoveryPlan['fallbackMode'];
  circuitBreakerOpened?: boolean;
}

export interface RetryExecutor extends ServiceInitializable {
  execute<T>(fn: () => Promise<T>, context: RetryExecutionContext): Promise<T>;
  getCircuitBreakerState(domain: VoicePilotError['faultDomain']): CircuitBreakerState | undefined;
  reset(domain: VoicePilotError['faultDomain']): void;
}

export interface RetryMetricsSink {
  incrementAttempt(domain: VoicePilotError['faultDomain'], severity: VoicePilotError['severity']): Promise<void>;
  recordOutcome(domain: VoicePilotError['faultDomain'], outcome: RetryOutcome): Promise<void>;
}

export interface RetryConfigurationProvider {
  getEnvelope(domain: VoicePilotError['faultDomain']): RetryEnvelope;
  getOverride(domain: VoicePilotError['faultDomain'], operation?: string): RetryEnvelope | undefined;
  validateEnvelope(envelope: RetryEnvelope): ValidationResult;
}
```

Integration points:

- `ErrorEventBus.publish` SHALL include updated `retryPlan` data for subscribers after each attempt.
- `SessionManager` SHALL expose hooks for retry state to block conflicting transitions.
- UI adapters SHALL consume published retry state to render progress bars or degraded-mode notifications.

## 5. Acceptance Criteria

- **AC-001**: Given a transient Azure authentication failure, When the retry executor runs under the auth envelope, Then it shall perform exponential backoff with deterministic jitter, update `retryPlan.attempt`, and stop after the configured maximum attempts while emitting telemetry for each attempt.
- **AC-002**: Given three consecutive WebRTC negotiation failures within the failure budget, When the circuit breaker opens, Then the framework shall mark the domain as `degraded`, trigger the associated fallback recovery plan, and suppress further retries until the cool-down elapses.
- **AC-003**: Given a configuration override that exceeds guardrails, When the configuration manager loads settings, Then the framework shall reject the override, log a warning, and revert to the default envelope without throwing an unhandled error.
- **AC-004**: Given a retry sequence that exceeds 120 seconds, When the failure budget is reached, Then the framework shall abort the operation, publish a `VoicePilotError` with updated remediation guidance, and transition to safe mode if defined by the recovery plan.
- **AC-005**: Given an operation that succeeds after retries, When the final attempt completes, Then the retry executor shall reset the circuit breaker state, record success metrics, and notify subscribers via the event bus within 50 milliseconds.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for envelope calculations, circuit breaker state, and jitter outcomes; integration tests for cross-service coordination (auth, transport, audio); extension-host tests to verify UI updates; chaos simulations for load scenarios.
- **Frameworks**: Mocha with Sinon for time control and spies; `@vscode/test-electron` for host integration; property-based testing for jitter determinism where feasible.
- **Test Data Management**: Use synthetic error fixtures with seeded correlation IDs; leverage fake timers to simulate elapsed time; store envelope configurations in in-memory fixtures.
- **CI/CD Integration**: Run unit tests on every commit via `npm run test:unit`; execute full integration suite during `npm run test:all`; publish retry metrics snapshots as artifacts for regression tracking.
- **Coverage Requirements**: ≥95% statement and branch coverage for retry utilities; 100% coverage for guardrail validation logic.
- **Performance Testing**: Benchmark delay computation and circuit breaker transitions under concurrent loads, ensuring latency budgets (<2 ms per computation) are maintained.

## 7. Rationale & Context

Uniform retry behavior prevents conflicting strategies that could overwhelm external services or produce inconsistent UX. Deterministic jitter aligns with the observability goals in SP-028 while keeping retries reproducible in automated tests. Circuit breakers and failure budgets protect users from indefinite retries and provide clear pathways for degrading gracefully without exhausting session resources.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Realtime API – Retries must respect Azure rate limits and backoff recommendations.
- **EXT-002**: GitHub Copilot APIs – Copilot-specific envelopes manage throttle responses and outage detection.

### Third-Party Services

- **SVC-001**: Azure Identity Token Provider – Provides token minting subject to backoff policies and throttling guidance.

### Infrastructure Dependencies

- **INF-001**: VS Code SecretStorage – Protects tokens referenced during retry attempts without exposing secrets in logs.
- **INF-002**: Extension activation task infrastructure – Ensures the retry framework is initialized before dependent services.

### Data Dependencies

- **DAT-001**: Session diagnostics snapshots – Supply latency, attempt counts, and network quality metrics for adaptive envelopes.
- **DAT-002**: Configuration baselines – Provide default envelopes and guardrails for overrides.

### Technology Platform Dependencies

- **PLT-001**: VS Code Extension Host (Node.js 22+) – Required runtime for timers, async scheduling, and telemetry dispatch.

### Compliance Dependencies

- **COM-001**: Privacy & Data Handling Policy (SP-027) – Ensures retry telemetry excludes sensitive identifiers beyond allowed metadata.

## 9. Examples & Edge Cases

```typescript
// Example: Retry with exponential backoff and deterministic jitter
const result = await retryExecutor.execute(async () => {
  const response = await webrtcTransport.establishConnection();
  return response;
}, {
  correlationId: correlation.create(),
  operation: 'webrtc.sdpNegotiation',
  envelope: retryConfig.getEnvelope('transport'),
  clock: fakeClock,
  logger,
  metrics,
  onAttempt: (attempt, delay) => logger.debug('Retry scheduled', { attempt, delay }),
  onComplete: (outcome) => sessionManager.notifyRetryOutcome(outcome),
});

if (!result) {
  await errorBus.publish(buildFailureError('transport', 'SDP_NEGOTIATION_FAILED'));
}

// Edge case: Circuit breaker prevents retries during cool-down
if (retryExecutor.getCircuitBreakerState('auth')?.isOpen) {
  await uiAdapter.showPanelBanner(buildCircuitBreakerBanner());
}
```

Edge cases:

1. Deterministic jitter producing zero delay – executor must still emit telemetry and respect suppression windows.
2. Override reducing `maxAttempts` to zero – executor skips retries and immediately escalates with appropriate remediation guidance.
3. Transport domain entering safe mode – retries cease, and fallback audio-only mode persists until manual reset.
4. Simultaneous retries across domains – per-domain circuit breakers ensure independent control without cross-domain interference.
5. Clock skew from fake timers – executor validates that monotonic clock prevents negative delay calculations.

## 10. Validation Criteria

- Default envelopes load successfully and pass guardrail validation at activation time.
- Unit tests confirm jitter calculations are repeatable given identical correlation IDs.
- Integration tests verify circuit breaker state transitions and UI notifications under failure scenarios.
- Telemetry inspection shows retry metrics tagged with domain, severity, and correlation identifiers without sensitive data.
- Manual chaos tests demonstrate failure budgets stop retries within the prescribed limits and engage fallback plans.

## 11. Related Specifications / Further Reading

- [SP-028 — Error Handling & Recovery Framework](./sp-028-spec-architecture-error-handling-recovery.md)
- [SP-005 — Session Management & Renewal](./sp-005-spec-design-session-management.md)
- [SP-012 — Conversation State Machine](./sp-012-spec-architecture-conversation-state-machine.md)
- [SP-002 — Configuration & Settings Management](./sp-002-spec-design-configuration-management.md)
- [Azure OpenAI Throttling Guidance](https://learn.microsoft.com/azure/ai-services/openai/how-to/quota-limits)

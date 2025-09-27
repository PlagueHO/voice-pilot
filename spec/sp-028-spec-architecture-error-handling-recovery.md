---
title: Error Handling & Recovery Framework
version: 1.0
date_created: 2025-09-27
last_updated: 2025-09-27
owner: VoicePilot Project
tags: [architecture, reliability, error-handling, recovery]
---

<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the unified error handling and recovery framework for VoicePilot. The framework delivers a consistent taxonomy, propagation model, and remediation workflow across the extension host, webview audio stack, Azure integrations, and user interface surfaces. It coordinates fault detection, structured logging, user feedback, and automated retries so real-time voice conversations stay resilient while protecting sensitive credentials and minimizing user friction.

## 1. Purpose & Scope

This specification covers the architectural requirements for fault detection, classification, mitigation, and communication throughout VoicePilot, including:

- Standardized error taxonomy spanning authentication (SP-004), session lifecycle (SP-005), WebRTC transport (SP-006), and audio capture (SP-007).
- Cross-component recovery orchestration with dependency-aware retry envelopes and escalation pathways.
- Observability contracts for structured logging, metrics, and telemetry enrichment powering diagnostics and status UX (UI.md, COMPONENTS.md).
- User-facing notifications across status bar, panel, and transcripts aligned with accessibility and privacy guidelines.
- Extensibility mechanisms for future integrations (Copilot adapters, planning services) without breaking existing consumers.

Intended audience: extension architects, reliability engineers, service owners, and QA teams responsible for resilience.

Assumptions:

- Dependent services satisfy their own specifications (SP-004, SP-005, SP-006, SP-007) and expose typed error objects.
- VS Code 1.104+ runtime with SecretStorage, Webview, and task infrastructure available.
- Azure OpenAI Realtime API endpoints reachable with authenticated sessions.
- GitHub Copilot Chat extension presence is detectable via context keys but optional for base voice resilience.

## 2. Definitions

- **Error Envelope**: Canonical structure describing fault metadata, severity, and remediation guidance exchanged between services.
- **Fault Domain**: Logical grouping of components (Auth, Session, Transport, Audio, UI, Copilot) used to scope mitigation strategies.
- **Recovery Plan**: Declarative sequence of automated actions (retry, reset, failover, degrade) attached to an error envelope.
- **Retry Envelope**: Parameterized backoff policy (initial delay, multiplier, jitter, cap) selected per fault domain.
- **Escalation Path**: Ordered set of user-visible notifications, logs, and telemetry dispatch applied when automated recovery fails.
- **Suppression Window**: Time-bound interval preventing duplicate user notifications for the same underlying issue.
- **Observability Sink**: Destination (structured log, metrics counter, trace span) receiving normalized error data.
- **User Impact Classification**: Label describing perceived effect (transparent, degraded, blocked) powering UI copy and urgency.
- **Credential Guard**: Enforcement rule that redacts sensitive tokens from error payloads before storage or UI display.
- **Safe Mode**: Minimal capability state entered after repeated failures, preserving core diagnostics while disabling non-critical features.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The framework SHALL define a shared error taxonomy covering severity, fault domain, and user impact across host and webview contexts.
- **REQ-002**: All VoicePilot services SHALL wrap thrown exceptions in the canonical error envelope before propagation.
- **REQ-003**: Error envelopes SHALL include remediation instructions localized for UI consumption.
- **REQ-004**: Recovery plans SHALL be idempotent and observable, exposing completion and failure states to the session manager.
- **REQ-005**: Automated retries SHALL respect per-domain envelopes (authentication, network, audio) with configurable caps from configuration manager.
- **REQ-006**: The framework SHALL emit structured logs compatible with existing logger patterns and append correlation identifiers shared with Azure requests.
- **REQ-007**: User notifications SHALL comply with VoicePilot accessibility guidance (UI.md) and avoid overwhelming users via suppression windows.
- **SEC-001**: Sensitive credentials, transcripts, or personal data SHALL be redacted prior to logging or UI display in accordance with SP-003 and SP-027.
- **SEC-002**: Error channels crossing host ↔ webview SHALL validate payload schemas to prevent injection or malformed message attacks (COMPONENTS.md).
- **RCV-001**: Recovery flows SHALL coordinate with session state machine (SP-012) to avoid conflicting transitions (e.g., ending while renewing).
- **RCV-002**: Recovery plans SHALL support graceful degradation paths (e.g., fallback to transcription-only mode when Copilot unavailable).
- **OBS-001**: All errors SHALL increment metrics by fault domain and severity, and expose trace context for post-mortem analysis.
- **OBS-002**: Telemetry payloads SHALL include anonymized device/environment metadata (OS, VS Code version, network class) when permitted.
- **CON-001**: Framework MUST initialize after Logger and before dependent services during activation cascade defined in SP-001.
- **CON-002**: Error handling MUST operate within activation five-second budget; long-running recovery tasks SHALL run asynchronously with progress reporting.
- **CON-003**: The framework SHALL persist in-memory state only; durable storage of errors is prohibited without explicit user consent (SP-027).
- **GUD-001**: Expose convenience helpers (`withRecovery`, `wrapError`) to reduce duplication and ensure consistent metadata population.
- **GUD-002**: Provide reusable VS Code UI adapters (status bar badges, notifications, panel annotations) for surfacing error states.
- **PAT-001**: Implement Publish/Subscribe pattern for error broadcast, allowing multiple listeners (UI, logging, telemetry) without tight coupling.
- **PAT-002**: Use Circuit Breaker pattern for repeated failures in external dependencies (Azure OpenAI, Copilot APIs) with configurable cool-down.
- **PAT-003**: Adopt Command pattern for recovery actions, enabling unit testing and retry instrumentation.

## 4. Interfaces & Data Contracts

```typescript
// Canonical error envelope exchanged across VoicePilot services
export interface VoicePilotError {
  id: string; // UUID for correlation
  faultDomain: 'auth' | 'session' | 'transport' | 'audio' | 'ui' | 'copilot' | 'infrastructure';
  severity: 'info' | 'warning' | 'error' | 'critical';
  userImpact: 'transparent' | 'degraded' | 'blocked';
  code: string; // e.g., AUTH_EPHEMERAL_REFRESH_FAILED
  message: string; // Sanitized summary safe for logs/UI
  remediation: string; // Plain-language steps for UI
  cause?: Error; // Original error, retained host-side only
  metadata?: Record<string, unknown>; // Non-sensitive structured context
  timestamp: Date;
  retryPlan?: RetryPlan;
  recoveryPlan?: RecoveryPlan;
  telemetryContext?: TelemetryContext;
}

export interface RetryPlan {
  policy: 'none' | 'immediate' | 'exponential' | 'custom';
  attempt: number;
  maxAttempts: number;
  initialDelayMs: number;
  multiplier?: number;
  jitter?: number;
  nextAttemptAt?: Date;
  circuitBreaker?: CircuitBreakerState;
}

export interface RecoveryPlan {
  steps: RecoveryStep[];
  fallbackMode?: 'safe-mode' | 'degraded-features' | 'manual-intervention';
  notifyUser: boolean;
  suppressionWindowMs?: number;
}

export interface RecoveryStep {
  id: string; // e.g., RESET_WEBRTC_CONN
  description: string;
  execute(): Promise<RecoveryOutcome>;
  compensatingAction?: () => Promise<void>;
}

export interface RecoveryOutcome {
  success: boolean;
  durationMs: number;
  error?: VoicePilotError;
}

export interface TelemetryContext {
  correlationId: string;
  sessionId?: string;
  requestId?: string;
  connectionId?: string;
  deviceInfo?: {
    platform: string;
    vscodeVersion: string;
    extensionVersion: string;
    networkType?: 'offline' | 'metered' | 'unmetered';
  };
}

// Publish/subscribe contract for error events
export interface ErrorEventBus extends ServiceInitializable {
  publish(error: VoicePilotError): Promise<void>;
  subscribe(handler: ErrorEventHandler, options?: SubscriptionOptions): vscode.Disposable;
}

export interface ErrorEventHandler {
  (error: VoicePilotError): Promise<void> | void;
}

export interface SubscriptionOptions {
  domains?: VoicePilotError['faultDomain'][];
  severities?: VoicePilotError['severity'][];
  once?: boolean;
}

// UI adapter contract aligning with UI.md patterns
export interface ErrorPresentationAdapter {
  showStatusBarBadge(error: VoicePilotError): Promise<void>;
  showPanelBanner(error: VoicePilotError): Promise<void>;
  appendTranscriptNotice(error: VoicePilotError): Promise<void>;
  clearSuppressedNotifications(domain: VoicePilotError['faultDomain']): Promise<void>;
}

// Integration points for dependent services
export interface RecoverableService {
  domain: VoicePilotError['faultDomain'];
  withRecovery<T>(operation: () => Promise<T>, context: RecoveryContext): Promise<T>;
  registerRecoveryActions(registrar: RecoveryRegistrar): void;
}

export interface RecoveryRegistrar {
  addStep(step: RecoveryStep): void;
  addFallback(mode: RecoveryPlan['fallbackMode'], handler: () => Promise<void>): void;
}

export interface RecoveryContext {
  correlationId: string;
  sessionId?: string;
  operation: string;
  onRetryScheduled?: (plan: RetryPlan) => void;
  onRecoveryComplete?: (outcome: RecoveryOutcome) => void;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a fault within the Ephemeral Key Service, When the service throws an error, Then the framework wraps it in `VoicePilotError` with domain `auth`, assigns remediation guidance, and publishes it to subscribers within 50ms.
- **AC-002**: Given three consecutive network failures for WebRTC negotiation, When recovery plans execute, Then the circuit breaker opens and the UI displays a degraded mode banner while metrics record the transition.
- **AC-003**: Given an audio device disconnection, When the audio pipeline triggers recovery, Then a retry plan attempts device reset twice before surfacing an interactive notification aligned with UI.md accessibility requirements.
- **AC-004**: Given a Copilot dependency outage, When fallback to transcription-only mode is required, Then session state transitions to `degraded` without dropping the active conversation and the user receives actionable guidance.
- **AC-005**: Given repeated critical faults in any domain within five minutes, When suppression windows expire, Then the framework escalates by opening a VS Code notification with support links and logs the incident with correlation metadata.
- **AC-006**: Given extension deactivation, When `dispose()` is invoked, Then the event bus unsubscribes all listeners, flushes pending notifications, and releases resources with no unhandled promise rejections.
- **AC-007**: Given observability export, When an error is published, Then structured logs contain redacted metadata and metrics counters increment per domain while respecting privacy constraints.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for error envelope utilities, integration tests spanning service recovery flows (auth/session/transport/audio), extension-host tests validating UI adapters, and contract tests for host↔webview message schemas.
- **Frameworks**: Mocha with Sinon for stubs/spies, `@vscode/test-electron` for extension host verification, Playwright-based webview harness for UI surfaces, and contract validation via `ajv` JSON schema tests.
- **Test Data Management**: Synthetic error scenarios seeded through dependency injection, deterministic timers for retry validation, mock Azure/OpenAI responses for negative cases, and anonymized device metadata fixtures.
- **CI/CD Integration**: GitHub Actions jobs running `npm run test:unit`, `npm test`, and `npm run lint` with failure triage artifacts (logs, screenshots). Nightly reliability sweeps execute extended recovery scenarios with injected packet loss.
- **Coverage Requirements**: ≥95% statement/function coverage across error handling utilities; 100% branch coverage for remediation routing and security redaction logic.
- **Performance Testing**: Measure error publication latency (<20ms target) and recovery execution budgets (<3s for automated steps) under simulated load.
- **Chaos & Fault Injection**: Scheduled chaos tests toggling network availability, credential expiration, and media device removal to validate resilience plans.

## 7. Rationale & Context

Consolidating error handling into a single architectural framework ensures VoicePilot meets reliability, security, and accessibility goals while supporting Azure real-time workloads:

1. **Alignment with Dependencies**: SP-004, SP-005, SP-006, and SP-007 each define specific failure scenarios; this spec harmonizes their outputs into a predictable pipeline for the conversation state machine (SP-012) and UI design system.
2. **User Trust**: Consistent messaging and remediation, guided by UI.md, prevent confusion during outages and reinforce transparency.
3. **Operational Insight**: Structured telemetry accelerates diagnosis, enabling proactive remediation and alerting.
4. **Privacy & Security**: Redaction policies satisfy SP-003 and SP-027, ensuring no sensitive material leaks into logs or notifications.
5. **Extensibility**: New features (intent processing, planning services) can plug into the same contract, reducing future maintenance cost.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Realtime API — Emits transport/authentication faults; recovery must coordinate with Azure service status and rate limits.
- **EXT-002**: GitHub Copilot Chat Extension — Optional participant; failures trigger degraded-mode fallbacks and user prompts.

### Third-Party Services

- **SVC-001**: Azure Identity Token Provider — Needed for keyless authentication retries; circuit breaker settings must respect throttling guidance (TECHNICAL-REFERENCE-INDEX.md).
- **SVC-002**: Azure Monitor / Application Insights (future) — Target sink for aggregated telemetry.

### Infrastructure Dependencies

- **INF-001**: VS Code SecretStorage — Required to guard against credential leakage during error serialization.
- **INF-002**: VS Code Tasks & Command palette — Used to trigger diagnostic commands when automated recovery fails.

### Data Dependencies

- **DAT-001**: Session diagnostics snapshots — Provide context (latency, retries) for telemetry exports.
- **DAT-002**: Configuration baselines — Determine retry envelopes, suppression windows, and escalation thresholds.

### Technology Platform Dependencies

- **PLT-001**: VS Code Extension Host APIs — Provide notification surfaces, logging, and disposables.
- **PLT-002**: Web Audio/WebRTC APIs — Source of transport/capture errors in the webview; message contracts must align with COMPONENTS.md.

### Compliance Dependencies

- **COM-001**: Privacy & data handling policy (SP-027) — Governs storage and disclosure of audio/transcript-related error data.
- **COM-002**: Accessibility standards (WCAG 2.1 AA) — Inform UI copy and notification mechanisms for error communication.

## 9. Examples & Edge Cases

```code
async function startRealtimeSession() {
  return errorFramework.withRecovery(async () => {
    const key = await ephemeralKeyService.requestEphemeralKey();
    await webrtcTransport.establishConnection(key);
    await sessionManager.transitionToActive();
  }, {
    correlationId: correlation.create(),
    operation: 'startRealtimeSession',
    sessionId: sessionManager.peekUpcomingSessionId(),
    onRetryScheduled: (plan) => logger.warn('Retry scheduled', plan),
    onRecoveryComplete: (outcome) => metrics.recordRecovery(outcome),
  });
}

errorEventBus.subscribe(async (error) => {
  await logger.error('VoicePilot error', redact(error));
  await metrics.increment(`voicepilot.errors.${error.faultDomain}.${error.severity}`);

  if (error.userImpact !== 'transparent') {
    await uiAdapter.showPanelBanner(error);
  }

  if (error.recoveryPlan?.fallbackMode === 'safe-mode') {
    await sessionManager.enterSafeMode(error);
  }
}, { severities: ['error', 'critical'] });
```

Edge cases handled:

- Ephemeral key minting fails due to throttling; exponential backoff with jitter prevents avalanche.
- Audio device removal mid-session; recovery swaps to default device and alerts user once per suppression window.
- Copilot extension absent; framework downgrades prompts to local hints without continuous nagging.
- WebRTC data channel recovers but audio remains muted; recovery plan detects partial success and schedules targeted audio reset.

## 10. Validation Criteria

- Error envelopes validated against JSON schema in automated tests and during runtime assertions (development mode only).
- Chaos test suite executes defined recovery plans for each fault domain at least weekly, with results stored in QA reports.
- Observability dashboards demonstrate per-domain error rates, retry success ratios, and mean time to recovery trending within agreed SLOs.
- Accessibility audits confirm that notifications include screen reader announcements and color contrast compliance.
- Security reviews verify redaction logic prevents exposure of tokens, transcripts, or personal identifiers.

## 11. Related Specifications / Further Reading

- [SP-004 — Ephemeral Key Service](./sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-005 — Session Management & Renewal](./sp-005-spec-design-session-management.md)
- [SP-006 — WebRTC Audio Transport Layer](./sp-006-spec-architecture-webrtc-audio.md)
- [SP-007 — Audio Capture Pipeline Architecture](./sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-012 — Conversation State Machine](./sp-012-spec-architecture-conversation-state-machine.md)
- [VoicePilot UI Design](../docs/design/UI.md)
- [VoicePilot Components Overview](../docs/design/COMPONENTS.md)
- [Azure OpenAI Realtime API Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-reference)

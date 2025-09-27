---
title: SessionManager - Technical Documentation
component_path: src/session/session-manager.ts
version: 1.0
date_created: 2025-09-27
last_updated: 2025-09-27
owner: VoicePilot Core Team
tags: [component, session-management, voicepilot, azure]
---

<!-- markdownlint-disable-next-line MD025 -->
# SessionManager Documentation

The `SessionManagerImpl` (exported as `SessionManager`) governs the full lifecycle of realtime VoicePilot conversations. It coordinates Azure OpenAI ephemeral credential exchange, timer-driven renewals, health monitoring, privacy purges, and recovery orchestration so the voice session remains resilient, policy-compliant, and observable inside the VS Code extension host.

## 1. Component Overview

### Purpose/Responsibility

- **OVR-001**: Maintain authoritative state for all VoicePilot voice sessions, including lifecycle transitions (starting → active → renewing → ending → disposed) and associated statistics.
- **OVR-002**: Scope includes credential acquisition/renewal, timer scheduling, event emission, recovery integration, and privacy cleanup. Audio capture, Copilot coordination, and UI rendering remain in adjacent services.
- **OVR-003**: Positioned within the extension host runtime. Collaborates with authentication, configuration, privacy, and recovery subsystems while notifying UI/presence components about session health and state.

### C4 Context Snapshot

- **Context**: A VS Code extension enabling realtime voice interaction. `SessionManagerImpl` sits between the extension controller and Azure OpenAI Realtime API.
- **Containers**: Runs in the VS Code extension host (Node.js). Depends on the Azure OpenAI Realtime service (for ephemeral keys) and VS Code command/context APIs.
- **Components**: Internally coordinates `SessionTimerManagerImpl`, `EphemeralKeyServiceImpl`, and optional `PrivacyController`/`RecoveryExecutor` to keep session state robust.
- **Code**: Implemented in TypeScript with async/await, leveraging maps for session registries, and observer-style event dispatchers.

## 2. Architecture Section

- **ARC-001**: Combines *stateful service* and *observer* patterns. Sessions are tracked in-memory, with observers registered via disposable handles. Resilience is handled through a *recovery orchestration* strategy that wraps critical operations (`withRecovery`).
- **ARC-002**: Internal dependencies:
  - `EphemeralKeyServiceImpl` — acquires/renews Azure realtime tokens.
  - `SessionTimerManagerImpl` — schedules renewals, inactivity timeouts, and heartbeat health checks.
  - `ConfigurationManager` — provides session policy defaults and initialization guard rails.
  - `Logger` — structured logging to aid diagnostics.
  - Optional: `PrivacyController` (data retention enforcement), `RecoveryExecutor` & `RecoveryPlan` (fault remediation), `RecoveryRegistrar` (registers force-termination/purge steps).
  External touchpoints include VS Code commands (`setContext`) and Azure OpenAI GPT Realtime endpoints accessed indirectly through the key service.
- **ARC-003**: Interaction summary: activation initializes `SessionManagerImpl`, wiring key service events (renewed/expired/auth errors) and timer callbacks. `startSession()` acquires credentials and schedules timers; `renewSession()` uses recovery policies; heartbeat/timeouts feed back into session state changes and error events consumed by presence indicators.
- **ARC-004**: Diagrammed below; sequence diagrams for renewals and recovery flows are available in `spec/sp-005-spec-design-session-management.md`.
- **ARC-005**: Mermaid visualization conveying structure, dependencies, and data flow.

### Component Structure and Dependencies Diagram

```mermaid
graph TD
    subgraph "Session Orchestration"
        SM[SessionManagerImpl]
        TM[SessionTimerManagerImpl]
        Hooks[ConversationLifecycleHooks]
    end

    subgraph "Cross-Cutting Services"
        KS[EphemeralKeyServiceImpl]
        CFG[ConfigurationManager]
        PC[PrivacyController]
        RE[RecoveryExecutor / RecoveryPlan]
        LOG[Logger]
    end

    subgraph "External Systems"
        AZ[Azure OpenAI GPT Realtime API]
        VS[vscode.commands & context]
    end

    SM --> TM
    SM --> KS
    SM --> CFG
    SM --> PC
    SM -.-> RE
    SM --> LOG
    SM --> VS
    KS --> AZ

    classDiagram
        class SessionManagerImpl {
            -initialized: boolean
            -sessions: Map<string, SessionInfo>
            -timerManager: SessionTimerManagerImpl
            -keyService: EphemeralKeyServiceImpl
            -configManager: ConfigurationManager
            -privacyController?: PrivacyController
            -recoveryExecutor?: RecoveryExecutor
            +initialize(): Promise<void>
            +dispose(): void
            +startSession(config?): Promise<SessionInfo>
            +endSession(sessionId?): Promise<void>
            +renewSession(sessionId): Promise<RenewalResult>
            +getSessionInfo(sessionId): SessionInfo | undefined
            +getSessionDiagnostics(sessionId): SessionDiagnostics
            +onSessionStarted(handler): vscode.Disposable
            +registerConversationHooks(hooks): vscode.Disposable
        }
        SessionManagerImpl --> SessionTimerManagerImpl
        SessionManagerImpl --> EphemeralKeyServiceImpl
        SessionManagerImpl --> ConfigurationManager
        SessionManagerImpl --> PrivacyController
        SessionManagerImpl ..> RecoveryExecutor
        SessionManagerImpl --> Logger
        SessionManagerImpl ..> ConversationLifecycleHooks
```

## 3. Interface Documentation

### Public API Surface

| Method/Property | Purpose | Parameters | Return Type | Usage Notes |
|-----------------|---------|------------|-------------|-------------|
| `initialize()` | Validates dependencies (key service, configuration), wires event handlers, and prepares timers. | — | `Promise<void>` | Idempotent. Must be awaited before calling session operations. |
| `dispose()` | Gracefully ends active sessions, clears timers, releases handlers, and triggers optional privacy purge. | — | `void` | Safe to call multiple times; used during extension deactivation. |
| `startSession(config?)` | Creates a new session, acquires ephemeral credentials, starts timers, and invokes `onSessionReady`. | `config?: SessionConfig` | `Promise<SessionInfo>` | Rejects if concurrent limit exceeded or key acquisition fails. |
| `endSession(sessionId?)` | Ends a specific or current session, stops timers, releases credentials, and purges privacy data. | `sessionId?: string` | `Promise<void>` | No-op if the session was already closed. |
| `renewSession(sessionId)` | Manually renews credentials for an active session with retry/recovery semantics. | `sessionId: string` | `Promise<RenewalResult>` | Emits renewal lifecycle events and conversation hooks. |
| `getSessionInfo(sessionId)` | Retrieves immutable snapshot for diagnostics/UI. | `sessionId: string` | `SessionInfo  undefined` | Returned object should be treated as read-only. |
| `getCurrentSession()` | Finds the most recently active session. | — | `SessionInfo  undefined` | Useful for UI presence indicators. |
| `getAllSessions()` | Lists every tracked session. | — | `SessionInfo[]` | Includes sessions in failed/ending states until purged. |
| `isSessionActive(sessionId?)` | Boolean guard for session-active flows. | `sessionId?: string` | `boolean` | Defaults to current session if none provided. |
| `updateSessionConfig(sessionId, config)` | Applies partial config updates and reschedules timers as needed. | `sessionId: string, config: Partial<SessionConfig>` | `Promise<void>` | Supports runtime adjustments to heartbeat/timeout cadence. |
| `getSessionConfig(sessionId)` | Exposes current config for the session. | `sessionId: string` | `SessionConfig  undefined` | Combine with `updateSessionConfig` for diffing. |
| `onSessionStarted/Ended` | Observer registration for session lifecycle events. | `handler: SessionEventHandler` | `vscode.Disposable` | Dispose to unsubscribe. |
| `onSessionRenewed` | Subscribes to renewal lifecycle notifications. | `handler: SessionRenewalHandler` | `vscode.Disposable` | Provides diagnostics snapshot alongside events. |
| `onSessionError` | Receives structured `SessionErrorEvent`s. | `handler: SessionErrorHandler` | `vscode.Disposable` | Errors cached in `lastErrors` for latest insight. |
| `onSessionStateChanged` | Listens for state transitions (starting/active/renewing/failing, etc.). | `handler: SessionStateHandler` | `vscode.Disposable` | Feeds presence indicator and UI badges. |
| `registerConversationHooks(hooks)` | Registers conversational lifecycle callbacks (`onSessionReady`, `onSessionEnding`, `onSessionSuspending`, `onSessionResumed`). | `hooks: ConversationLifecycleHooks` | `vscode.Disposable` | Only one hook set is active; disposing clears if still registered. |
| `setPrivacyController(controller)` | Enables privacy purge integration. | `controller: PrivacyController` | `void` | Optional but recommended in production builds. |
| `setRecoveryExecutor(executor, plan?)` | Installs recovery orchestration for session operations. | `executor: RecoveryExecutor, plan?: RecoveryPlan` | `void` | Allows per-operation retry policy centralization. |
| `registerRecoveryActions(registrar)` | Adds standard recovery steps (force termination, privacy purge, degraded mode). | `registrar: RecoveryRegistrar` | `void` | Called during extension startup when recovery orchestrator is present. |
| `getSessionDiagnostics(sessionId)` | Collates timers, credentials, connection status, and recent error for UI/telemetry. | `sessionId: string` | `SessionDiagnostics` | Throws if session not found. |
| `testSessionHealth(sessionId)` | Runs credential/timer/age checks and returns remediation suggestions. | `sessionId: string` | `Promise<SessionHealthResult>` | Used by heartbeat monitoring and support tooling. |
| `resetInactivityTimer(sessionId)` | Resets inactivity countdown and increments statistics counter. | `sessionId: string` | `Promise<void>` | Invoked on detected user interaction (audio activity). |

### Events & Hooks

- **Session Events**: `session-started`, `session-ended` (Observer pattern via disposable handlers).
- **Renewal Events**: `renewal-started`, `renewal-completed`, `renewal-failed` including `SessionDiagnostics` snapshots.
- **Error Events**: `authentication-error`, `connection-error`, `timeout-error`, `renewal-error` with structured remediation guidance.
- **State Events**: `state-changed` transitions with reasons for UI/telemetry ingestion.
- **Conversation Lifecycle Hooks**: `onSessionReady`, `onSessionEnding`, `onSessionSuspending`, `onSessionResumed` support cross-service orchestration (e.g., pausing audio capture, notifying Copilot).

## 4. Implementation Details

- **IMP-001**: Dependency validation ensures `EphemeralKeyServiceImpl` and `ConfigurationManager` are initialized before use. Optional collaborators (`PrivacyController`, `RecoveryExecutor`) can be injected later, enabling flexible bootstrapping and testing.
- **IMP-002**: Session lifecycle is timer-driven — `SessionTimerManagerImpl` schedules renewals (`renewalMarginSeconds` before expiration), inactivity timeouts, and heartbeat checks. Timers are paused/resumed during recovery operations, ensuring metrics stay consistent.
- **IMP-003**: Credential operations (`startSession`, `renewSession`, `handleRenewalRequired`) route through `executeSessionOperation`, which wraps the async action with recovery strategy metadata (fault domain, retry policy, severity). Failures trigger event emission, statistics updates, and optional recovery planning.
- **IMP-004**: `lastErrors` map keeps the most recent error per session, enabling diagnostics to reflect problem state until a success clears it. Heartbeat checks reuse `testSessionHealth` to avoid duplicating logic.
- **IMP-005**: Privacy integration (`purgePrivacyData`) issues targeted purge commands after session end or when policy updates occur. Failures are logged as warnings but do not interrupt session teardown.
- **IMP-006**: Recovery registration adds deterministic remediation steps (`SESSION_FORCE_TERMINATION`, `SESSION_PURGE_PRIVACY`) and a fallback degraded mode toggle via VS Code context, aligning with the recovery framework described in `spec/sp-028-spec-architecture-error-handling-recovery.md`.

## 5. Usage Examples

### Basic Usage

```typescript
import { SessionManagerImpl } from "../session/session-manager";
import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { SessionTimerManagerImpl } from "../session/session-timer-manager";
import { ConfigurationManager } from "../config/configuration-manager";
import { Logger } from "../core/logger";

const logger = new Logger("VoicePilotExtension");
const configurationManager = new ConfigurationManager(context, logger);
const keyService = new EphemeralKeyServiceImpl(credentialManager, configurationManager, logger);
const timerManager = new SessionTimerManagerImpl(
  logger,
  async (sessionId) => sessionManager.renewSession(sessionId),
  async (sessionId) => sessionManager.endSession(sessionId),
  async (sessionId) => sessionManager.testSessionHealth(sessionId),
);

const sessionManager = new SessionManagerImpl(keyService, timerManager, configurationManager, logger);

await keyService.initialize();
await configurationManager.initialize();
await sessionManager.initialize();

sessionManager.onSessionStateChanged(async (event) => {
  voicePresenceIndicator.update(event.sessionId, event.newState, event.diagnostics);
});

const session = await sessionManager.startSession();
// ... later
await sessionManager.endSession(session.sessionId);
```

### Advanced Usage

```typescript
import type { RecoveryExecutor } from "../types/error/voice-pilot-error";

sessionManager.setRecoveryExecutor(recoveryExecutor as RecoveryExecutor, defaultRecoveryPlan);
sessionManager.setPrivacyController(privacyController);

sessionManager.registerConversationHooks({
  async onSessionReady(session) {
    await audioPipeline.start(session.sessionId);
  },
  async onSessionSuspending(session, reason) {
    await audioPipeline.pause(reason);
    timerOverlay.show(`Renewing session (${reason})...`);
  },
  async onSessionResumed(session) {
    timerOverlay.hide();
    await audioPipeline.resume(session.sessionId);
  },
  async onSessionEnding(session) {
    await audioPipeline.stop(session.sessionId);
    transcriptView.flush();
  },
});

sessionManager.onSessionError(async (event) => {
  await errorPresenter.show(event.error.message, event.error.remediation);
});

const customConfig = {
  enableHeartbeat: true,
  heartbeatIntervalSeconds: 15,
  enableInactivityTimeout: true,
  inactivityTimeoutMinutes: 10,
  renewalMarginSeconds: 20,
  maxRetryAttempts: 5,
  retryBackoffMs: 1500,
};

const session = await sessionManager.startSession(customConfig);

// Trigger manual renewal with diagnostics
const renewalResult = await sessionManager.renewSession(session.sessionId);
if (!renewalResult.success) {
  telemetry.trackEvent("manualRenewalFailed", renewalResult.error);
}
```

- **USE-001**: Always initialize the configuration and key services before the session manager; otherwise `ensureInitialized()` will reject operations.
- **USE-002**: Dispose `vscode.Disposable` registrations (events, hooks) during extension teardown to prevent memory leaks.
- **USE-003**: Favor manual `renewSession()` when user-perceived responsiveness is critical (e.g., before long-form dictation) and monitor the returned latency to tune margins.

## 6. Quality Attributes

- **QUA-001 Security**: Ephemeral keys are fetched through `EphemeralKeyServiceImpl`; credentials are never stored long-term, and privacy purges can eliminate sensitive transcripts. Authentication errors propagate with structured remediation messaging.
- **QUA-002 Performance**: Timer scheduling avoids polling; renewal latency is tracked to maintain low downtime. Concurrent session checks prevent resource exhaustion (`getMaxConcurrentSessions()` default 3).
- **QUA-003 Reliability**: Recovery executor integration enables retry policies with exponential backoff and fallback degraded modes. Heartbeats and inactivity timers autonomously detect stalled or idle sessions.
- **QUA-004 Maintainability**: Observer registrations return disposables, `SessionConfig` uses typed fields, and statistics centralize state for debugging. Extensive test coverage exists (`src/test/session/session-manager*.test.ts`).
- **QUA-005 Extensibility**: Conversation hooks and recovery registration allow customization without modifying core logic. Optional dependencies can be injected post-construction for bespoke deployments.

## 7. Reference Information

### Dependencies & Versions

| Dependency | Version Source | Purpose |
|------------|----------------|---------|
| `vscode` API | VS Code 1.104+ runtime | Disposable lifecycle, command context updates. |
| `EphemeralKeyServiceImpl` | `src/auth/ephemeral-key-service.ts` | Azure OpenAI realtime authentication and key renewal. |
| `SessionTimerManagerImpl` | `src/session/session-timer-manager.ts` | Renewal, heartbeat, and inactivity scheduling. |
| `ConfigurationManager` | `src/config/configuration-manager.ts` | Provides validated settings for session policies. |
| `PrivacyController` (optional) | `src/services/privacy/privacy-controller.ts` | Purges cached transcripts & diagnostics per policy. |
| `RecoveryExecutor` (optional) | `src/types/error/voice-pilot-error.ts` | Coordinates retries, fallback plans, and telemetry. |

### Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `renewalMarginSeconds` | Seconds before credential expiry to trigger renewal. | `10` |
| `inactivityTimeoutMinutes` | Idle time before automatic session termination. | `5` |
| `heartbeatIntervalSeconds` | Interval for health probes. | `30` |
| `maxRetryAttempts` | Max retry attempts in recovery flows. | `3` |
| `retryBackoffMs` | Base backoff duration between retries. | `1000` |
| `enableHeartbeat` | Enables heartbeat monitoring timers. | `true` |
| `enableInactivityTimeout` | Enables inactivity timeout timer. | `true` |

### Testing Guidelines & Mock Setup

- Run `npm run test:unit` for lightweight validation (`src/test/session/session-manager.test.ts`).
- Comprehensive scenarios (`startSession`, renewals, recovery edges) reside in `src/test/session/session-manager-impl.test.ts` and `src/test/session/session-manager-integration.test.ts`.
- Provide mock implementations for `EphemeralKeyServiceImpl` methods (`requestEphemeralKey`, `renewKey`, `endSession`) and `SessionTimerManagerImpl` callbacks when testing isolated logic.
- Use fake timers to validate renewal/timeout scheduling deterministically.

### Troubleshooting

- **Initialization Error**: Ensure both key service and configuration manager have completed `initialize()` before invoking session operations.
- **Renewal Failure**: Inspect `SessionErrorEvent` metadata for provider error codes; retry manually or escalate via recovery executor.
- **Stale Timers**: If diagnostics show inactive timers, call `registerRecoveryActions` and execute `SESSION_FORCE_TERMINATION` to reset state.
- **Privacy Purge Failures**: Check log warnings and verify `PrivacyController` is initialized; purge can be retried manually via `sessionManager.registerRecoveryActions` steps.

### Related Documentation

- `spec/sp-005-spec-design-session-management.md` — Session management specification.
- `spec/sp-028-spec-architecture-error-handling-recovery.md` — Recovery orchestration blueprint.
- `docs/components/extension-controller-documentation.md` — Upstream orchestrator documentation.

### Change History

- **2025-09-27**: Initial documentation aligned with DOC-001..DOC-005 standards.

---
title: ExtensionController - Technical Documentation
component_path: src/core/extension-controller.ts
version: 1.0
date_created: 2025-09-27
owner: VoicePilot Core Team
tags: [component, controller, orchestration, vs-code-extension]
---

<!-- markdownlint-disable-next-line MD025 -->
# ExtensionController Documentation

The `ExtensionController` coordinates initialization, runtime orchestration, and disposal of VoicePilot's core services inside the VS Code extension host. It acts as the single entry point for lifecycle management, command wiring, recovery flows, and the conversational pipeline that bridges audio, Copilot chat, and the user interface.

## 1. Component Overview

### Purpose/Responsibility

- **OVR-001**: Manage the full lifecycle of authentication, configuration, privacy, session, and conversation services required by VoicePilot.
- **OVR-002**: Scope is limited to orchestrating service initialization/disposal, wiring runtime observers, and exposing lightweight getters. Direct business logic (audio processing, Copilot communication, etc.) remains within specialized services.
- **OVR-003**: Operates within the VS Code extension host, mediating between platform facilities (commands, context keys, UI surfaces) and VoicePilot services.

## 2. Architecture Section

- **ARC-001**: Implements a *facade/orchestrator* pattern over the ServiceInitializable graph, augmented by recovery and error-bus observer patterns. Uses dependency injection via constructor arguments and runtime hook registration.
- **ARC-002**: Internal dependencies include configuration (`ConfigurationManager`), authentication (`CredentialManagerImpl`, `EphemeralKeyServiceImpl`), session orchestration (`SessionManagerImpl`, `InterruptionEngineImpl`, `ConversationStateMachine`), UI (`VoiceControlPanel`, `StatusBar`, `ErrorPresenter`), and resilience services (`ErrorEventBusImpl`, `RecoveryOrchestrator`, `RecoveryRegistrationCenter`). External dependencies are VS Code APIs for commands, context, status bar, and Azure/GitHub services consumed by subordinate components.
- **ARC-003**: `ExtensionController.initialize()` executes a deterministic startup pipeline, registering recovery plans and event observers before exposing commands. Runtime events (state changes, turns, transcripts, Copilot responses) are funneled through the controller to update UI and downstream services.
- **ARC-004/ARC-005**: Visualised through the combined component and class diagrams below.

### Component Structure and Dependencies Diagram

```mermaid
graph TD
    subgraph "VoicePilot Extension Core"
        EC[ExtensionController]
        CM[ConfigurationManager]
        CR[CredentialManagerImpl]
        EK[EphemeralKeyServiceImpl]
        SM[SessionManagerImpl]
        IE[InterruptionEngineImpl]
        CS[ConversationStateMachine]
        CI[ChatIntegration]
        TA[TranscriptPrivacyAggregator]
        PC[PrivacyController]
        SB[StatusBar]
        EP[ErrorPresenter]
        RE[RecoveryOrchestrator]
        RB[ErrorEventBusImpl]
        RR[RecoveryRegistrationCenter]
        VC[VoiceControlPanel]
    end

    subgraph "VS Code Platform"
        VS[ExtensionContext]
        CMD[Command Registry]
        UI[Status Bar & Webviews]
    end

    EC --> CM
    EC --> CR
    EC --> EK
    EC --> SM
    EC --> IE
    EC --> CS
    EC --> CI
    EC --> TA
    EC --> PC
    EC --> SB
    EC --> EP
    EC --> RE
    EC --> RB
    EC --> RR
    EC --> VC
    EC --> VS
    EC --> CMD
    VC --> UI
    SB --> UI

    classDiagram
        class ExtensionController {
            -initialized: boolean
            -credentialManager: CredentialManagerImpl
            -ephemeralKeyService: EphemeralKeyServiceImpl
            -sessionTimerManager: SessionTimerManagerImpl
            -controllerDisposables: vscode.Disposable[]
            +initialize(): Promise<void>
            +dispose(): void
            +isInitialized(): boolean
            +getConfigurationManager(): ConfigurationManager
            +getCredentialManager(): CredentialManagerImpl
            +getSessionManager(): SessionManagerImpl
            +getEphemeralKeyService(): EphemeralKeyServiceImpl
            +getVoiceControlPanel(): VoiceControlPanel
            +getInterruptionEngine(): InterruptionEngineImpl
            +getPrivacyController(): PrivacyController
        }

        ExtensionController --> CredentialManagerImpl
        ExtensionController --> ConfigurationManager
        ExtensionController --> EphemeralKeyServiceImpl
        ExtensionController --> SessionManagerImpl
        ExtensionController --> InterruptionEngineImpl
        ExtensionController --> ConversationStateMachine
        ExtensionController --> ChatIntegration
        ExtensionController --> TranscriptPrivacyAggregator
        ExtensionController --> PrivacyController
        ExtensionController --> VoiceControlPanel
        ExtensionController --> StatusBar
        ExtensionController --> ErrorPresenter
        ExtensionController --> RecoveryOrchestrator
        ExtensionController --> ErrorEventBusImpl
        ExtensionController --> RecoveryRegistrationCenter
```

## 3. Interface Documentation

### Public API Surface

| Method/Property | Purpose | Parameters | Return Type | Usage Notes |
|-----------------|---------|------------|-------------|-------------|
| `initialize()` | Executes the ordered initialization pipeline, registers commands, observers, and UI surfaces. | — | `Promise<void>` | Must be awaited during extension activation; safe to call idempotently. |
| `dispose()` | Disposes all managed services and registered disposables in reverse order. | — | `void` | Invoke from extension `deactivate()` to release resources. |
| `isInitialized()` | Indicates whether the controller finished initialization successfully. | — | `boolean` | Useful for health checks or guard clauses. |
| `getConfigurationManager()` | Exposes the configuration manager bound to this controller. | — | `ConfigurationManager` | Read-only accessor for dependent services/tests. |
| `getCredentialManager()` | Provides access to stored credential manager instance. | — | `CredentialManagerImpl` | Intended for diagnostic tooling or advanced flows. |
| `getSessionManager()` | Returns the session manager orchestrating audio/Copilot sessions. | — | `SessionManagerImpl` | Consumers should honor session lifecycle contracts. |
| `getEphemeralKeyService()` | Supplies the Azure ephemeral key service used for realtime auth. | — | `EphemeralKeyServiceImpl` | Enables subsystems to trigger key regeneration or diagnostics. |
| `getVoiceControlPanel()` | Accessor for the sidebar panel provider. | — | `VoiceControlPanel` | Allows advanced integrations/tests to trigger UI updates. |
| `getInterruptionEngine()` | Returns the interruption engine handling speech barge-in policies. | — | `InterruptionEngineImpl` | Provides configurability hooks for derived scenarios. |
| `getPrivacyController()` | Exposes privacy orchestration (purges, transcript policies). | — | `PrivacyController` | Useful for compliance workflows and targeted cleanups. |

### Events & Callbacks

- Registers VS Code commands `voicepilot.startConversation`, `voicepilot.endConversation`, and `voicepilot.openSettings`.
- Subscribes to `ConfigurationManager.onConfigurationChanged`, `InterruptionEngine.onEvent`, and multiple `ConversationStateMachine` event streams (state, turn, transcript).
- Bridges `ChatIntegration` response events back into the `ConversationStateMachine`.

## 4. Implementation Details

- **IMP-001**: `initialize()` follows a deterministic order guarded by the `safeInit` helper. Each successful step is tracked for rollback if a subsequent initialization fails, ensuring partial startup leaves no residual state.
- **IMP-002**: Requires a `vscode.ExtensionContext`, pre-instantiated core services (configuration, session, UI, privacy, logger), and optionally an externally supplied `InterruptionEngineImpl` (facilitating test seams). Applies conversation policies derived from `ConversationConfig` immediately after the interruption engine initializes.
- **IMP-003**: Handles Copilot prompt dispatch by tracking completed user turns, deduplicating requests, and routing failures into the unified error handling system with recovery plans.
- **IMP-004**: Avoids expensive operations in activation by lazily wiring only command handlers and subscriptions. Privacy purge on startup is best-effort and non-blocking. Most asynchronous chains are serialized to keep failure attribution clear.

## 5. Usage Examples

### Basic Usage

```typescript
import * as vscode from "vscode";
import { ExtensionController } from "../core/extension-controller";

export async function activate(context: vscode.ExtensionContext) {
  const controller = new ExtensionController(
    context,
    configurationManager,
    sessionManager,
    voicePanel,
    privacyController,
    logger,
  );

  await controller.initialize();
}

export async function deactivate() {
  controller?.dispose();
}
```

### Advanced Usage

```typescript
const controller = new ExtensionController(
  context,
  configurationManager,
  sessionManager,
  voicePanel,
  privacyController,
  logger,
  customInterruptionEngine,
);

await controller.initialize();

// Example: trigger recovery diagnostics if auth errors spike
const authService = controller.getEphemeralKeyService();
const testResult = await authService.testAuthentication();
if (!testResult.success) {
  await authService.revokeCurrentKey();
}

// Example: adjust conversation policy after a configuration update
await vscode.workspace.getConfiguration("voicepilot.conversation")
  .update("policyProfile", "hands-free", vscode.ConfigurationTarget.Global);
```

- **USE-001**: Ensure `initialize()` is awaited during activation to avoid race conditions between commands and service setup.
- **USE-002**: Prefer retrieving dependencies through getters instead of constructing services directly to maintain orchestrated lifecycle control.
- **USE-003**: When extending, register additional observers through provided hooks (`sessionManager.registerConversationHooks`, `errorEventBus.subscribe`) rather than monkey-patching internal fields.

## 6. Quality Attributes

- **QUA-001 Security**: Delegates credential storage to `CredentialManagerImpl` and ephemeral Azure token handling to `EphemeralKeyServiceImpl`, enforcing purges via `PrivacyController` and SecretStorage usage downstream.
- **QUA-002 Performance**: Initialization sequence avoids redundant work via `safeInit`, and commands/UI registration happens lazily after services are ready. Conversation policy updates are debounced via configuration change listeners.
- **QUA-003 Reliability**: Recovery plans for authentication and session domains are registered on startup; errors propagate through `ErrorEventBusImpl` with user-facing notifications managed by `ErrorPresenter`.
- **QUA-004 Maintainability**: Follows ServiceInitializable abstractions, centralizing lifecycle management and encouraging modular services. Logging is structured via injected `Logger` for traceability.
- **QUA-005 Extensibility**: Constructor dependency injection and exposed getters support testability and custom overrides (e.g., specialized interruption engine or telemetry observers).

## 7. Reference Information

- **REF-001 Dependencies**:
  - `vscode` (extension API) for commands, disposables, context keys.
  - VoicePilot internal services: configuration, authentication, conversation, privacy, UI, recovery subsystems.
  - Azure OpenAI connectivity handled indirectly via `EphemeralKeyServiceImpl` and `ChatIntegration`.
- **REF-002 Configuration Options**: Relies on `ConversationConfig` (policy profile, barge-in allowances, timing budgets), `voicepilot` settings, and secret storage seeded by credential workflows.
- **REF-003 Testing Guidelines**: Unit tests should stub dependent services implementing `ServiceInitializable` and validate initialization order/recovery behavior. Integration tests should activate the extension host and verify command wiring and conversation state propagation.
- **REF-004 Troubleshooting**:
  - Initialization failures roll back automatically; check logs from `Logger` for the first failing service.
  - Authentication degradation triggers recovery plan fallback prompting settings review.
  - Conversation policy misconfiguration can be audited via `InterruptionEngine` diagnostics displayed in the voice panel.
- **REF-005 Related Documentation**: Consult `docs/design/TECHNICAL-REFERENCE-INDEX.md`, architecture specs (`spec/sp-001`, `sp-006`, `sp-012`), and session management design notes (`plan/feature-session-management-1.md`).
- **REF-006 Change History**: Track updates in `CHANGELOG.md` under entries referencing "Extension controller" or lifecycle orchestration. Add migration notes when altering initialization order or recovery workflows.

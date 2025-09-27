import * as vscode from "vscode";
import { CredentialManagerImpl } from "../auth/credential-manager";
import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import ConversationStateMachine, {
  StateChangeEvent as ConversationStateChangeEvent,
  TurnContext as ConversationTurnContext,
  TurnEvent as ConversationTurnEvent,
  CopilotResponseEvent,
} from "../conversation/conversation-state-machine";
import { TranscriptPrivacyAggregator } from "../conversation/transcript-privacy-aggregator";
import { ChatIntegration } from "../copilot/chat-integration";
import { createVoicePilotError } from "../helpers/error/envelope";
import { sanitizeForLog } from "../helpers/error/redaction";
import { ErrorEventBusImpl } from "../services/error/error-event-bus";
import { RecoveryOrchestrator } from "../services/error/recovery-orchestrator";
import { RecoveryRegistrationCenter } from "../services/error/recovery-registrar";
import { PrivacyController } from "../services/privacy/privacy-controller";
import { InterruptionEngineImpl } from "../session/interruption-engine";
import { SessionManagerImpl } from "../session/session-manager";
import { SessionTimerManagerImpl } from "../session/session-timer-manager";
import { ConversationConfig } from "../types/configuration";
import { InterruptionPolicyConfig } from "../types/conversation";
import type {
  RecoveryPlan,
  VoicePilotError,
} from "../types/error/voice-pilot-error";
import { ErrorPresenter } from "../ui/error-presentation-adapter";
import { StatusBar } from "../ui/status-bar";
import { VoiceControlPanel } from "../ui/voice-control-panel";
import { Logger } from "./logger";
import { ServiceInitializable } from "./service-initializable";

export class ExtensionController implements ServiceInitializable {
  private initialized = false;
  private credentialManager!: CredentialManagerImpl;
  private ephemeralKeyService!: EphemeralKeyServiceImpl;
  private sessionTimerManager!: SessionTimerManagerImpl;
  private readonly interruptionEngine: InterruptionEngineImpl;
  private readonly conversationMachine: ConversationStateMachine;
  private readonly chatIntegration: ChatIntegration;
  private readonly transcriptAggregator: TranscriptPrivacyAggregator;
  private readonly controllerDisposables: vscode.Disposable[] = [];
  private readonly dispatchedUserTurnIds = new Set<string>();
  private readonly errorEventBus: ErrorEventBusImpl;
  private readonly recoveryRegistry: RecoveryRegistrationCenter;
  private readonly recoveryOrchestrator: RecoveryOrchestrator;
  private readonly statusBar: StatusBar;
  private readonly errorPresenter: ErrorPresenter;
  private authRecoveryPlan?: RecoveryPlan;
  private sessionRecoveryPlan?: RecoveryPlan;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configurationManager: ConfigurationManager,
    private readonly sessionManager: SessionManagerImpl,
    private readonly voicePanel: VoiceControlPanel,
    private readonly privacyController: PrivacyController,
    private readonly logger: Logger,
    interruptionEngine?: InterruptionEngineImpl,
  ) {
    this.interruptionEngine =
      interruptionEngine ?? new InterruptionEngineImpl({ logger: this.logger });
    this.conversationMachine = new ConversationStateMachine({
      logger: this.logger,
    });
    this.chatIntegration = new ChatIntegration(this.logger);
    this.transcriptAggregator = new TranscriptPrivacyAggregator(
      this.voicePanel,
      this.privacyController,
      this.logger,
    );
    this.errorEventBus = new ErrorEventBusImpl(this.logger);
    this.recoveryRegistry = new RecoveryRegistrationCenter();
    this.recoveryOrchestrator = new RecoveryOrchestrator({
      eventBus: this.errorEventBus,
      logger: this.logger,
      registry: this.recoveryRegistry,
    });
    this.statusBar = new StatusBar();
    this.errorPresenter = new ErrorPresenter(this.voicePanel, this.statusBar);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initialized: Array<{ name: string; dispose: () => void }> = [];
    try {
      // Initialize credential manager first
      this.credentialManager = new CredentialManagerImpl(
        this.context,
        this.logger,
      );
      await this.safeInit(
        "credential manager",
        () => this.credentialManager.initialize(),
        () => this.credentialManager.dispose(),
        initialized,
        "credentialManager",
      );

      // Initialize configuration manager
      await this.safeInit(
        "configuration manager",
        () => this.configurationManager.initialize(),
        () => this.configurationManager.dispose(),
        initialized,
        "configurationManager",
      );

      await this.safeInit(
        "privacy controller",
        () => this.privacyController.initialize(),
        () => this.privacyController.dispose(),
        initialized,
        "privacyController",
      );

      await this.safeInit(
        "error event bus",
        () => this.errorEventBus.initialize(),
        () => this.errorEventBus.dispose(),
        initialized,
        "errorEventBus",
      );
      await this.safeInit(
        "recovery orchestrator",
        () => this.recoveryOrchestrator.initialize(),
        () => this.recoveryOrchestrator.dispose(),
        initialized,
        "recoveryOrchestrator",
      );

      try {
        await this.privacyController.issuePurge({
          type: "privacy.purge",
          target: "all",
          reason: "policy-update",
          issuedAt: new Date().toISOString(),
          correlationId: "startup",
        });
      } catch (error: any) {
        this.logger.warn("Startup privacy purge failed", {
          error: error?.message ?? error,
        });
      }

      // Initialize ephemeral key service with dependencies
      this.ephemeralKeyService = new EphemeralKeyServiceImpl(
        this.credentialManager,
        this.configurationManager,
        this.logger,
        this.recoveryOrchestrator,
      );
      await this.safeInit(
        "ephemeral key service",
        () => this.ephemeralKeyService.initialize(),
        () => this.ephemeralKeyService.dispose(),
        initialized,
        "ephemeralKeyService",
      );

      this.registerRecoveryPlans();
      this.registerErrorObservers();

      if (!this.sessionManager.isInitialized()) {
        // Inject dependencies into session manager
        (this.sessionManager as any).keyService = this.ephemeralKeyService;
        (this.sessionManager as any).configManager = this.configurationManager;
        (this.sessionManager as any).logger = this.logger;
        if ((this.sessionManager as any).setRecoveryExecutor) {
          (this.sessionManager as any).setRecoveryExecutor(
            this.recoveryOrchestrator,
            this.sessionRecoveryPlan,
          );
        }
      }
      await this.safeInit(
        "session manager",
        () => this.sessionManager.initialize(),
        () => this.sessionManager.dispose(),
        initialized,
        "sessionManager",
      );

      await this.safeInit(
        "conversation state machine",
        () => this.conversationMachine.initialize(),
        () => this.conversationMachine.dispose(),
        initialized,
        "conversationStateMachine",
      );

      await this.safeInit(
        "interruption engine",
        async () => {
          await this.interruptionEngine.initialize();
          await this.applyConversationPolicy();
          this.registerConversationObservers();
        },
        () => this.interruptionEngine.dispose(),
        initialized,
        "interruptionEngine",
      );

      this.registerConversationIntegration();

      await this.safeInit(
        "voice control panel",
        () => this.voicePanel.initialize(),
        () => this.voicePanel.dispose(),
        initialized,
        "voicePanel",
      );

      this.registerCommands();
      this.initialized = true;
    } catch (err: any) {
      this.logger.error(`Initialization failed: ${err?.message || err}`);
      this.disposeControllerDisposables();
      for (const svc of initialized.reverse()) {
        try {
          svc.dispose();
        } catch (e: any) {
          this.logger.error(`Error disposing ${svc.name}: ${e?.message || e}`);
        }
      }
      throw err;
    }
  }

  private async safeInit(
    label: string,
    initFn: () => Promise<void>,
    disposeFn: () => void,
    list: Array<{ name: string; dispose: () => void }>,
    name: string,
  ) {
    this.logger.info(`Initializing ${label}`);
    await initFn();
    list.push({ name, dispose: disposeFn });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    const steps: Array<[string, () => void]> = [
      ["controller observers", () => this.disposeControllerDisposables()],
      ["conversation state machine", () => this.conversationMachine.dispose()],
      ["chat integration", () => this.chatIntegration.dispose()],
      ["transcript aggregator", () => this.transcriptAggregator.dispose()],
      ["privacy controller", () => this.privacyController.dispose()],
      ["voice panel", () => this.voicePanel.dispose()],
      ["session manager", () => this.sessionManager.dispose()],
      ["interruption engine", () => this.interruptionEngine.dispose()],
      ["ephemeral key service", () => this.ephemeralKeyService?.dispose()],
      ["credential manager", () => this.credentialManager?.dispose()],
      ["configuration manager", () => this.configurationManager.dispose()],
    ];
    for (const [name, fn] of steps) {
      this.logger.info(`Disposing ${name}`);
      try {
        fn();
      } catch (err: any) {
        this.logger.error(`Error disposing ${name}: ${err?.message || err}`);
      }
    }
  }

  private registerCommands(): void {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      vscode.commands.registerCommand(
        "voicepilot.startConversation",
        async () => {
          try {
            await this.sessionManager.startSession();
            await this.voicePanel.show();
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Failed to start conversation: ${err.message}`,
            );
          }
        },
      ),
    );

    disposables.push(
      vscode.commands.registerCommand(
        "voicepilot.endConversation",
        async () => {
          try {
            await this.sessionManager.endSession();
          } catch (err: any) {
            vscode.window.showErrorMessage(
              `Failed to end conversation: ${err.message}`,
            );
          }
        },
      ),
    );

    disposables.push(
      vscode.commands.registerCommand("voicepilot.openSettings", () => {
        vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:voicepilot",
        );
      }),
    );

    this.safeContextPush(...disposables);
    this.controllerDisposables.push(...disposables);
  }

  getConfigurationManager(): ConfigurationManager {
    return this.configurationManager;
  }
  getCredentialManager(): CredentialManagerImpl {
    return this.credentialManager;
  }
  getSessionManager(): SessionManagerImpl {
    return this.sessionManager;
  }
  getEphemeralKeyService(): EphemeralKeyServiceImpl {
    return this.ephemeralKeyService;
  }
  getVoiceControlPanel(): VoiceControlPanel {
    return this.voicePanel;
  }
  getInterruptionEngine(): InterruptionEngineImpl {
    return this.interruptionEngine;
  }
  getPrivacyController(): PrivacyController {
    return this.privacyController;
  }

  private registerRecoveryPlans(): void {
    this.recoveryRegistry.clearAll();

    this.recoveryRegistry.register(
      "auth",
      (registrar) => {
        registrar.addStep({
          id: "AUTH_REVOKE_EPHEMERAL_KEY",
          description:
            "Revoke the cached ephemeral key to force a fresh authentication flow.",
          execute: async () => {
            const started = Date.now();
            try {
              await this.ephemeralKeyService.revokeCurrentKey();
              return { success: true, durationMs: Date.now() - started };
            } catch (error: any) {
              return {
                success: false,
                durationMs: Date.now() - started,
                error: createVoicePilotError({
                  faultDomain: "auth",
                  code: "AUTH_REVOKE_KEY_FAILED",
                  message:
                    error?.message ??
                    "Failed to revoke Azure ephemeral session key",
                  remediation:
                    "Retry authentication and confirm Azure OpenAI availability.",
                  metadata: { error: error?.message ?? String(error) },
                }),
              };
            }
          },
        });

        registrar.addStep({
          id: "AUTH_SELF_TEST",
          description:
            "Run Azure authentication self-test to verify credentials and connectivity.",
          execute: async () => {
            const started = Date.now();
            try {
              const result =
                await this.ephemeralKeyService.testAuthentication();
              if (!result.success) {
                throw new Error(
                  result.error ?? "Authentication self-test failed",
                );
              }
              return { success: true, durationMs: Date.now() - started };
            } catch (error: any) {
              return {
                success: false,
                durationMs: Date.now() - started,
                error: createVoicePilotError({
                  faultDomain: "auth",
                  code: "AUTH_SELF_TEST_FAILED",
                  message: error?.message ?? "Authentication self-test failed",
                  remediation:
                    "Verify Azure credentials, network access, and retry.",
                  metadata: { error: error?.message ?? String(error) },
                }),
              };
            }
          },
        });

        registrar.addFallback("manual-intervention", async () => {
          const selection = await vscode.window.showErrorMessage(
            "VoicePilot authentication is in a degraded state. Review Azure credentials?",
            "Open Settings",
            "Dismiss",
          );
          if (selection === "Open Settings") {
            await vscode.commands.executeCommand("voicepilot.openSettings");
          }
        });

        registrar.setNotification({
          notifyUser: true,
          suppressionWindowMs: 120_000,
        });
      },
      { fallbackMode: "manual-intervention" },
    );

    this.authRecoveryPlan = this.recoveryRegistry.get("auth");
    this.ephemeralKeyService.setRecoveryExecutor(
      this.recoveryOrchestrator,
      this.authRecoveryPlan,
    );

    this.recoveryRegistry.register(
      "session",
      (registrar) => {
        this.sessionManager.registerRecoveryActions(registrar);
      },
      { fallbackMode: "degraded-features" },
    );

    this.sessionRecoveryPlan = this.recoveryRegistry.get("session");
    this.sessionManager.setRecoveryExecutor(
      this.recoveryOrchestrator,
      this.sessionRecoveryPlan,
    );
  }

  private registerErrorObservers(): void {
    const subscription = this.errorEventBus.subscribe(
      async (error: VoicePilotError) => {
        const sanitized = sanitizeForLog(error);
        switch (error.severity) {
          case "critical":
          case "error":
            this.logger.error("VoicePilot error", sanitized);
            break;
          case "warning":
            this.logger.warn("VoicePilot warning", sanitized);
            break;
          default:
            this.logger.info("VoicePilot event", sanitized);
            break;
        }

        const metadata = error.metadata as
          | { notificationSuppressed?: boolean }
          | undefined;
        if (metadata?.notificationSuppressed) {
          return;
        }

        if (error.severity === "info") {
          await this.errorPresenter.clearSuppressedNotifications(
            error.faultDomain,
          );
          return;
        }

        if (error.recoveryPlan?.notifyUser === false) {
          return;
        }

        await this.errorPresenter.showStatusBarBadge(error);

        if (error.severity === "critical" || error.userImpact === "blocked") {
          await this.errorPresenter.showPanelBanner(error);
        }

        await this.errorPresenter.appendTranscriptNotice(error);
      },
    );

    this.controllerDisposables.push(subscription);
  }

  private registerConversationIntegration(): void {
    const hooksDisposable = this.sessionManager.registerConversationHooks({
      onSessionReady: async (session) => {
        await this.conversationMachine.attachSession(session);
        await this.conversationMachine.startConversation({
          sessionId: session.sessionId,
        });
      },
      onSessionEnding: async () => {
        await this.conversationMachine.endConversation("session-ended");
      },
      onSessionSuspending: async (_session, reason) => {
        this.conversationMachine.suspend(reason);
      },
      onSessionResumed: async () => {
        this.conversationMachine.resume();
      },
    });
    this.controllerDisposables.push(hooksDisposable);

    const stateSubscription = this.conversationMachine.onStateChanged(
      (event) => {
        void this.handleConversationStateChange(event);
      },
    );
    const stateDisposable: vscode.Disposable = {
      dispose: () => stateSubscription.dispose(),
    };
    this.controllerDisposables.push(stateDisposable);

    const turnSubscription = this.conversationMachine.onTurnEvent((event) => {
      void this.handleConversationTurnEvent(event);
    });
    const turnDisposable: vscode.Disposable = {
      dispose: () => turnSubscription.dispose(),
    };
    this.controllerDisposables.push(turnDisposable);

    const transcriptSubscription = this.conversationMachine.onTranscriptEvent(
      (event) => {
        this.transcriptAggregator.handle(event);
      },
    );
    const transcriptDisposable: vscode.Disposable = {
      dispose: () => transcriptSubscription.dispose(),
    };
    this.controllerDisposables.push(transcriptDisposable);

    const copilotSubscription = this.chatIntegration.onResponse((event) => {
      void this.handleCopilotResponse(event);
    });
    this.controllerDisposables.push(copilotSubscription);

    this.interruptionEngine.updateHooks({
      requestAssistantResponse: async () => {
        await this.requestAssistantResponse();
      },
      cancelAssistantPlayback: async (context) => {
        await this.handleAssistantPlaybackCancellation(context);
      },
      onFallbackChanged: (active, reason) => {
        this.handleFallbackChanged(active, reason);
      },
    });

    void vscode.commands
      .executeCommand(
        "setContext",
        "voicepilot.conversationState",
        this.conversationMachine.getState().state,
      )
      .then(undefined, (error: unknown) => {
        const message = error instanceof Error ? error.message : error;
        this.logger.warn("Failed to set initial conversation state context", {
          error: message,
        });
      });
  }

  private async applyConversationPolicy(): Promise<void> {
    try {
      const conversationConfig =
        this.configurationManager.getConversationConfig();
      const policy = this.derivePolicyFromConfig(conversationConfig);
      await this.interruptionEngine.configure(policy);
    } catch (error: any) {
      this.logger.error("Failed to apply conversation policy", {
        error: error?.message ?? error,
      });
    }
  }

  private derivePolicyFromConfig(
    config: ConversationConfig,
  ): InterruptionPolicyConfig {
    const base = {
      profile: config.policyProfile,
      allowBargeIn: config.allowBargeIn,
      interruptionBudgetMs: config.interruptionBudgetMs,
      completionGraceMs: config.completionGraceMs,
      speechStopDebounceMs: config.speechStopDebounceMs,
      fallbackMode: config.fallbackMode,
    } as const;

    const policy: InterruptionPolicyConfig = { ...base };
    switch (config.policyProfile) {
      case "assertive":
        policy.interruptionBudgetMs = Math.min(
          policy.interruptionBudgetMs,
          220,
        );
        policy.completionGraceMs = Math.min(policy.completionGraceMs, 120);
        break;
      case "hands-free":
        policy.allowBargeIn = false;
        policy.completionGraceMs = Math.max(policy.completionGraceMs, 400);
        break;
      default:
        break;
    }
    return policy;
  }

  private registerConversationObservers(): void {
    const configDisposable = this.configurationManager.onConfigurationChanged(
      async (change) => {
        if (change.section === "conversation") {
          await this.applyConversationPolicy();
        }
      },
    );
    const eventDisposable = this.interruptionEngine.onEvent(async (event) => {
      this.conversationMachine.ingestInterruptionEvent(event);
      try {
        await vscode.commands.executeCommand(
          "setContext",
          "voicepilot.interruptionState",
          event.state,
        );
      } catch (error: any) {
        this.logger.warn("Failed to update conversation state context", {
          error: error?.message ?? error,
        });
      }
      this.voicePanel.updateDiagnostics(event.diagnostics);
    });

    this.safeContextPush(configDisposable, eventDisposable);
    this.controllerDisposables.push(configDisposable, eventDisposable);

    void vscode.commands
      .executeCommand(
        "setContext",
        "voicepilot.interruptionState",
        this.interruptionEngine.getConversationState(),
      )
      .then(undefined, (error: unknown) => {
        const message = error instanceof Error ? error.message : error;
        this.logger.warn("Failed to set initial conversation state", {
          error: message,
        });
      });
  }

  private disposeControllerDisposables(): void {
    while (this.controllerDisposables.length) {
      const disposable = this.controllerDisposables.pop();
      try {
        disposable?.dispose();
      } catch (error: any) {
        this.logger.warn("Failed to dispose controller disposable", {
          error: error?.message ?? error,
        });
      }
    }
  }

  private safeContextPush(...disposables: vscode.Disposable[]): void {
    try {
      this.context.subscriptions.push(...disposables);
    } catch (error: any) {
      this.logger.warn(
        "Context subscriptions already disposed; skipping registration",
        {
          error: error?.message ?? error,
        },
      );
    }
  }

  private async handleConversationStateChange(
    event: ConversationStateChangeEvent,
  ): Promise<void> {
    const label = this.mapStateToLabel(event.transition.to);
    const mode = this.mapModeLabel(event.transition.to, event.turnContext);
    const detail = this.mapStateDetail(event);
    const fallback = Boolean(event.metadata.circuitOpen);

    this.voicePanel.updateTurnStatus(label, {
      mode,
      fallback,
      detail,
    });

    if (event.transition.to === "idle") {
      this.dispatchedUserTurnIds.clear();
    }

    try {
      await vscode.commands.executeCommand(
        "setContext",
        "voicepilot.conversationState",
        event.transition.to,
      );
    } catch (error: any) {
      this.logger.warn("Failed to update conversation state context", {
        error: error?.message ?? error,
      });
    }
  }

  private async handleConversationTurnEvent(
    event: ConversationTurnEvent,
  ): Promise<void> {
    if (!event.turnContext) {
      return;
    }
    if (
      event.type === "turn-completed" &&
      event.turnContext.turnRole === "user"
    ) {
      this.lastCompletedUserTurn = event.turnContext;
      await this.dispatchPromptFromTurn(event.turnContext);
    }
    if (
      event.type === "turn-interrupted" &&
      event.turnContext.turnRole === "assistant"
    ) {
      this.dispatchedUserTurnIds.delete(event.turnContext.turnId);
    }
  }

  private async dispatchPromptFromTurn(
    turn: ConversationTurnContext,
  ): Promise<void> {
    if (this.dispatchedUserTurnIds.has(turn.turnId)) {
      return;
    }
    const transcript = turn.transcript?.trim();
    if (!transcript) {
      return;
    }

    this.dispatchedUserTurnIds.add(turn.turnId);
    const sessionId =
      this.sessionManager.getCurrentSession()?.sessionId ??
      turn.metadata.sessionId?.toString();

    try {
      await this.chatIntegration.sendPrompt(transcript, {
        conversationId: sessionId,
        turnId: turn.turnId,
        metadata: turn.metadata,
      });
      this.logger.debug("Copilot prompt dispatched", {
        turnId: turn.turnId,
        transcriptLength: transcript.length,
      });
    } catch (error: any) {
      this.dispatchedUserTurnIds.delete(turn.turnId);
      const message = error?.message ?? error;
      this.logger.error("Failed to dispatch Copilot prompt", {
        turnId: turn.turnId,
        error: message,
      });
      await this.handleCopilotResponse({
        requestId: `failure-${turn.turnId}`,
        status: "failed",
        timestamp: new Date().toISOString(),
        error: {
          message:
            typeof message === "string" ? message : "Prompt dispatch failed",
          retryable: true,
        },
        context: { turnId: turn.turnId },
      });
    }
  }

  private async handleCopilotResponse(
    event: CopilotResponseEvent,
  ): Promise<void> {
    try {
      await this.conversationMachine.notifyCopilot(event);
    } catch (error: any) {
      this.logger.error(
        "Conversation machine failed to process Copilot response",
        {
          requestId: event.requestId,
          error: error?.message ?? error,
        },
      );
    }
  }

  private async requestAssistantResponse(): Promise<void> {
    if (this.lastCompletedUserTurn) {
      await this.dispatchPromptFromTurn(this.lastCompletedUserTurn);
      return;
    }
    const state = this.conversationMachine.getState();
    if (state.turnContext && state.turnContext.turnRole === "user") {
      await this.dispatchPromptFromTurn(state.turnContext);
    }
  }

  private async handleAssistantPlaybackCancellation(context: {
    reason: string;
    source: string;
  }): Promise<void> {
    this.conversationMachine.handleUserInterrupt(
      "system",
      `${context.source}:${context.reason}`,
    );
  }

  private handleFallbackChanged(active: boolean, reason: string): void {
    this.voicePanel.setFallbackState(active, reason);
  }

  private mapStateToLabel(state: string): string {
    switch (state) {
      case "idle":
        return "Ready";
      case "preparing":
        return "Preparing";
      case "listening":
        return "Listening";
      case "processing":
        return "Thinking";
      case "waitingForCopilot":
        return "Waiting for Copilot";
      case "speaking":
        return "Speaking";
      case "interrupted":
        return "Interrupted";
      case "suspended":
        return "Paused";
      case "faulted":
        return "Needs Attention";
      case "terminating":
        return "Ending Conversation";
      default:
        return state.charAt(0).toUpperCase() + state.slice(1);
    }
  }

  private mapModeLabel(
    state: string,
    turn?: ConversationTurnContext,
  ): string | undefined {
    if (turn) {
      if (turn.turnRole === "user") {
        return "User turn";
      }
      if (turn.turnRole === "assistant") {
        return "VoicePilot speaking";
      }
    }
    if (state === "waitingForCopilot") {
      return "Copilot response pending";
    }
    if (state === "processing") {
      return "Processing request";
    }
    return undefined;
  }

  private mapStateDetail(
    event: ConversationStateChangeEvent,
  ): string | undefined {
    if (event.metadata.reason) {
      return event.metadata.reason;
    }
    if (
      event.transition.to === "suspended" &&
      event.metadata.suspensionReason
    ) {
      return `Suspended: ${event.metadata.suspensionReason}`;
    }
    if (event.transition.to === "faulted") {
      return "Conversation paused due to repeated errors";
    }
    if (event.transition.to === "waitingForCopilot") {
      return "Awaiting Copilot reply";
    }
    return undefined;
  }

  private lastCompletedUserTurn?: ConversationTurnContext;
}

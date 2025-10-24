import { createHash, randomUUID } from "crypto";
import * as vscode from "vscode";
import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import type { TimerTracker } from "../core/disposal/resource-tracker";
import { Logger } from "../core/logger";
import { createVoicePilotError, withRecovery } from "../helpers/error/envelope";
import { PrivacyController } from "../services/privacy/privacy-controller";
import { RealtimeSpeechToTextService } from "../services/realtime-speech-to-text-service";
import type {
    ConversationStorageService,
    RecoverySnapshot,
    MessageFrame as StoredMessageFrame,
} from "../types/conversation-storage";
import { EphemeralKeyInfo, EphemeralKeyResult } from "../types/ephemeral";
import type {
    RecoveryExecutionOptions,
    RecoveryExecutor,
    RecoveryPlan,
    RecoveryRegistrar,
} from "../types/error/voice-pilot-error";
import type { PurgeCommand, PurgeReason } from "../types/privacy";
import { RealtimeEvent } from "../types/realtime-events";
import {
    HealthCheck,
    RenewalResult,
    SessionConfig,
    SessionDiagnostics,
    SessionError,
    SessionErrorEvent,
    SessionErrorHandler,
    SessionEvent,
    SessionEventHandler,
    SessionHealthResult,
    SessionInfo,
    SessionManager,
    SessionRenewalEvent,
    SessionRenewalHandler,
    SessionState,
    SessionStateEvent,
    SessionStateHandler,
    SessionStatistics,
} from "../types/session";
import {
    TranscriptEvent,
    TranscriptEventHandler,
} from "../types/speech-to-text";
import { SessionTimerManagerImpl } from "./session-timer-manager";

export interface ConversationLifecycleHooks {
  onSessionReady?(session: SessionInfo): Promise<void> | void;
  onSessionEnding?(session: SessionInfo): Promise<void> | void;
  onSessionSuspending?(
    session: SessionInfo,
    reason: string,
  ): Promise<void> | void;
  onSessionResumed?(session: SessionInfo): Promise<void> | void;
}

/**
 * Comprehensive session management implementation for VoicePilot voice interactions.
 * Handles session lifecycle, automatic credential renewal, timer-based operations,
 * and event notifications according to SP-005 Session Management & Renewal specification.
 */
export class SessionManagerImpl implements SessionManager {
  private initialized = false;
  private sessions = new Map<string, SessionInfo>();
  private timerManager!: SessionTimerManagerImpl;
  private keyService!: EphemeralKeyServiceImpl;
  private configManager!: ConfigurationManager;
  private logger!: Logger;
  private eventHandlers = new Map<string, Set<Function>>();
  private conversationHooks?: ConversationLifecycleHooks;
  private lastErrors = new Map<string, SessionError>();
  private privacyController?: PrivacyController;
  private recoveryExecutor?: RecoveryExecutor;
  private defaultRecoveryPlan?: RecoveryPlan;
  private realtimeTranscriptionService?: RealtimeSpeechToTextService;
  private realtimeTranscriptSubscription?: { dispose(): void };
  private readonly realtimeTranscriptHandlers =
    new Set<TranscriptEventHandler>();
  private timerResourceTracker?: TimerTracker;
  private conversationStorage?: ConversationStorageService;
  private readonly sessionConversationMap = new Map<string, string>();
  private readonly conversationSnapshots = new Map<string, RecoverySnapshot>();
  private readonly conversationSequences = new Map<string, number>();

  constructor(
    keyService?: EphemeralKeyServiceImpl,
    timerManager?: SessionTimerManagerImpl,
    configManager?: ConfigurationManager,
    logger?: Logger,
    privacyController?: PrivacyController,
    recoveryExecutor?: RecoveryExecutor,
    recoveryPlan?: RecoveryPlan,
    timerResourceTracker?: TimerTracker,
    conversationStorage?: ConversationStorageService,
  ) {
    if (keyService) {
      this.keyService = keyService;
    }
    if (timerManager) {
      this.timerManager = timerManager;
    }
    if (configManager) {
      this.configManager = configManager;
    }
    if (logger) {
      this.logger = logger;
    }
    if (privacyController) {
      this.privacyController = privacyController;
    }
    if (recoveryExecutor) {
      this.recoveryExecutor = recoveryExecutor;
    }
    if (recoveryPlan) {
      this.defaultRecoveryPlan = recoveryPlan;
    }
    if (timerResourceTracker) {
      this.timerResourceTracker = timerResourceTracker;
    }
    if (conversationStorage) {
      this.conversationStorage = conversationStorage;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger = this.logger || new Logger("SessionManager");
    this.logger.info("Initializing SessionManager");

    // Validate dependencies
    if (!this.keyService || !this.keyService.isInitialized()) {
      throw new Error(
        "EphemeralKeyService must be initialized before SessionManager",
      );
    }

    if (!this.configManager || !this.configManager.isInitialized()) {
      throw new Error(
        "ConfigurationManager must be initialized before SessionManager",
      );
    }

    // Initialize timer manager with callbacks
    if (!this.timerManager) {
      this.timerManager = new SessionTimerManagerImpl(
        this.logger,
        this.handleRenewalRequired.bind(this),
        this.handleTimeoutExpired.bind(this),
        this.handleHeartbeatCheck.bind(this),
        this.timerResourceTracker,
      );
    }

    // Setup key service event handlers
    this.keyService.onKeyRenewed(this.handleKeyRenewed.bind(this));
    this.keyService.onKeyExpired(this.handleKeyExpired.bind(this));
    this.keyService.onAuthenticationError(this.handleAuthError.bind(this));

    this.initialized = true;
    this.logger.info("SessionManager initialized successfully");
  }

  registerConversationHooks(
    hooks: ConversationLifecycleHooks,
  ): vscode.Disposable {
    this.conversationHooks = hooks;
    return {
      dispose: () => {
        if (this.conversationHooks === hooks) {
          this.conversationHooks = undefined;
        }
      },
    };
  }

  setPrivacyController(controller: PrivacyController): void {
    this.privacyController = controller;
  }

  setConversationStorage(storage: ConversationStorageService): void {
    this.conversationStorage = storage;
  }

  setRecoveryExecutor(executor: RecoveryExecutor, plan?: RecoveryPlan): void {
    this.recoveryExecutor = executor;
    if (plan) {
      this.defaultRecoveryPlan = plan;
    }
  }

  setTimerResourceTracker(tracker: TimerTracker): void {
    this.timerResourceTracker = tracker;
    this.timerManager?.setResourceTracker(tracker);
  }

  setRealtimeSpeechToTextService(service: RealtimeSpeechToTextService): void {
    if (this.realtimeTranscriptionService === service) {
      return;
    }

    this.realtimeTranscriptSubscription?.dispose();
    this.realtimeTranscriptionService = service;
    this.realtimeTranscriptSubscription = service.subscribeTranscript(
      async (event) => {
        await this.emitRealtimeTranscriptEvent(event);
      },
    );

    const currentSession = this.getCurrentSession();
    if (currentSession) {
      void this.prepareRealtimeTranscription(currentSession).catch(
        (error: any) => {
          this.logger.warn("Failed to prime realtime transcription service", {
            error: error?.message ?? error,
          });
        },
      );
    }
  }

  onRealtimeTranscript(handler: TranscriptEventHandler): vscode.Disposable {
    this.realtimeTranscriptHandlers.add(handler);
    return {
      dispose: () => {
        this.realtimeTranscriptHandlers.delete(handler);
      },
    };
  }

  handleRealtimeTranscriptEvent(event: RealtimeEvent): void {
    if (!this.realtimeTranscriptionService) {
      return;
    }

    try {
      if (!this.realtimeTranscriptionService.isInitialized()) {
        const session = this.getCurrentSession();
        if (!session) {
          return;
        }
        void this.realtimeTranscriptionService
          .initialize(session.sessionId)
          .then(() => {
            this.realtimeTranscriptionService?.setSessionId(session.sessionId);
            this.realtimeTranscriptionService?.clearActiveUtterances();
            this.realtimeTranscriptionService?.ingestRealtimeEvent(event);
          })
          .catch((error: any) => {
            this.logger.warn(
              "Failed to initialize realtime transcription service",
              {
                error: error?.message ?? error,
              },
            );
          });
        return;
      }

      const session = this.getCurrentSession();
      if (session) {
        this.realtimeTranscriptionService.setSessionId(session.sessionId);
      }

      this.realtimeTranscriptionService.ingestRealtimeEvent(event);
    } catch (error: any) {
      this.logger.warn("Realtime transcription ingestion failed", {
        error: error?.message ?? error,
        type: event.type,
      });
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info("Disposing SessionManager");

    // End all active sessions gracefully
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) =>
        s.state === SessionState.Active || s.state === SessionState.Renewing,
    );

    for (const session of activeSessions) {
      try {
        this.endSessionSync(session.sessionId);
      } catch (error: any) {
        this.logger.warn("Failed to end session during disposal", {
          sessionId: session.sessionId,
          error: error.message,
        });
      }
    }

    // Clear timer manager
    if (this.timerManager) {
      this.timerManager.dispose();
    }

    // Clear all session state
    this.sessions.clear();
    this.eventHandlers.clear();
    this.realtimeTranscriptSubscription?.dispose();
    this.realtimeTranscriptHandlers.clear();
    this.realtimeTranscriptionService?.clearActiveUtterances();
    this.realtimeTranscriptionService = undefined;
    this.sessionConversationMap.clear();
    this.conversationSnapshots.clear();
    this.conversationSequences.clear();

    this.initialized = false;
    this.logger.info("SessionManager disposed");
    void this.purgePrivacyData("policy-update");
  }

  // Primary session operations
  async startSession(
    config: SessionConfig = this.getDefaultConfig(),
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // Check concurrent session limits
    const activeSessions = Array.from(this.sessions.values()).filter(
      (s) =>
        s.state === SessionState.Active || s.state === SessionState.Starting,
    );

    if (activeSessions.length >= this.getMaxConcurrentSessions()) {
      throw new Error(
        `Maximum concurrent sessions (${this.getMaxConcurrentSessions()}) exceeded`,
      );
    }

    const sessionId = this.generateSessionId();
    const sessionInfo: SessionInfo = {
      sessionId,
      state: SessionState.Starting,
      startedAt: new Date(),
      lastActivity: new Date(),
      config,
      statistics: this.createEmptyStatistics(),
      connectionInfo: {
        webrtcState: "disconnected",
        reconnectAttempts: 0,
      },
    };

    this.sessions.set(sessionId, sessionInfo);
    this.emitSessionEvent("started", sessionInfo);

    try {
      const keyResult = await this.executeSessionOperation(
        async () => {
          const baseMessage = "Failed to obtain session credentials";
          try {
            const result = await this.keyService.requestEphemeralKey();
            if (!result.success) {
              const detail = result.error?.message?.trim();
              throw new Error(
                detail ? `${baseMessage}: ${detail}` : baseMessage,
              );
            }
            return result;
          } catch (error: any) {
            const detail = (error?.message ?? String(error)).trim();
            if (detail && detail.includes(baseMessage)) {
              throw new Error(detail);
            }
            throw new Error(detail ? `${baseMessage}: ${detail}` : baseMessage);
          }
        },
        {
          code: "SESSION_CREDENTIAL_ACQUISITION_FAILED",
          message: "Failed to obtain session credentials",
          remediation:
            "Check Azure credentials, network connectivity, and retry.",
          operation: "startSession:requestEphemeralKey",
          metadata: {
            sessionId,
            activeSessions: activeSessions.length,
          },
          retry: {
            policy: "exponential",
            maxAttempts: 3,
            initialDelayMs: 500,
            multiplier: 2,
          },
        },
      );

      // Update session with credential information
      sessionInfo.expiresAt = keyResult.expiresAt;
      sessionInfo.connectionInfo.ephemeralKeyInfo =
        this.keyService.getCurrentKey();
      sessionInfo.state = SessionState.Active;

      // Schedule automatic renewal
      this.scheduleRenewal(sessionId, keyResult.expiresAt!);

      // Start inactivity timer if enabled
      if (config.enableInactivityTimeout) {
        this.timerManager.startTimeoutTimer(
          sessionId,
          config.inactivityTimeoutMinutes * 60 * 1000,
        );
      }

      // Start heartbeat timer if enabled
      if (config.enableHeartbeat) {
        this.timerManager.startHeartbeatTimer(
          sessionId,
          config.heartbeatIntervalSeconds * 1000,
        );
      }

      this.logger.info("Session started successfully", {
        sessionId,
        expiresAt: keyResult.expiresAt?.toISOString(),
      });

      await this.initializeConversationRecord(sessionInfo);
      await this.prepareRealtimeTranscription(sessionInfo);

      await this.invokeConversationHook("onSessionReady", sessionInfo);

      return sessionInfo;
    } catch (error: any) {
      sessionInfo.state = SessionState.Failed;
      this.logger.error("Failed to start session", {
        sessionId,
        error: error.message,
      });
      this.emitSessionError("authentication-error", sessionId, {
        code: "SESSION_START_FAILED",
        message: error.message,
        isRetryable: true,
        remediation: "Check Azure credentials and network connectivity",
        timestamp: new Date(),
      });
      throw error;
    }
  }

  async endSession(sessionId?: string): Promise<void> {
    const targetSessionId = sessionId || this.getCurrentSession()?.sessionId;
    if (!targetSessionId) {
      return;
    }

    const session = this.sessions.get(targetSessionId);
    if (!session) {
      return;
    }

    session.state = SessionState.Ending;
    await this.invokeConversationHook("onSessionEnding", session);

    try {
      // Clear all timers for this session
      this.timerManager.clearAllTimers(targetSessionId);

      // End session with key service if needed
      if (session.connectionInfo.ephemeralKeyInfo?.sessionId) {
        await this.keyService.endSession(
          session.connectionInfo.ephemeralKeyInfo.sessionId,
        );
      }

      // Calculate final statistics
      session.statistics.totalDurationMs =
        Date.now() - session.startedAt.getTime();

      await this.finalizeConversation(session, "user-requested");

      // Remove from active sessions
      this.sessions.delete(targetSessionId);

      this.emitSessionEvent("ended", session);

      this.logger.info("Session ended successfully", {
        sessionId: targetSessionId,
        duration: session.statistics.totalDurationMs,
        renewals: session.statistics.renewalCount,
      });

      this.realtimeTranscriptionService?.clearActiveUtterances();
    } catch (error: any) {
      this.logger.error("Error ending session", {
        sessionId: targetSessionId,
        error: error.message,
      });
      await this.finalizeConversation(session, "error-recovery");
      throw error;
    } finally {
      await this.purgePrivacyData("session-timeout", "all");
    }
  }

  async renewSession(sessionId: string): Promise<RenewalResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sessionId,
        latencyMs: 0,
        error: {
          code: "SESSION_NOT_FOUND",
          message: `Session ${sessionId} not found`,
          isRetryable: false,
          remediation: "Start a new session",
          timestamp: new Date(),
        },
      };
    }

    const startTime = Date.now();
    session.state = SessionState.Renewing;
    this.emitSessionStateChange(
      sessionId,
      SessionState.Active,
      SessionState.Renewing,
      "Manual renewal requested",
    );
    await this.invokeConversationHook(
      "onSessionSuspending",
      session,
      "manual-renewal",
    );

    // Emit renewal started event
    this.emitSessionRenewal("renewal-started", sessionId);

    try {
      const renewalResult = await this.executeSessionOperation(
        async () => {
          const baseMessage = "Failed to renew session credentials";
          try {
            const result = await this.keyService.renewKey();
            if (!result.success) {
              const detail = result.error?.message?.trim();
              const failureError = new Error(
                detail ? `${baseMessage}: ${detail}` : baseMessage,
              );
              (failureError as any).sessionRenewalContext = {
                reason: "failure",
                metadata: {
                  isRetryable: result.error?.isRetryable ?? false,
                  remediation:
                    result.error?.remediation ?? "Check Azure service status",
                  providerCode: result.error?.code,
                  originalMessage: result.error?.message,
                },
              };
              throw failureError;
            }
            return result;
          } catch (error: any) {
            if ((error as any)?.sessionRenewalContext?.reason === "failure") {
              throw error;
            }
            const detail = (error?.message ?? String(error)).trim();
            const formatted =
              detail && detail.includes(baseMessage)
                ? detail
                : detail
                  ? `${baseMessage}: ${detail}`
                  : baseMessage;
            const exceptionError = new Error(formatted);
            (exceptionError as any).sessionRenewalContext = {
              reason: "exception",
              metadata: {
                isRetryable: true,
                remediation: "Check network connectivity and retry",
                originalMessage: detail,
              },
            };
            if (error instanceof Error && !(exceptionError as any).cause) {
              (exceptionError as any).cause = error;
            }
            throw exceptionError;
          }
        },
        {
          code: "SESSION_RENEWAL_FAILED",
          message: "Failed to renew session credentials",
          remediation:
            "Verify network connectivity and Azure service status before retrying.",
          operation: "renewSession:requestEphemeralKey",
          metadata: { sessionId },
          retry: {
            policy: "exponential",
            maxAttempts: 3,
            initialDelayMs: 500,
            multiplier: 2,
          },
        },
      );
      const latencyMs = Date.now() - startTime;

      if (renewalResult.success) {
        session.expiresAt = renewalResult.expiresAt;
        session.connectionInfo.ephemeralKeyInfo =
          this.keyService.getCurrentKey();
        session.statistics.renewalCount++;
        session.statistics.averageRenewalLatencyMs =
          (session.statistics.averageRenewalLatencyMs *
            (session.statistics.renewalCount - 1) +
            latencyMs) /
          session.statistics.renewalCount;
        session.state = SessionState.Active;

        // Schedule next renewal
        this.scheduleRenewal(sessionId, renewalResult.expiresAt!);

        const renewalReturn = {
          success: true,
          sessionId,
          newExpiresAt: renewalResult.expiresAt,
          latencyMs,
        };

        // Emit renewal completed event
        this.emitSessionRenewal("renewal-completed", sessionId, renewalReturn);
        await this.invokeConversationHook("onSessionResumed", session);

        return renewalReturn;
      } else {
        session.statistics.failedRenewalCount++;
        session.state = SessionState.Failed;

        const renewalReturn = {
          success: false,
          sessionId,
          latencyMs,
          error: {
            code: "RENEWAL_FAILED",
            message: renewalResult.error?.message || "Unknown renewal error",
            isRetryable: renewalResult.error?.isRetryable || false,
            remediation:
              renewalResult.error?.remediation || "Check Azure service status",
            timestamp: new Date(),
          },
        };

        // Emit renewal failed event and session error
        this.emitSessionRenewal("renewal-failed", sessionId, renewalReturn);
        this.emitSessionError("renewal-error", sessionId, renewalReturn.error);
        await this.invokeConversationHook("onSessionEnding", session);

        return renewalReturn;
      }
    } catch (error: any) {
      session.statistics.failedRenewalCount++;
      session.state = SessionState.Failed;
      const latencyMs = Date.now() - startTime;

      const contextInfo = (error?.sessionRenewalContext ?? {}) as {
        reason?: "failure" | "exception";
        metadata?: {
          isRetryable?: boolean;
          remediation?: string;
          providerCode?: string;
          originalMessage?: string;
        };
      };
      const cause = (error as any)?.cause;
      const isException = contextInfo.reason === "exception" || Boolean(cause);
      const isFailure = !isException;
      const metadata = contextInfo.metadata ?? {};
      const remediationFallback = isFailure
        ? "Check Azure service status"
        : "Check network connectivity and retry";

      const renewalReturn = {
        success: false,
        sessionId,
        latencyMs,
        error: {
          code: isFailure ? "RENEWAL_FAILED" : "RENEWAL_EXCEPTION",
          message: error?.message ?? "Failed to renew session credentials",
          isRetryable: metadata.isRetryable ?? true,
          remediation: metadata.remediation ?? remediationFallback,
          timestamp: new Date(),
          context:
            metadata.providerCode || metadata.originalMessage
              ? {
                  providerCode: metadata.providerCode,
                  originalMessage: metadata.originalMessage,
                }
              : undefined,
        },
      };

      // Emit renewal failed event and session error
      this.emitSessionRenewal("renewal-failed", sessionId, renewalReturn);
      this.emitSessionError("renewal-error", sessionId, renewalReturn.error);
      await this.invokeConversationHook("onSessionEnding", session);

      return renewalReturn;
    }
  }

  // Session state queries
  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getCurrentSession(): SessionInfo | undefined {
    // Return most recently active session
    const activeSessions = Array.from(this.sessions.values())
      .filter((s) => s.state === SessionState.Active)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

    return activeSessions[0];
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  isSessionActive(sessionId?: string): boolean {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      return session?.state === SessionState.Active;
    }
    return this.getCurrentSession()?.state === SessionState.Active || false;
  }

  // Session configuration
  async updateSessionConfig(
    sessionId: string,
    config: Partial<SessionConfig>,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const oldConfig = { ...session.config };
    session.config = { ...session.config, ...config };

    // Update timers if intervals changed
    if (
      config.inactivityTimeoutMinutes &&
      config.inactivityTimeoutMinutes !== oldConfig.inactivityTimeoutMinutes
    ) {
      if (session.config.enableInactivityTimeout) {
        this.timerManager.startTimeoutTimer(
          sessionId,
          config.inactivityTimeoutMinutes * 60 * 1000,
        );
      }
    }

    if (
      config.heartbeatIntervalSeconds &&
      config.heartbeatIntervalSeconds !== oldConfig.heartbeatIntervalSeconds
    ) {
      if (session.config.enableHeartbeat) {
        this.timerManager.startHeartbeatTimer(
          sessionId,
          config.heartbeatIntervalSeconds * 1000,
        );
      }
    }

    this.logger.info("Session configuration updated", { sessionId, config });
  }

  getSessionConfig(sessionId: string): SessionConfig | undefined {
    return this.sessions.get(sessionId)?.config;
  }

  registerRecoveryActions(registrar: RecoveryRegistrar): void {
    registrar.addStep({
      id: "SESSION_FORCE_TERMINATION",
      description: "Force end the active session to recover from failure.",
      execute: async () => {
        const start = Date.now();
        try {
          await this.endSession();
          return { success: true, durationMs: Date.now() - start };
        } catch (error: any) {
          return {
            success: false,
            durationMs: Date.now() - start,
            error: createVoicePilotError({
              faultDomain: "session",
              code: "SESSION_FORCE_TERMINATION_FAILED",
              message: error?.message ?? "Failed to force end session",
              remediation: "Review session state and retry termination.",
              metadata: { error },
            }),
          };
        }
      },
      compensatingAction: async () => {
        this.logger.warn(
          "Attempting compensating action: clearing session timers",
        );
        this.timerManager?.dispose();
        this.timerManager = new SessionTimerManagerImpl(
          this.logger,
          this.handleRenewalRequired.bind(this),
          this.handleTimeoutExpired.bind(this),
          this.handleHeartbeatCheck.bind(this),
          this.timerResourceTracker,
        );
      },
    });

    registrar.addStep({
      id: "SESSION_PURGE_PRIVACY",
      description: "Purge cached session privacy data to avoid stale state.",
      execute: async () => {
        const start = Date.now();
        try {
          await this.purgePrivacyData("error-recovery");
          return { success: true, durationMs: Date.now() - start };
        } catch (error: any) {
          return {
            success: false,
            durationMs: Date.now() - start,
            error: createVoicePilotError({
              faultDomain: "session",
              code: "SESSION_PRIVACY_PURGE_FAILED",
              message: error?.message ?? "Failed to purge session privacy data",
              remediation: "Manually clear VoicePilot privacy cache.",
              metadata: { error },
            }),
          };
        }
      },
    });

    registrar.addFallback("degraded-features", async () => {
      this.logger.warn(
        "Entering degraded session mode due to repeated failures.",
      );
      try {
        await vscode.commands.executeCommand(
          "setContext",
          "voicepilot.session.degraded",
          true,
        );
      } catch (error: any) {
        this.logger.warn("Failed to set degraded session context", {
          error: error?.message ?? error,
        });
      }
    });

    registrar.setNotification({
      notifyUser: true,
      suppressionWindowMs: 60_000,
    });
  }

  private async executeSessionOperation<T>(
    operation: () => Promise<T>,
    context: {
      code: string;
      message: string;
      remediation: string;
      operation: string;
      metadata?: Record<string, unknown>;
      severity?: RecoveryExecutionOptions["severity"];
      userImpact?: RecoveryExecutionOptions["userImpact"];
      retry?: RecoveryExecutionOptions["retry"];
      recoveryPlan?: RecoveryPlan;
    },
  ): Promise<T> {
    if (!this.recoveryExecutor) {
      return operation();
    }

    return withRecovery(operation, {
      executor: this.recoveryExecutor,
      faultDomain: "session",
      code: context.code,
      message: context.message,
      remediation: context.remediation,
      operation: context.operation,
      correlationId: randomUUID(),
      severity: context.severity ?? "error",
      userImpact: context.userImpact ?? "degraded",
      metadata: context.metadata,
      retry: context.retry,
      recoveryPlan: context.recoveryPlan ?? this.defaultRecoveryPlan,
      onRetryScheduled: (plan) => {
        this.logger.warn("Session operation retry scheduled", {
          operation: context.operation,
          attempt: plan.attempt,
          maxAttempts: plan.maxAttempts,
          nextAttemptAt: plan.nextAttemptAt?.toISOString(),
        });
      },
      onRecoveryComplete: (outcome) => {
        if (!outcome.success && outcome.error) {
          this.logger.error("Session recovery failed", {
            operation: context.operation,
            message: outcome.error.message,
          });
        }
      },
    });
  }

  // Event handling
  onSessionStarted(handler: SessionEventHandler): vscode.Disposable {
    return this.addEventHandler("session-started", handler);
  }

  onSessionEnded(handler: SessionEventHandler): vscode.Disposable {
    return this.addEventHandler("session-ended", handler);
  }

  onSessionRenewed(handler: SessionRenewalHandler): vscode.Disposable {
    return this.addEventHandler("session-renewed", handler);
  }

  onSessionError(handler: SessionErrorHandler): vscode.Disposable {
    return this.addEventHandler("session-error", handler);
  }

  onSessionStateChanged(handler: SessionStateHandler): vscode.Disposable {
    return this.addEventHandler("session-state-changed", handler);
  }

  // Diagnostic operations
  getSessionDiagnostics(sessionId: string): SessionDiagnostics {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return this.buildSessionDiagnostics(session);
  }

  async testSessionHealth(sessionId: string): Promise<SessionHealthResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    // Check credential validity
    const keyInfo = this.keyService.getCurrentKey();
    checks.push({
      name: "credential-validity",
      status: keyInfo && keyInfo.isValid ? "pass" : "fail",
      message: keyInfo?.isValid
        ? "Credentials are valid"
        : "Credentials are expired or invalid",
    });

    // Check timer status
    const timerStatus = this.timerManager.getTimerStatus(sessionId);
    checks.push({
      name: "timer-health",
      status: timerStatus.renewalTimer?.isActive ? "pass" : "warn",
      message: timerStatus.renewalTimer?.isActive
        ? "Renewal timer is active"
        : "Renewal timer is not active",
    });

    // Check session age
    const ageMinutes = (Date.now() - session.startedAt.getTime()) / (1000 * 60);
    checks.push({
      name: "session-age",
      status: ageMinutes < 60 ? "pass" : "warn",
      message: `Session age: ${ageMinutes.toFixed(1)} minutes`,
    });

    const latencyMs = Date.now() - startTime;
    const failedChecks = checks.filter((c) => c.status === "fail");

    return {
      isHealthy: failedChecks.length === 0,
      checks,
      latencyMs,
      recommendations: this.generateHealthRecommendations(checks),
    };
  }

  async resetInactivityTimer(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.lastActivity = new Date();
    session.statistics.inactivityResets++;

    // Reset the inactivity timer
    this.timerManager.resetInactivityTimer(sessionId);

    this.logger.debug("Session inactivity timer reset", { sessionId });
  }

  // Private implementation methods
  private scheduleRenewal(sessionId: string, expiresAt: Date): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const renewalTime =
      expiresAt.getTime() - session.config.renewalMarginSeconds * 1000;
    this.timerManager.startRenewalTimer(sessionId, renewalTime);
  }

  private buildSessionDiagnostics(session: SessionInfo): SessionDiagnostics {
    const sessionId = session.sessionId;
    const timerStatus = this.timerManager.getTimerStatus(sessionId);
    const keyInfo = this.keyService.getCurrentKey();
    const nextEvent = this.timerManager.getNextScheduledEvent(sessionId);

    let credentialStatus: "valid" | "expired" | "missing" | "invalid" =
      "missing";
    if (keyInfo) {
      credentialStatus = keyInfo.isValid ? "valid" : "expired";
    }

    let connectionStatus: "healthy" | "degraded" | "failed" = "healthy";
    if (session.connectionInfo.webrtcState === "failed") {
      connectionStatus = "failed";
    } else if (
      session.connectionInfo.webrtcState === "connecting" ||
      session.statistics.failedRenewalCount > 0
    ) {
      connectionStatus = "degraded";
    }

    return {
      sessionId,
      state: session.state,
      timerStatus,
      credentialStatus,
      connectionStatus,
      lastError: this.lastErrors.get(sessionId),
      uptime: Date.now() - session.startedAt.getTime(),
      nextScheduledEvent: nextEvent
        ? {
            type: nextEvent.type,
            sessionId: nextEvent.sessionId,
            scheduledAt: nextEvent.scheduledAt,
            timeRemainingMs: nextEvent.timeRemainingMs,
          }
        : undefined,
    };
  }

  private captureDiagnosticsSnapshot(
    sessionId: string,
  ): SessionDiagnostics | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    try {
      return this.buildSessionDiagnostics(session);
    } catch (error: any) {
      this.logger.debug("Failed to capture diagnostics snapshot", {
        sessionId,
        error: error?.message ?? error,
      });
      return undefined;
    }
  }

  private async handleRenewalRequired(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SessionState.Active) {
      return;
    }

    session.state = SessionState.Renewing;
    this.emitSessionStateChange(
      sessionId,
      SessionState.Active,
      SessionState.Renewing,
      "Automatic renewal triggered",
    );
    await this.invokeConversationHook(
      "onSessionSuspending",
      session,
      "auto-renewal",
    );

    const renewalStart = Date.now();

    try {
      const renewalResult = await this.keyService.renewKey();
      const latencyMs = Date.now() - renewalStart;

      if (renewalResult.success) {
        session.expiresAt = renewalResult.expiresAt;
        session.connectionInfo.ephemeralKeyInfo =
          this.keyService.getCurrentKey();
        session.statistics.renewalCount++;
        session.statistics.averageRenewalLatencyMs =
          (session.statistics.averageRenewalLatencyMs *
            (session.statistics.renewalCount - 1) +
            latencyMs) /
          session.statistics.renewalCount;
        session.state = SessionState.Active;

        // Schedule next renewal
        this.scheduleRenewal(sessionId, renewalResult.expiresAt!);

        this.emitSessionRenewal("renewal-completed", sessionId, {
          success: true,
          sessionId,
          newExpiresAt: renewalResult.expiresAt,
          latencyMs,
        });

        this.logger.info("Session renewed successfully", {
          sessionId,
          latencyMs,
          newExpiresAt: renewalResult.expiresAt?.toISOString(),
        });

        await this.invokeConversationHook("onSessionResumed", session);
      } else {
        session.statistics.failedRenewalCount++;
        session.state = SessionState.Failed;

        this.emitSessionRenewal("renewal-failed", sessionId, {
          success: false,
          sessionId,
          latencyMs,
          error: {
            code: "RENEWAL_FAILED",
            message: renewalResult.error?.message || "Unknown renewal error",
            isRetryable: renewalResult.error?.isRetryable || false,
            remediation:
              renewalResult.error?.remediation || "Check Azure service status",
            timestamp: new Date(),
          },
        });

        this.logger.error("Session renewal failed", {
          sessionId,
          error: renewalResult.error?.message,
        });

        await this.invokeConversationHook("onSessionEnding", session);
      }
    } catch (error: any) {
      session.statistics.failedRenewalCount++;
      session.state = SessionState.Failed;

      this.emitSessionError("renewal-error", sessionId, {
        code: "RENEWAL_EXCEPTION",
        message: error.message,
        isRetryable: true,
        remediation: "Check network connectivity and retry",
        timestamp: new Date(),
      });

      this.logger.error("Session renewal exception", {
        sessionId,
        error: error.message,
      });
      await this.invokeConversationHook("onSessionEnding", session);
    }
  }

  private async handleTimeoutExpired(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this.logger.info("Session inactivity timeout expired", { sessionId });

    this.emitSessionError("timeout-error", sessionId, {
      code: "INACTIVITY_TIMEOUT",
      message: `Session ${sessionId} terminated due to ${session.config.inactivityTimeoutMinutes} minutes of inactivity`,
      isRetryable: false,
      remediation: "Start a new session when ready to continue",
      timestamp: new Date(),
    });

    await this.endSession(sessionId);
  }

  private async handleHeartbeatCheck(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.statistics.heartbeatCount++;

    try {
      // Perform health check
      const healthResult = await this.testSessionHealth(sessionId);

      if (!healthResult.isHealthy) {
        this.logger.warn("Session health check failed", {
          sessionId,
          checks: healthResult.checks.filter((c) => c.status !== "pass"),
        });

        // Consider session degraded but don't terminate automatically
        session.connectionInfo.webrtcState = "failed";
      }
    } catch (error: any) {
      this.logger.error("Heartbeat check failed", {
        sessionId,
        error: error.message,
      });
    }
  }

  private async handleKeyRenewed(result: EphemeralKeyResult): Promise<void> {
    this.logger.debug("Key renewed event received", {
      success: result.success,
    });
    if (!result.success) {
      return;
    }

    const latestKeyInfo = this.keyService.getCurrentKey();
    if (!latestKeyInfo) {
      return;
    }

    for (const session of this.sessions.values()) {
      if (
        session.connectionInfo.ephemeralKeyInfo?.sessionId ===
        latestKeyInfo.sessionId
      ) {
        session.connectionInfo.ephemeralKeyInfo = { ...latestKeyInfo };
        session.expiresAt = latestKeyInfo.expiresAt;
      }
    }
  }

  private async handleKeyExpired(info: EphemeralKeyInfo): Promise<void> {
    this.logger.warn("Key expired event received", {
      sessionId: info.sessionId,
    });
    // Find sessions using this key and mark them as failed
    for (const [sessionId, session] of this.sessions) {
      if (
        session.connectionInfo.ephemeralKeyInfo?.sessionId === info.sessionId
      ) {
        session.state = SessionState.Failed;
        session.connectionInfo.ephemeralKeyInfo = {
          ...info,
        };
        this.emitSessionError("authentication-error", sessionId, {
          code: "KEY_EXPIRED",
          message: "Session credentials expired",
          isRetryable: true,
          remediation: "Session will attempt automatic renewal",
          timestamp: new Date(),
        });
      }
    }
  }

  private async handleAuthError(error: any): Promise<void> {
    this.logger.error("Authentication error received", { error });
    // Mark all active sessions as failed
    for (const [sessionId, session] of this.sessions) {
      if (session.state === SessionState.Active) {
        session.state = SessionState.Failed;
        this.emitSessionError("authentication-error", sessionId, {
          code: "AUTH_ERROR",
          message: error.message || "Authentication error",
          isRetryable: error.isRetryable || false,
          remediation: error.remediation || "Check Azure credentials",
          timestamp: new Date(),
        });
      }
    }
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${randomUUID()}`;
  }

  private getDefaultConfig(): SessionConfig {
    return {
      renewalMarginSeconds: 10,
      inactivityTimeoutMinutes: 5,
      heartbeatIntervalSeconds: 30,
      maxRetryAttempts: 3,
      retryBackoffMs: 1000,
      enableHeartbeat: true,
      enableInactivityTimeout: true,
    };
  }

  private getMaxConcurrentSessions(): number {
    // TODO: Get from configuration
    return 3;
  }

  private createEmptyStatistics(): SessionStatistics {
    return {
      renewalCount: 0,
      failedRenewalCount: 0,
      heartbeatCount: 0,
      inactivityResets: 0,
      totalDurationMs: 0,
      averageRenewalLatencyMs: 0,
    };
  }

  private generateHealthRecommendations(checks: HealthCheck[]): string[] {
    const recommendations: string[] = [];

    const credentialCheck = checks.find(
      (c) => c.name === "credential-validity",
    );
    if (credentialCheck?.status === "fail") {
      recommendations.push("Renew session credentials through manual renewal");
    }

    const timerCheck = checks.find((c) => c.name === "timer-health");
    if (timerCheck?.status === "warn") {
      recommendations.push(
        "Restart session to reestablish proper timer scheduling",
      );
    }

    const ageCheck = checks.find((c) => c.name === "session-age");
    if (ageCheck?.status === "warn") {
      recommendations.push(
        "Consider ending long-running session and starting fresh",
      );
    }

    return recommendations;
  }

  private async emitRealtimeTranscriptEvent(
    event: TranscriptEvent,
  ): Promise<void> {
    for (const handler of Array.from(this.realtimeTranscriptHandlers)) {
      try {
        const result = handler(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          await result;
        }
      } catch (error: any) {
        this.logger.warn("Realtime transcript handler failed", {
          error: error?.message ?? error,
        });
      }
    }
    await this.handleTranscriptForConversationStorage(event);
  }

  private async prepareRealtimeTranscription(
    session: SessionInfo,
  ): Promise<void> {
    if (!this.realtimeTranscriptionService) {
      return;
    }

    try {
      if (!this.realtimeTranscriptionService.isInitialized()) {
        await this.realtimeTranscriptionService.initialize(session.sessionId);
        return;
      }

      this.realtimeTranscriptionService.clearActiveUtterances();
      this.realtimeTranscriptionService.setSessionId(session.sessionId);
    } catch (error: any) {
      this.logger.warn("Failed to prepare realtime transcription service", {
        error: error?.message ?? error,
      });
    }
  }

  private async initializeConversationRecord(session: SessionInfo): Promise<void> {
    if (!this.conversationStorage) {
      return;
    }

    const conversationId = randomUUID();
    const createdAt = session.startedAt.toISOString();
    const snapshot: RecoverySnapshot = {
      conversationId,
      sessionId: session.sessionId,
      lastInteractionAt: createdAt,
      pendingMessages: [],
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.conversationStorage.createRecord({
        conversationId,
        title: `VoicePilot session ${session.sessionId}`,
        createdAt,
        participants: [
          { id: "user", role: "user", displayName: "User" },
          {
            id: "assistant.voicepilot",
            role: "assistant",
            displayName: "VoicePilot",
          },
        ],
        messages: [],
        metrics: {
          userUtteranceCount: 0,
          assistantUtteranceCount: 0,
          durationMs: 0,
          averageLatencyMs: 0,
        },
      });
      await this.conversationStorage.commitSnapshot(snapshot);
      session.conversationId = conversationId;
      this.sessionConversationMap.set(session.sessionId, conversationId);
      this.conversationSnapshots.set(conversationId, snapshot);
      this.conversationSequences.set(conversationId, 0);
    } catch (error: any) {
      this.logger.warn("Failed to initialize conversation storage", {
        sessionId: session.sessionId,
        error: error?.message ?? error,
      });
      this.sessionConversationMap.delete(session.sessionId);
      this.conversationSnapshots.delete(conversationId);
      this.conversationSequences.delete(conversationId);
      session.conversationId = undefined;
    }
  }

  private ensureConversationSnapshot(
    conversationId: string,
    sessionId: string,
  ): RecoverySnapshot {
    const existing = this.conversationSnapshots.get(conversationId);
    if (existing) {
      existing.sessionId = sessionId;
      return existing;
    }
    const snapshot: RecoverySnapshot = {
      conversationId,
      sessionId,
      lastInteractionAt: new Date().toISOString(),
      pendingMessages: [],
      updatedAt: new Date().toISOString(),
    };
    this.conversationSnapshots.set(conversationId, snapshot);
    if (!this.conversationSequences.has(conversationId)) {
      this.conversationSequences.set(conversationId, 0);
    }
    return snapshot;
  }

  private buildMessagePrivacy(
    metadata: Extract<TranscriptEvent, { type: "transcript-final" }>['metadata'],
  ): StoredMessageFrame['privacy'] {
    const matches = metadata?.redactionsApplied ?? [];
    const redactionRulesApplied = matches.map((match) => match.ruleId);
    const piiTokens = matches.length
      ? matches.map((match) => this.hashRedactedToken(String(match.originalText)))
      : undefined;
    return {
      containsSecrets: matches.length > 0,
      redactionRulesApplied,
      piiTokens,
    };
  }

  private buildMessageFrame(
    conversationId: string,
    event: Extract<TranscriptEvent, { type: "transcript-final" }>,
  ): StoredMessageFrame {
    return {
      frameId: event.utteranceId,
      sequence: this.nextConversationSequence(conversationId),
      role: "user",
      content: event.content,
      createdAt: event.timestamp ?? new Date().toISOString(),
      privacy: this.buildMessagePrivacy(event.metadata),
    };
  }

  private nextConversationSequence(conversationId: string): number {
    const current = this.conversationSequences.get(conversationId) ?? 0;
    const next = current + 1;
    this.conversationSequences.set(conversationId, next);
    return next;
  }

  private hashRedactedToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private async handleTranscriptForConversationStorage(
    event: TranscriptEvent,
  ): Promise<void> {
    if (!this.conversationStorage) {
      return;
    }
    const conversationId = this.sessionConversationMap.get(event.sessionId);
    if (!conversationId) {
      return;
    }
    const snapshot = this.ensureConversationSnapshot(
      conversationId,
      event.sessionId,
    );

    switch (event.type) {
      case "transcript-final": {
        const existingIndex = snapshot.pendingMessages.findIndex(
          (frame) => frame.frameId === event.utteranceId,
        );
        if (existingIndex >= 0) {
          const existing = snapshot.pendingMessages[existingIndex];
          snapshot.pendingMessages.splice(existingIndex, 1, {
            ...existing,
            content: event.content,
            createdAt: event.timestamp ?? existing.createdAt,
            privacy: this.buildMessagePrivacy(event.metadata),
          });
        } else {
          snapshot.pendingMessages.push(
            this.buildMessageFrame(conversationId, event),
          );
        }
        snapshot.pendingMessages.sort((a, b) => a.sequence - b.sequence);
        snapshot.lastInteractionAt =
          event.timestamp ?? snapshot.lastInteractionAt;
        break;
      }
      case "transcript-redo": {
        snapshot.pendingMessages = snapshot.pendingMessages.filter(
          (frame) => frame.frameId !== event.utteranceId,
        );
        snapshot.lastInteractionAt = event.timestamp;
        break;
      }
      case "transcript-cleared":
        snapshot.pendingMessages = [];
        snapshot.lastInteractionAt = event.clearedAt;
        break;
      case "transcript-delta":
        snapshot.lastInteractionAt = event.timestamp;
        break;
      default:
        break;
    }

    snapshot.updatedAt = new Date().toISOString();
    snapshot.sessionId = event.sessionId;
    this.conversationSnapshots.set(conversationId, snapshot);

    try {
      await this.conversationStorage.commitSnapshot(snapshot);
    } catch (error: any) {
      this.logger.debug("Conversation snapshot commit failed", {
        conversationId,
        error: error?.message ?? error,
      });
    }
  }

  private async finalizeConversation(
    session: SessionInfo,
    reason: PurgeReason,
  ): Promise<void> {
    if (!this.conversationStorage || !session.conversationId) {
      return;
    }

    const conversationId = session.conversationId;
    const snapshot = this.conversationSnapshots.get(conversationId);
    const messages = snapshot?.pendingMessages ?? [];

    const metrics = {
      userUtteranceCount: messages.filter((msg) => msg.role === "user").length,
      assistantUtteranceCount: messages.filter((msg) => msg.role === "assistant").length,
      durationMs: session.statistics.totalDurationMs,
      averageLatencyMs: session.statistics.averageRenewalLatencyMs,
    };

    try {
      await this.conversationStorage.commitConversation(conversationId, {
        appendMessages: messages.length ? messages : undefined,
        metrics,
      });
    } catch (error: any) {
      this.logger.warn("Failed to commit conversation transcript", {
        conversationId,
        sessionId: session.sessionId,
        reason,
        error: error?.message ?? error,
      });
    } finally {
      this.conversationSnapshots.delete(conversationId);
      this.conversationSequences.delete(conversationId);
      this.sessionConversationMap.delete(session.sessionId);
      session.conversationId = undefined;
    }
  }

  private endSessionSync(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.state = SessionState.Ending;

    // Clear all timers for this session
    this.timerManager.clearAllTimers(sessionId);

    // Calculate final statistics
    session.statistics.totalDurationMs =
      Date.now() - session.startedAt.getTime();

    void this.finalizeConversation(session, "error-recovery");

    // Remove from active sessions
    this.sessions.delete(sessionId);

    this.logger.info("Session ended synchronously", {
      sessionId,
      duration: session.statistics.totalDurationMs,
      renewals: session.statistics.renewalCount,
    });
    void this.invokeConversationHook("onSessionEnding", session);
  }

  private addEventHandler(
    eventType: string,
    handler: Function,
  ): vscode.Disposable {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    return {
      dispose: () => {
        this.eventHandlers.get(eventType)?.delete(handler);
      },
    };
  }

  private emitSessionEvent(
    type: "started" | "ended",
    sessionInfo: SessionInfo,
  ): void {
    const handlers = this.eventHandlers.get(`session-${type}`);
    if (!handlers) {
      return;
    }

    const event: SessionEvent = {
      type,
      sessionId: sessionInfo.sessionId,
      timestamp: new Date(),
      sessionInfo,
    };

    if (type === "ended") {
      this.lastErrors.delete(sessionInfo.sessionId);
    }

    for (const handler of handlers) {
      try {
        (handler as SessionEventHandler)(event);
      } catch (error: any) {
        this.logger.error(`Session ${type} event handler failed`, {
          error: error.message,
        });
      }
    }
  }

  private emitSessionRenewal(
    type: "renewal-started" | "renewal-completed" | "renewal-failed",
    sessionId: string,
    result?: RenewalResult,
    error?: SessionError,
  ): void {
    const handlers = this.eventHandlers.get("session-renewed");
    if (!handlers) {
      return;
    }

    if (type === "renewal-completed") {
      this.lastErrors.delete(sessionId);
    }

    if (error) {
      this.lastErrors.set(sessionId, error);
    }

    const diagnostics = this.captureDiagnosticsSnapshot(sessionId);

    const event: SessionRenewalEvent = {
      type,
      sessionId,
      timestamp: new Date(),
      result,
      error,
      diagnostics,
    };

    for (const handler of handlers) {
      try {
        (handler as SessionRenewalHandler)(event);
      } catch (err: any) {
        this.logger.error("Session renewal event handler failed", {
          error: err.message,
        });
      }
    }
  }

  private emitSessionError(
    type:
      | "authentication-error"
      | "connection-error"
      | "timeout-error"
      | "renewal-error",
    sessionId: string,
    error: SessionError,
    retryAttempt?: number,
  ): void {
    const handlers = this.eventHandlers.get("session-error");
    if (!handlers) {
      return;
    }

    this.lastErrors.set(sessionId, error);

    const event: SessionErrorEvent = {
      type,
      sessionId,
      timestamp: new Date(),
      error,
      retryAttempt,
    };

    for (const handler of handlers) {
      try {
        (handler as SessionErrorHandler)(event);
      } catch (err: any) {
        this.logger.error("Session error event handler failed", {
          error: err.message,
        });
      }
    }
  }

  private emitSessionStateChange(
    sessionId: string,
    previousState: SessionState,
    newState: SessionState,
    reason: string,
  ): void {
    const handlers = this.eventHandlers.get("session-state-changed");
    if (!handlers) {
      return;
    }

    if (
      newState === SessionState.Active ||
      newState === SessionState.Starting ||
      newState === SessionState.Renewing
    ) {
      this.lastErrors.delete(sessionId);
    }

    const diagnostics = this.captureDiagnosticsSnapshot(sessionId);

    // PresenceIndicatorService consumes diagnostics to determine suspended/offline behaviour (SP-014 SES-001..SES-003)
    const event: SessionStateEvent = {
      type: "state-changed",
      sessionId,
      timestamp: new Date(),
      previousState,
      newState,
      reason,
      diagnostics,
    };

    for (const handler of handlers) {
      try {
        (handler as SessionStateHandler)(event);
      } catch (error: any) {
        this.logger.error("Session state change event handler failed", {
          error: error.message,
        });
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "SessionManager not initialized. Call initialize() first.",
      );
    }
  }

  private async invokeConversationHook(
    hook: keyof ConversationLifecycleHooks,
    ...args: unknown[]
  ): Promise<void> {
    const fn = this.conversationHooks?.[hook];
    if (!fn) {
      return;
    }
    try {
      await Promise.resolve((fn as (...fnArgs: unknown[]) => unknown)(...args));
    } catch (error: any) {
      this.logger.warn("Conversation lifecycle hook failed", {
        hook,
        error: error?.message ?? error,
      });
    }
  }

  private async purgePrivacyData(
    reason: PurgeReason,
    target: PurgeCommand["target"] = "all",
  ): Promise<void> {
    if (!this.privacyController) {
      return;
    }
    const sessionId = this.getCurrentSession()?.sessionId;
    try {
      await this.privacyController.issuePurge({
        type: "privacy.purge",
        target,
        reason,
        issuedAt: new Date().toISOString(),
        correlationId: sessionId,
      });
    } catch (error: any) {
      this.logger.warn("Privacy purge failed", {
        reason,
        target,
        error: error?.message ?? error,
      });
    }
  }
}

// Backwards-compatible implementation name expected by existing tests
export { SessionManagerImpl as SessionManager };

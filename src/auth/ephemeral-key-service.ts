import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { ConfigurationManager } from "../config/configuration-manager";
import { Logger } from "../core/logger";
import { withRecovery } from "../helpers/error/envelope";
import { AzureOpenAIConfig } from "../types/configuration";
import {
  AuthenticationError,
  AuthenticationErrorHandler,
  AuthenticationTestResult,
  AzureSessionRequest,
  AzureSessionResponse,
  EphemeralKeyInfo,
  EphemeralKeyResult,
  EphemeralKeyService,
  EphemeralKeyServiceConfig,
  KeyExpirationHandler,
  KeyRenewalHandler,
  RealtimeSessionInfo,
} from "../types/ephemeral";
import type {
  RecoveryExecutionOptions,
  RecoveryExecutor,
  RecoveryPlan,
  VoicePilotError,
} from "../types/error/voice-pilot-error";
import { CredentialManagerImpl } from "./credential-manager";

/**
 * Implementation of ephemeral key service for Azure OpenAI Realtime API authentication.
 * Provides secure token exchange patterns where permanent Azure API keys are never exposed
 * to client contexts while enabling WebRTC-based real-time audio communication.
 */
export class EphemeralKeyServiceImpl implements EphemeralKeyService {
  private initialized = false;
  private currentKey?: EphemeralKeyInfo;
  private renewalTimer?: NodeJS.Timeout;

  private credentialManager!: CredentialManagerImpl;
  private configManager!: ConfigurationManager;
  private logger!: Logger;
  private recoveryExecutor?: RecoveryExecutor;
  private defaultRecoveryPlan?: RecoveryPlan;

  // Event handlers
  private keyRenewalHandlers: Set<KeyRenewalHandler> = new Set();
  private keyExpirationHandlers: Set<KeyExpirationHandler> = new Set();
  private authErrorHandlers: Set<AuthenticationErrorHandler> = new Set();

  // Service configuration
  private config: EphemeralKeyServiceConfig = {
    renewalMarginSeconds: 10,
    proactiveRenewalIntervalMs: 45000,
    maxRetryAttempts: 3,
    retryBackoffMs: 1000,
    sessionTimeoutMs: 300000, // 5 minutes
  };

  constructor(
    credentialManager?: CredentialManagerImpl,
    configManager?: ConfigurationManager,
    logger?: Logger,
    recoveryExecutor?: RecoveryExecutor,
    recoveryPlan?: RecoveryPlan,
  ) {
    if (credentialManager) {
      this.credentialManager = credentialManager;
    }
    if (configManager) {
      this.configManager = configManager;
    }
    // Always ensure a logger instance exists to avoid undefined access during initialize
    this.logger = logger ?? new Logger("EphemeralKeyService");
    if (recoveryExecutor) {
      this.recoveryExecutor = recoveryExecutor;
    }
    if (recoveryPlan) {
      this.defaultRecoveryPlan = recoveryPlan;
    }
  }

  setRecoveryExecutor(
    executor: RecoveryExecutor,
    defaultPlan?: RecoveryPlan,
  ): void {
    this.recoveryExecutor = executor;
    if (defaultPlan) {
      this.defaultRecoveryPlan = defaultPlan;
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info("Initializing EphemeralKeyService");

    // Validate dependencies
    if (!this.credentialManager || !this.credentialManager.isInitialized()) {
      throw new Error(
        "CredentialManager must be initialized before EphemeralKeyService",
      );
    }

    if (!this.configManager || !this.configManager.isInitialized()) {
      throw new Error(
        "ConfigurationManager must be initialized before EphemeralKeyService",
      );
    }

    // Test authentication capability (non-blocking)
    try {
      const testResult = await this.testAuthentication();
      if (!testResult.success) {
        this.logger.warn("Authentication test failed - service will run in degraded mode", testResult);
      } else {
        this.logger.info("Authentication test passed successfully");
      }
    } catch (error: any) {
      this.logger.warn("Failed to test authentication during initialization - service will run in degraded mode", {
        error: error.message,
      });
    }

    this.initialized = true;
    this.logger.info("EphemeralKeyService initialized successfully");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info("Disposing EphemeralKeyService");

    // Clear renewal timer
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
      this.renewalTimer = undefined;
    }

    // Clear current key from memory
    if (this.currentKey) {
      this.currentKey = undefined;
    }

    // Clear event handlers
    this.keyRenewalHandlers.clear();
    this.keyExpirationHandlers.clear();
    this.authErrorHandlers.clear();

    this.initialized = false;
    this.logger.info("EphemeralKeyService disposed");
  }

  // Primary authentication operations
  private async executeAuthOperation<T>(
    operation: () => Promise<T>,
    context: {
      code: string;
      message: string;
      remediation: string;
      operation: string;
      severity?: RecoveryExecutionOptions["severity"];
      userImpact?: RecoveryExecutionOptions["userImpact"];
      metadata?: Record<string, unknown>;
      retry?: RecoveryExecutionOptions["retry"];
      recoveryPlan?: RecoveryPlan;
      telemetryContext?: RecoveryExecutionOptions["telemetryContext"];
      sessionId?: string;
    },
  ): Promise<T> {
    if (!this.recoveryExecutor) {
      return operation();
    }

    return withRecovery(operation, {
      executor: this.recoveryExecutor,
      faultDomain: "auth",
      code: context.code,
      message: context.message,
      remediation: context.remediation,
      operation: context.operation,
      correlationId: randomUUID(),
      severity: context.severity ?? "error",
      userImpact: context.userImpact ?? "blocked",
      metadata: context.metadata,
      retry: context.retry,
      recoveryPlan: context.recoveryPlan ?? this.defaultRecoveryPlan,
      telemetryContext: context.telemetryContext,
      sessionId: context.sessionId,
      onRetryScheduled: (plan) => {
        this.logger.warn("Authentication retry scheduled", {
          code: context.code,
          attempt: plan.attempt,
          maxAttempts: plan.maxAttempts,
          nextAttemptAt: plan.nextAttemptAt?.toISOString(),
        });
      },
      onRecoveryComplete: (outcome) => {
        if (!outcome.success && outcome.error) {
          this.logger.error("Authentication recovery failed", {
            code: context.code,
            message: outcome.error.message,
          });
        }
      },
    });
  }

  async requestEphemeralKey(): Promise<EphemeralKeyResult> {
    this.ensureInitialized();

    try {
      const config = this.configManager.getAzureOpenAIConfig();
      const apiKey = await this.credentialManager.getAzureOpenAIKey();

      if (!apiKey) {
        return {
          success: false,
          error: {
            code: "MISSING_CREDENTIALS",
            message: "Azure OpenAI API key not configured",
            isRetryable: false,
            remediation: "Configure Azure OpenAI credentials in settings",
          },
        };
      }

      const sessionResponse = await this.executeAuthOperation(
        () => this.createAzureSession(config, apiKey),
        {
          code: "AUTH_EPHEMERAL_SESSION_CREATE_FAILED",
          message: "Failed to create Azure OpenAI realtime session",
          remediation:
            "Verify Azure OpenAI endpoint, deployment name, and credentials.",
          operation: "requestEphemeralKey",
          metadata: {
            endpoint: config.endpoint,
            region: config.region,
            deployment: config.deploymentName,
          },
          retry: {
            policy: "exponential",
            maxAttempts: this.config.maxRetryAttempts,
            initialDelayMs: this.config.retryBackoffMs,
            multiplier: 2,
            jitter: 0.2,
          },
        },
      );

      const ephemeralKey = sessionResponse.client_secret.value;
      const issuedAt = new Date();
      const expiresAt = new Date(
        sessionResponse.client_secret.expires_at * 1000,
      );
      const ttlSeconds = Math.max(
        0,
        sessionResponse.client_secret.expires_at -
          Math.floor(issuedAt.getTime() / 1000),
      );
      const marginMs = this.config.renewalMarginSeconds * 1000;
      const proactiveMs = this.config.proactiveRenewalIntervalMs;
      const safeNowMs = Date.now() + 500;
      const refreshDeadlineMs = Math.max(
        issuedAt.getTime() + 500,
        expiresAt.getTime() - marginMs,
      );
      const candidateMs = Math.min(
        refreshDeadlineMs,
        issuedAt.getTime() + proactiveMs,
      );
      const upperBoundMs = Math.max(
        issuedAt.getTime() + 1000,
        expiresAt.getTime() - 500,
      );
      let refreshAtMs = Math.min(candidateMs, upperBoundMs);
      refreshAtMs = Math.max(safeNowMs, refreshAtMs);
      const expiryGuardMs = Math.max(
        issuedAt.getTime() + 250,
        expiresAt.getTime() - 250,
      );
      refreshAtMs = Math.min(refreshAtMs, expiryGuardMs);
      if (!Number.isFinite(refreshAtMs)) {
        refreshAtMs = safeNowMs;
      }
      const refreshAt = new Date(refreshAtMs);
      const secondsUntilRefresh = Math.max(
        0,
        Math.floor((refreshAt.getTime() - Date.now()) / 1000),
      );

      // Store current key info
      this.currentKey = {
        key: ephemeralKey,
        sessionId: sessionResponse.id,
        issuedAt,
        expiresAt,
        isValid: true,
        secondsRemaining: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
        refreshAt,
        secondsUntilRefresh,
        ttlSeconds,
        refreshIntervalSeconds: Math.floor(proactiveMs / 1000),
      };

      // Schedule automatic renewal
      this.scheduleRenewal();

      this.logger.info("Ephemeral key requested successfully", {
        sessionId: sessionResponse.id,
        expiresAt: expiresAt.toISOString(),
        refreshAt: refreshAt.toISOString(),
      });

      const result: EphemeralKeyResult = {
        success: true,
        ephemeralKey,
        sessionId: sessionResponse.id,
        expiresAt,
        issuedAt,
        refreshAt,
        secondsUntilRefresh,
        refreshIntervalSeconds: Math.floor(proactiveMs / 1000),
      };

      void this.dispatchKeyRenewed(result);

      return result;
    } catch (error: any) {
      this.logger.error("Failed to request ephemeral key", {
        error: error.message,
      });

      return {
        success: false,
        error: this.mapAzureError(error),
      };
    }
  }

  getCurrentKey(): EphemeralKeyInfo | undefined {
    if (!this.currentKey) {
      return undefined;
    }

    // Update real-time validity
    const now = new Date();
    const isValid = now < this.currentKey.expiresAt;
    const secondsRemaining = Math.max(
      0,
      Math.floor((this.currentKey.expiresAt.getTime() - now.getTime()) / 1000),
    );
    const secondsUntilRefresh = Math.max(
      0,
      Math.floor((this.currentKey.refreshAt.getTime() - now.getTime()) / 1000),
    );

    this.currentKey.isValid = isValid;
    this.currentKey.secondsRemaining = secondsRemaining;
    this.currentKey.secondsUntilRefresh = secondsUntilRefresh;

    return {
      ...this.currentKey,
    };
  }

  async renewKey(): Promise<EphemeralKeyResult> {
    this.logger.info("Renewing ephemeral key");
    return this.requestEphemeralKey();
  }

  async revokeCurrentKey(): Promise<void> {
    if (this.currentKey) {
      const expiredSnapshot: EphemeralKeyInfo = {
        ...this.getCurrentKey()!,
        isValid: false,
        secondsRemaining: 0,
        secondsUntilRefresh: 0,
      };
      try {
        await this.endSession(this.currentKey.sessionId);
      } catch (error: any) {
        this.logger.warn("Failed to end session during key revocation", {
          sessionId: this.currentKey.sessionId,
          error: error.message,
        });
      }

      this.currentKey = undefined;

      if (this.renewalTimer) {
        clearTimeout(this.renewalTimer);
        this.renewalTimer = undefined;
      }

      this.logger.info("Current key revoked");
      void this.dispatchKeyExpired(expiredSnapshot);
    }
  }

  // Session management
  async createRealtimeSession(): Promise<RealtimeSessionInfo> {
    if (!this.currentKey || !this.isKeyValid()) {
      const result = await this.requestEphemeralKey();
      if (!result.success) {
        throw new Error(`Cannot create session: ${result.error?.message}`);
      }
    }

    const config = this.configManager.getAzureOpenAIConfig();
    const webrtcUrl = `https://${config.region}.realtimeapi-preview.ai.azure.com/v1/realtimertc`;
    const keyInfo = this.getCurrentKey();

    if (!keyInfo) {
      throw new Error("Ephemeral key metadata unavailable after acquisition");
    }

    return {
      sessionId: keyInfo.sessionId,
      ephemeralKey: keyInfo.key,
      webrtcUrl,
      expiresAt: keyInfo.expiresAt,
      issuedAt: keyInfo.issuedAt,
      refreshAt: keyInfo.refreshAt,
      refreshIntervalMs: this.config.proactiveRenewalIntervalMs,
      keyInfo,
    };
  }

  async endSession(sessionId: string): Promise<void> {
    try {
      const config = this.configManager.getAzureOpenAIConfig();
      const sessionPreferences =
        this.configManager.getRealtimeSessionPreferences();
      const apiKey = await this.credentialManager.getAzureOpenAIKey();
      const apiVersion = sessionPreferences.apiVersion;

      if (apiKey) {
        // Notify Azure to end session
        const response = await this.executeAuthOperation(
          () =>
            fetch(
              `${config.endpoint}/openai/realtimeapi/sessions/${sessionId}?api-version=${apiVersion}`,
              {
                method: "DELETE",
                headers: { "api-key": apiKey },
              },
            ),
          {
            code: "AUTH_SESSION_TERMINATION_FAILED",
            message: "Failed to terminate Azure realtime session",
            remediation:
              "Validate network connectivity and Azure session state before retrying.",
            operation: "endSession",
            severity: "warning",
            userImpact: "degraded",
            metadata: {
              sessionId,
              endpoint: config.endpoint,
            },
            retry: {
              policy: "immediate",
              maxAttempts: 2,
              initialDelayMs: 250,
            },
          },
        );

        if (!response.ok) {
          this.logger.warn("Azure session deletion returned non-OK status", {
            sessionId,
            status: response.status,
          });
        }
      }

      this.logger.info("Session ended successfully", { sessionId });
    } catch (error: any) {
      this.logger.warn("Failed to end session gracefully", {
        sessionId,
        error: error.message,
      });
    }
  }

  // Lifecycle and diagnostics
  isKeyValid(): boolean {
    if (!this.currentKey) {
      return false;
    }
    return new Date() < this.currentKey.expiresAt;
  }

  getKeyExpiration(): Date | undefined {
    return this.currentKey?.expiresAt;
  }

  async testAuthentication(): Promise<AuthenticationTestResult> {
    const config = this.configManager.getAzureOpenAIConfig();
    const apiKey = await this.credentialManager.getAzureOpenAIKey();

    const result: AuthenticationTestResult = {
      success: false,
      endpoint: config.endpoint,
      region: config.region,
      hasValidCredentials: !!apiKey,
      canCreateSessions: false,
    };

    if (!apiKey) {
      result.error = "No Azure OpenAI API key configured";
      return result;
    }

    try {
      const startTime = Date.now();
      const sessionPreferences =
        this.configManager.getRealtimeSessionPreferences();
      const realtimeConfig = this.configManager.getAzureRealtimeConfig();
      const inputFormat = realtimeConfig.inputAudioFormat ?? "pcm16";

      const sessionRequest: AzureSessionRequest = {
        model: config.deploymentName,
        voice: sessionPreferences.voice,
        input_audio_format: inputFormat,
        output_audio_format: inputFormat,
        turn_detection: sessionPreferences.turnDetection,
      };

      // Test session creation
      const response = await fetch(
        `${config.endpoint}/openai/realtimeapi/sessions?api-version=${sessionPreferences.apiVersion}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify(sessionRequest),
        },
      );

      result.latencyMs = Date.now() - startTime;

      if (response.ok) {
        const sessionData = await response.json();
        result.success = true;
        result.canCreateSessions = true;

        // Clean up test session
        try {
          await this.endSession(sessionData.id);
        } catch {
          // Ignore cleanup errors
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        result.error = `HTTP ${response.status}: ${errorData.error?.message || "Unknown error"}`;
      }
    } catch (error: any) {
      result.error = `Network error: ${error.message}`;
    }

    return result;
  }

  // Event handling
  onKeyRenewed(handler: KeyRenewalHandler): vscode.Disposable {
    this.keyRenewalHandlers.add(handler);
    return {
      dispose: () => {
        this.keyRenewalHandlers.delete(handler);
      },
    };
  }

  onKeyExpired(handler: KeyExpirationHandler): vscode.Disposable {
    this.keyExpirationHandlers.add(handler);
    return {
      dispose: () => {
        this.keyExpirationHandlers.delete(handler);
      },
    };
  }

  onAuthenticationError(
    handler: AuthenticationErrorHandler,
  ): vscode.Disposable {
    this.authErrorHandlers.add(handler);
    return {
      dispose: () => {
        this.authErrorHandlers.delete(handler);
      },
    };
  }

  // Private implementation methods
  private async createAzureSession(
    config: AzureOpenAIConfig,
    apiKey: string,
  ): Promise<AzureSessionResponse> {
    const sessionPreferences =
      this.configManager.getRealtimeSessionPreferences();
    const realtimeConfig = this.configManager.getAzureRealtimeConfig();
    const inputFormat = realtimeConfig.inputAudioFormat ?? "pcm16";

    const sessionRequest: AzureSessionRequest = {
      model: config.deploymentName,
      voice: sessionPreferences.voice,
      input_audio_format: inputFormat,
      output_audio_format: inputFormat,
      turn_detection: sessionPreferences.turnDetection,
    };

    const response = await fetch(
      `${config.endpoint}/openai/realtimeapi/sessions?api-version=${sessionPreferences.apiVersion}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(sessionRequest),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Azure Sessions API error: ${response.status} - ${errorData.error?.message || "Unknown error"}`,
      );
    }

    return await response.json();
  }

  private scheduleRenewal(): void {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    const currentKey = this.currentKey;
    if (!currentKey) {
      return;
    }

    const refreshDelay = Math.max(
      1000,
      currentKey.refreshAt.getTime() - Date.now(),
    );

    this.renewalTimer = setTimeout(async () => {
      this.logger.info("Automatic key renewal triggered");
      const result = await this.renewKey();

      if (!result.success) {
        this.logger.error("Automatic key renewal failed", result.error);
        for (const handler of this.authErrorHandlers) {
          try {
            await handler(result.error!);
          } catch (error: any) {
            this.logger.error("Authentication error handler failed", {
              error: error.message,
            });
          }
        }
      }
    }, refreshDelay);

    this.logger.debug("Key renewal scheduled", {
      refreshAt: currentKey.refreshAt.toISOString(),
      secondsUntilRefresh: Math.max(
        0,
        Math.floor((currentKey.refreshAt.getTime() - Date.now()) / 1000),
      ),
      marginSeconds: this.config.renewalMarginSeconds,
      proactiveIntervalMs: this.config.proactiveRenewalIntervalMs,
    });
  }

  private async dispatchKeyRenewed(result: EphemeralKeyResult): Promise<void> {
    const currentKey = this.getCurrentKey();
    const enrichedResult = currentKey
      ? {
          ...result,
          expiresAt: currentKey.expiresAt,
          issuedAt: currentKey.issuedAt,
          refreshAt: currentKey.refreshAt,
          secondsUntilRefresh: currentKey.secondsUntilRefresh,
          refreshIntervalSeconds: currentKey.refreshIntervalSeconds,
        }
      : result;

    for (const handler of this.keyRenewalHandlers) {
      try {
        await handler(enrichedResult);
      } catch (error: any) {
        this.logger.error("Key renewal handler failed", {
          error: error.message,
        });
      }
    }
  }

  private async dispatchKeyExpired(info: EphemeralKeyInfo): Promise<void> {
    for (const handler of this.keyExpirationHandlers) {
      try {
        await handler(info);
      } catch (error: any) {
        this.logger.error("Key expiration handler failed", {
          error: error.message,
        });
      }
    }
  }

  private mapAzureError(error: any): AuthenticationError {
    if (
      (error as VoicePilotError)?.code &&
      (error as VoicePilotError)?.remediation
    ) {
      const voiceError = error as VoicePilotError;
      const retryable = voiceError.retryPlan
        ? voiceError.retryPlan.policy !== "none" &&
          voiceError.retryPlan.attempt < voiceError.retryPlan.maxAttempts
        : true;
      return {
        code: voiceError.code,
        message: voiceError.message,
        isRetryable: retryable,
        remediation: voiceError.remediation,
        azureErrorDetails: voiceError.metadata,
        voicePilotError: voiceError,
      };
    }

    // Map Azure-specific errors to standardized error format
    if (error.message?.includes("401")) {
      return {
        code: "INVALID_CREDENTIALS",
        message: "Azure OpenAI API key is invalid or expired",
        isRetryable: false,
        remediation: "Update Azure OpenAI API key in credential settings",
      };
    }

    if (error.message?.includes("403")) {
      return {
        code: "INSUFFICIENT_PERMISSIONS",
        message: "API key lacks necessary permissions for Realtime API",
        isRetryable: false,
        remediation: "Ensure API key has Cognitive Services OpenAI User role",
      };
    }

    if (error.message?.includes("429")) {
      return {
        code: "RATE_LIMITED",
        message: "Too many requests to Azure OpenAI service",
        isRetryable: true,
        remediation:
          "Wait before retrying, consider upgrading Azure resource tier",
      };
    }

    if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
      return {
        code: "NETWORK_ERROR",
        message: "Cannot connect to Azure OpenAI service",
        isRetryable: true,
        remediation:
          "Check network connectivity and Azure endpoint configuration",
      };
    }

    return {
      code: "UNKNOWN_ERROR",
      message: error.message || "Unknown authentication error",
      isRetryable: true,
      remediation: "Check Azure service status and configuration",
      azureErrorDetails: error,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "EphemeralKeyService not initialized. Call initialize() first.",
      );
    }
  }
}

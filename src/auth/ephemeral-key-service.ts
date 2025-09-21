import * as vscode from 'vscode';
import { ConfigurationManager } from '../config/configuration-manager';
import { Logger } from '../core/logger';
import { AzureOpenAIConfig } from '../types/configuration';
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
    RealtimeSessionInfo
} from '../types/ephemeral';
import { CredentialManagerImpl } from './credential-manager';

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

  // Event handlers
  private keyRenewalHandlers: Set<KeyRenewalHandler> = new Set();
  private keyExpirationHandlers: Set<KeyExpirationHandler> = new Set();
  private authErrorHandlers: Set<AuthenticationErrorHandler> = new Set();

  // Service configuration
  private config: EphemeralKeyServiceConfig = {
    renewalMarginSeconds: 10,
    maxRetryAttempts: 3,
    retryBackoffMs: 1000,
    sessionTimeoutMs: 300000 // 5 minutes
  };

  constructor(
    credentialManager?: CredentialManagerImpl,
    configManager?: ConfigurationManager,
    logger?: Logger
  ) {
    if (credentialManager) {
      this.credentialManager = credentialManager;
    }
    if (configManager) {
      this.configManager = configManager;
    }
    // Always ensure a logger instance exists to avoid undefined access during initialize
    this.logger = logger ?? new Logger('EphemeralKeyService');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing EphemeralKeyService');

    // Validate dependencies
    if (!this.credentialManager || !this.credentialManager.isInitialized()) {
      throw new Error('CredentialManager must be initialized before EphemeralKeyService');
    }

    if (!this.configManager || !this.configManager.isInitialized()) {
      throw new Error('ConfigurationManager must be initialized before EphemeralKeyService');
    }

    // Test authentication capability
    try {
      const testResult = await this.testAuthentication();
      if (!testResult.success) {
        this.logger.error('Authentication test failed', testResult);
        throw new Error(`Authentication test failed: ${testResult.error}`);
      }
    } catch (error: any) {
      this.logger.error('Failed to test authentication during initialization', { error: error.message });
      throw new Error(`Authentication initialization failed: ${error.message}`);
    }

    this.initialized = true;
    this.logger.info('EphemeralKeyService initialized successfully');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info('Disposing EphemeralKeyService');

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
    this.logger.info('EphemeralKeyService disposed');
  }

  // Primary authentication operations
  async requestEphemeralKey(): Promise<EphemeralKeyResult> {
    this.ensureInitialized();

    try {
      const config = this.configManager.getAzureOpenAIConfig();
      const apiKey = await this.credentialManager.getAzureOpenAIKey();

      if (!apiKey) {
        return {
          success: false,
          error: {
            code: 'MISSING_CREDENTIALS',
            message: 'Azure OpenAI API key not configured',
            isRetryable: false,
            remediation: 'Configure Azure OpenAI credentials in settings'
          }
        };
      }

      // Create session using Azure Sessions API
      const sessionResponse = await this.createAzureSession(config, apiKey);

      const ephemeralKey = sessionResponse.client_secret.value;
      const expiresAt = new Date(sessionResponse.client_secret.expires_at * 1000);

      // Store current key info
      this.currentKey = {
        key: ephemeralKey,
        sessionId: sessionResponse.id,
        issuedAt: new Date(),
        expiresAt,
        isValid: true,
        secondsRemaining: Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      };

      // Schedule automatic renewal
      this.scheduleRenewal();

      this.logger.info('Ephemeral key requested successfully', {
        sessionId: sessionResponse.id,
        expiresAt: expiresAt.toISOString()
      });

      return {
        success: true,
        ephemeralKey,
        sessionId: sessionResponse.id,
        expiresAt
      };

    } catch (error: any) {
      this.logger.error('Failed to request ephemeral key', { error: error.message });

      return {
        success: false,
        error: this.mapAzureError(error)
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
    const secondsRemaining = Math.max(0, Math.floor((this.currentKey.expiresAt.getTime() - now.getTime()) / 1000));

    return {
      ...this.currentKey,
      isValid,
      secondsRemaining
    };
  }

  async renewKey(): Promise<EphemeralKeyResult> {
    this.logger.info('Renewing ephemeral key');
    return this.requestEphemeralKey();
  }

  async revokeCurrentKey(): Promise<void> {
    if (this.currentKey) {
      try {
        await this.endSession(this.currentKey.sessionId);
      } catch (error: any) {
        this.logger.warn('Failed to end session during key revocation', {
          sessionId: this.currentKey.sessionId,
          error: error.message
        });
      }

      this.currentKey = undefined;

      if (this.renewalTimer) {
        clearTimeout(this.renewalTimer);
        this.renewalTimer = undefined;
      }

      this.logger.info('Current key revoked');
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

    return {
      sessionId: this.currentKey!.sessionId,
      ephemeralKey: this.currentKey!.key,
      webrtcUrl,
      expiresAt: this.currentKey!.expiresAt
    };
  }

  async endSession(sessionId: string): Promise<void> {
    try {
      const config = this.configManager.getAzureOpenAIConfig();
      const apiKey = await this.credentialManager.getAzureOpenAIKey();

      if (apiKey) {
        // Notify Azure to end session
        const response = await fetch(
          `${config.endpoint}/openai/realtimeapi/sessions/${sessionId}?api-version=${config.apiVersion || '2025-04-01-preview'}`,
          {
            method: 'DELETE',
            headers: { 'api-key': apiKey }
          }
        );

        if (!response.ok) {
          this.logger.warn('Azure session deletion returned non-OK status', {
            sessionId,
            status: response.status
          });
        }
      }

      this.logger.info('Session ended successfully', { sessionId });
    } catch (error: any) {
      this.logger.warn('Failed to end session gracefully', { sessionId, error: error.message });
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
      canCreateSessions: false
    };

    if (!apiKey) {
      result.error = 'No Azure OpenAI API key configured';
      return result;
    }

    try {
      const startTime = Date.now();

      // Test session creation
      const response = await fetch(
        `${config.endpoint}/openai/realtimeapi/sessions?api-version=${config.apiVersion || '2025-04-01-preview'}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          },
          body: JSON.stringify({
            model: config.deploymentName,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16'
          } as AzureSessionRequest)
        }
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
        result.error = `HTTP ${response.status}: ${errorData.error?.message || 'Unknown error'}`;
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
      }
    };
  }

  onKeyExpired(handler: KeyExpirationHandler): vscode.Disposable {
    this.keyExpirationHandlers.add(handler);
    return {
      dispose: () => {
        this.keyExpirationHandlers.delete(handler);
      }
    };
  }

  onAuthenticationError(handler: AuthenticationErrorHandler): vscode.Disposable {
    this.authErrorHandlers.add(handler);
    return {
      dispose: () => {
        this.authErrorHandlers.delete(handler);
      }
    };
  }

  // Private implementation methods
  private async createAzureSession(config: AzureOpenAIConfig, apiKey: string): Promise<AzureSessionResponse> {
    const sessionRequest: AzureSessionRequest = {
      model: config.deploymentName,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200
      }
    };

    const response = await fetch(
      `${config.endpoint}/openai/realtimeapi/sessions?api-version=${config.apiVersion || '2025-04-01-preview'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify(sessionRequest)
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Azure Sessions API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    return await response.json();
  }

  private scheduleRenewal(): void {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    if (!this.currentKey) {
      return;
    }

    // Schedule renewal with safety margin
    const renewalTime = this.currentKey.expiresAt.getTime() - Date.now() - (this.config.renewalMarginSeconds * 1000);

    if (renewalTime > 0) {
      this.renewalTimer = setTimeout(async () => {
        this.logger.info('Automatic key renewal triggered');
        const result = await this.renewKey();

        if (result.success) {
          for (const handler of this.keyRenewalHandlers) {
            try {
              await handler(result);
            } catch (error: any) {
              this.logger.error('Key renewal handler failed', { error: error.message });
            }
          }
        } else {
          this.logger.error('Automatic key renewal failed', result.error);
          for (const handler of this.authErrorHandlers) {
            try {
              await handler(result.error!);
            } catch (error: any) {
              this.logger.error('Authentication error handler failed', { error: error.message });
            }
          }
        }
      }, renewalTime);

      this.logger.debug('Key renewal scheduled', {
        renewalTime: new Date(Date.now() + renewalTime).toISOString(),
        marginSeconds: this.config.renewalMarginSeconds
      });
    }
  }

  private async requestEphemeralKeyWithRetry(): Promise<EphemeralKeyResult> {
    let backoffMs = this.config.retryBackoffMs;

    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      const result = await this.requestEphemeralKey();

      if (result.success || !result.error?.isRetryable) {
        return result;
      }

      if (attempt < this.config.maxRetryAttempts) {
        this.logger.warn(`Key request attempt ${attempt} failed, retrying in ${backoffMs}ms`, result.error);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        backoffMs *= 2; // Exponential backoff
      }
    }

    this.logger.error(`All ${this.config.maxRetryAttempts} key request attempts failed`);
    return {
      success: false,
      error: {
        code: 'MAX_RETRIES_EXCEEDED',
        message: `Failed to obtain ephemeral key after ${this.config.maxRetryAttempts} attempts`,
        isRetryable: true,
        remediation: 'Check network connectivity and Azure service status'
      }
    };
  }

  private mapAzureError(error: any): AuthenticationError {
    // Map Azure-specific errors to standardized error format
    if (error.message?.includes('401')) {
      return {
        code: 'INVALID_CREDENTIALS',
        message: 'Azure OpenAI API key is invalid or expired',
        isRetryable: false,
        remediation: 'Update Azure OpenAI API key in credential settings'
      };
    }

    if (error.message?.includes('403')) {
      return {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'API key lacks necessary permissions for Realtime API',
        isRetryable: false,
        remediation: 'Ensure API key has Cognitive Services OpenAI User role'
      };
    }

    if (error.message?.includes('429')) {
      return {
        code: 'RATE_LIMITED',
        message: 'Too many requests to Azure OpenAI service',
        isRetryable: true,
        remediation: 'Wait before retrying, consider upgrading Azure resource tier'
      };
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return {
        code: 'NETWORK_ERROR',
        message: 'Cannot connect to Azure OpenAI service',
        isRetryable: true,
        remediation: 'Check network connectivity and Azure endpoint configuration'
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: error.message || 'Unknown authentication error',
      isRetryable: true,
      remediation: 'Check Azure service status and configuration',
      azureErrorDetails: error
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('EphemeralKeyService not initialized. Call initialize() first.');
    }
  }
}

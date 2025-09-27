import { Logger } from "../core/logger";
import {
  WebRTCConfig,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  WebRTCTransport,
} from "../types/webrtc";

/**
 * Manages connection recovery for WebRTC transport
 * Implements exponential backoff, error classification, and reconnection strategies
 */
export class ConnectionRecoveryManager {
  private logger: Logger;
  private isRecovering = false;
  private currentAttempt = 0;
  private maxAttempts = 3;
  private baseDelayMs = 1000;
  private maxDelayMs = 10000;
  private backoffMultiplier = 2;

  // Recovery state tracking
  private lastConnectionTime: number = 0;
  private successiveFailures = 0;
  private totalRecoveryAttempts = 0;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("ConnectionRecoveryManager");
  }

  /**
   * Configure recovery strategy parameters
   */
  configure(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  }): void {
    this.maxAttempts = options.maxAttempts ?? this.maxAttempts;
    this.baseDelayMs = options.baseDelayMs ?? this.baseDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? this.maxDelayMs;
    this.backoffMultiplier =
      options.backoffMultiplier ?? this.backoffMultiplier;

    this.logger.debug("Recovery strategy configured", {
      maxAttempts: this.maxAttempts,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
      backoffMultiplier: this.backoffMultiplier,
    });
  }

  /**
   * Handle connection failure and attempt recovery
   */
  async handleConnectionFailure(
    transport: WebRTCTransport,
    config: WebRTCConfig,
    error: WebRTCErrorImpl,
  ): Promise<boolean> {
    if (this.isRecovering) {
      this.logger.warn("Recovery already in progress, skipping");
      return false;
    }

    if (!this.isRecoverableError(error)) {
      this.logger.info("Error is not recoverable, skipping recovery", {
        errorCode: error.code,
      });
      return false;
    }

    if (this.currentAttempt >= this.maxAttempts) {
      this.logger.error("Maximum recovery attempts exceeded", {
        attempts: this.currentAttempt,
        maxAttempts: this.maxAttempts,
      });
      this.reset();
      return false;
    }

    this.isRecovering = true;
    this.successiveFailures++;
    this.totalRecoveryAttempts++;

    try {
      const success = await this.attemptRecovery(transport, config, error);

      if (success) {
        this.onRecoverySuccess();
        return true;
      } else {
        this.onRecoveryFailure();
        return false;
      }
    } catch (recoveryError: any) {
      this.logger.error("Recovery attempt failed with exception", {
        error: recoveryError.message,
      });
      this.onRecoveryFailure();
      return false;
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Reset recovery state
   */
  reset(): void {
    this.isRecovering = false;
    this.currentAttempt = 0;
    this.successiveFailures = 0;
    this.logger.debug("Recovery state reset");
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): {
    isRecovering: boolean;
    currentAttempt: number;
    successiveFailures: number;
    totalRecoveryAttempts: number;
    lastConnectionTime: number;
  } {
    return {
      isRecovering: this.isRecovering,
      currentAttempt: this.currentAttempt,
      successiveFailures: this.successiveFailures,
      totalRecoveryAttempts: this.totalRecoveryAttempts,
      lastConnectionTime: this.lastConnectionTime,
    };
  }

  /**
   * Check if an error is recoverable
   */
  private isRecoverableError(error: WebRTCErrorImpl): boolean {
    switch (error.code) {
      case WebRTCErrorCode.NetworkTimeout:
      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.DataChannelFailed:
        return true;

      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
      case WebRTCErrorCode.SdpNegotiationFailed:
        return false;

      default:
        return error.recoverable;
    }
  }

  /**
   * Attempt connection recovery with exponential backoff
   */
  private async attemptRecovery(
    transport: WebRTCTransport,
    config: WebRTCConfig,
    originalError: WebRTCErrorImpl,
  ): Promise<boolean> {
    while (this.currentAttempt < this.maxAttempts) {
      this.currentAttempt++;

      const delay = this.calculateBackoffDelay();

      this.logger.info("Starting recovery attempt", {
        attempt: this.currentAttempt,
        maxAttempts: this.maxAttempts,
        delayMs: delay,
        originalError: originalError.code,
      });

      // Wait before attempting recovery
      if (delay > 0) {
        await this.delay(delay);
      }

      try {
        // Apply recovery strategy based on error type
        const recoveryStrategy = this.selectRecoveryStrategy(originalError);
        const success = await this.executeRecoveryStrategy(
          transport,
          config,
          recoveryStrategy,
        );

        if (success) {
          this.logger.info("Recovery successful", {
            attempt: this.currentAttempt,
            strategy: recoveryStrategy,
          });
          return true;
        }
      } catch (error: any) {
        this.logger.warn("Recovery attempt failed", {
          attempt: this.currentAttempt,
          error: error.message,
        });
      }
    }

    this.logger.error("All recovery attempts failed", {
      totalAttempts: this.currentAttempt,
      maxAttempts: this.maxAttempts,
    });

    return false;
  }

  /**
   * Select appropriate recovery strategy based on error type
   */
  private selectRecoveryStrategy(error: WebRTCErrorImpl): RecoveryStrategy {
    switch (error.code) {
      case WebRTCErrorCode.NetworkTimeout:
        return "retry_connection";

      case WebRTCErrorCode.IceConnectionFailed:
        return "restart_ice";

      case WebRTCErrorCode.DataChannelFailed:
        return "recreate_datachannel";

      default:
        return "full_reconnect";
    }
  }

  /**
   * Execute specific recovery strategy
   */
  private async executeRecoveryStrategy(
    transport: WebRTCTransport,
    config: WebRTCConfig,
    strategy: RecoveryStrategy,
  ): Promise<boolean> {
    this.logger.debug("Executing recovery strategy", { strategy });

    switch (strategy) {
      case "retry_connection":
        return this.retryConnection(transport, config);

      case "restart_ice":
        return this.restartIceConnection(transport, config);

      case "recreate_datachannel":
        return this.recreateDataChannel(transport, config);

      case "full_reconnect":
        return this.fullReconnect(transport, config);

      default:
        this.logger.error("Unknown recovery strategy", { strategy });
        return false;
    }
  }

  /**
   * Retry connection with current configuration
   */
  private async retryConnection(
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<boolean> {
    try {
      await transport.closeConnection();
      const result = await transport.establishConnection(config);
      return result.success;
    } catch (error: any) {
      this.logger.warn("Retry connection failed", { error: error.message });
      return false;
    }
  }

  /**
   * Restart ICE connection
   */
  private async restartIceConnection(
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<boolean> {
    try {
      // Note: This would require access to peer connection internals
      // For now, fall back to full reconnect
      return this.fullReconnect(transport, config);
    } catch (error: any) {
      this.logger.warn("ICE restart failed", { error: error.message });
      return false;
    }
  }

  /**
   * Recreate data channel
   */
  private async recreateDataChannel(
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<boolean> {
    try {
      // Note: This would require access to peer connection internals
      // For now, fall back to full reconnect
      return this.fullReconnect(transport, config);
    } catch (error: any) {
      this.logger.warn("Data channel recreation failed", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Full reconnection with clean state
   */
  private async fullReconnect(
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<boolean> {
    try {
      // Ensure clean state
      await transport.closeConnection();

      // Wait a bit before reconnecting
      await this.delay(500);

      // Attempt new connection
      const result = await transport.establishConnection(config);
      return result.success;
    } catch (error: any) {
      this.logger.warn("Full reconnect failed", { error: error.message });
      return false;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(): number {
    if (this.currentAttempt === 1) {
      return 0; // First attempt immediately
    }

    const exponentialDelay =
      this.baseDelayMs *
      Math.pow(this.backoffMultiplier, this.currentAttempt - 2);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * exponentialDelay;

    const totalDelay = Math.min(exponentialDelay + jitter, this.maxDelayMs);

    return Math.floor(totalDelay);
  }

  /**
   * Handle successful recovery
   */
  private onRecoverySuccess(): void {
    this.lastConnectionTime = Date.now();
    this.successiveFailures = 0;
    this.currentAttempt = 0;

    this.logger.info("Connection recovery successful", {
      totalAttempts: this.totalRecoveryAttempts,
      lastConnectionTime: this.lastConnectionTime,
    });
  }

  /**
   * Handle recovery failure
   */
  private onRecoveryFailure(): void {
    this.logger.warn("Connection recovery failed", {
      attempt: this.currentAttempt,
      successiveFailures: this.successiveFailures,
    });
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

type RecoveryStrategy =
  | "retry_connection"
  | "restart_ice"
  | "recreate_datachannel"
  | "full_reconnect";

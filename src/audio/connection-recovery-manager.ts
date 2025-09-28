import { Logger } from "../core/logger";
import {
    RecoveryStrategy,
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
  private readonly observers = new Set<ConnectionRecoveryObserver>();

  // Recovery state tracking
  private lastConnectionTime: number = 0;
  private successiveFailures = 0;
  private totalRecoveryAttempts = 0;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("ConnectionRecoveryManager");
  }

  addObserver(observer: ConnectionRecoveryObserver): { dispose: () => void } {
    this.observers.add(observer);

    return {
      dispose: () => {
        this.observers.delete(observer);
      },
    };
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
      const strategy = this.selectRecoveryStrategy(originalError);

      this.logger.info("Starting recovery attempt", {
        attempt: this.currentAttempt,
        maxAttempts: this.maxAttempts,
        delayMs: delay,
        originalError: originalError.code,
        strategy,
      });

      this.notifyObservers({
        type: "attempt",
        attempt: this.currentAttempt,
        strategy,
        delayMs: delay,
      });
      transport.publishRecoveryEvent({
        type: "reconnectAttempt",
        attempt: this.currentAttempt,
        strategy,
        delayMs: delay,
      });

      if (delay > 0) {
        await this.delay(delay);
      }

      const attemptStartedAt = Date.now();

      try {
        const success = await this.executeRecoveryStrategy(
          transport,
          config,
          strategy,
        );

        const durationMs = Date.now() - attemptStartedAt;

        if (success) {
          this.logger.info("Recovery successful", {
            attempt: this.currentAttempt,
            strategy,
            durationMs,
          });

          this.notifyObservers({
            type: "success",
            attempt: this.currentAttempt,
            strategy,
            durationMs,
          });
          transport.publishRecoveryEvent({
            type: "reconnectSucceeded",
            attempt: this.currentAttempt,
            strategy,
            durationMs,
          });

          return true;
        }

        this.logger.warn("Recovery attempt did not succeed", {
          attempt: this.currentAttempt,
          strategy,
          durationMs,
        });

        this.notifyObservers({
          type: "failure",
          attempt: this.currentAttempt,
          strategy,
          durationMs,
        });
        transport.publishRecoveryEvent({
          type: "reconnectFailed",
          attempt: this.currentAttempt,
          strategy,
          durationMs,
        });
      } catch (error: any) {
        const durationMs = Date.now() - attemptStartedAt;
        this.logger.warn("Recovery attempt failed", {
          attempt: this.currentAttempt,
          error: error.message,
          strategy,
        });

        this.notifyObservers({
          type: "failure",
          attempt: this.currentAttempt,
          strategy,
          durationMs,
          error,
        });
        transport.publishRecoveryEvent({
          type: "reconnectFailed",
          attempt: this.currentAttempt,
          strategy,
          durationMs,
          error,
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
      const restarted = await transport.restartIce(config);

      if (!restarted) {
        this.logger.warn("ICE restart request returned unsuccessful flag");
      }

      return restarted;
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
      const channel = await transport.recreateDataChannel(config);

      if (!channel) {
        this.logger.warn("Data channel recreation returned null channel");
      }

      return !!channel;
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

  private notifyObservers(event: ConnectionRecoveryEvent): void {
    for (const observer of Array.from(this.observers)) {
      try {
        observer(event);
      } catch (error: any) {
        this.logger.debug("Recovery observer threw", {
          error: error?.message ?? error,
        });
      }
    }
  }
}

export type ConnectionRecoveryEvent =
  | {
      type: "attempt";
      attempt: number;
      strategy: RecoveryStrategy;
      delayMs: number;
    }
  | {
      type: "success" | "failure";
      attempt: number;
      strategy: RecoveryStrategy;
      durationMs: number;
      error?: unknown;
    };

export type ConnectionRecoveryObserver = (
  event: ConnectionRecoveryEvent,
) => void;

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

  /**
   * Registers an observer that will be notified of recovery lifecycle events.
   * @param observer - Function invoked when recovery attempts progress or conclude.
   * @returns Disposable handle for unregistering the observer.
   */
  addObserver(observer: ConnectionRecoveryObserver): { dispose: () => void } {
    this.observers.add(observer);

    return {
      dispose: () => {
        this.observers.delete(observer);
      },
    };
  }

  /**
   * Configures recovery strategy parameters, overriding any previously supplied values.
   * @param options - Partial set of recovery tuning parameters to apply.
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
   * Handles a transport failure by executing the configured recovery workflow.
   * @param transport - WebRTC transport for issuing recovery operations.
   * @param config - Current transport configuration used when re-establishing connections.
   * @param error - Error that triggered the recovery sequence.
   * @returns `true` when recovery succeeds, otherwise `false`.
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
   * Resets internal state so future recovery attempts start from the initial attempt count.
   */
  reset(): void {
    this.isRecovering = false;
    this.currentAttempt = 0;
    this.successiveFailures = 0;
    this.logger.debug("Recovery state reset");
  }

  /**
   * Builds a snapshot of the current recovery metrics.
   * @returns Recovery status, counters, and timestamps.
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
   * Determines whether the supplied error can be handled by the recovery workflow.
   * @param error - Error raised by the transport.
   * @returns `true` if the error is recoverable.
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
   * Attempts transport recovery using exponential backoff and strategy selection.
   * @param transport - Transport instance to recover.
   * @param config - Transport configuration for reconnection.
   * @param originalError - Error that initiated the recovery process.
   * @returns `true` when recovery is successful.
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
   * Selects the appropriate recovery strategy based on the originating error code.
   * @param error - Error thrown by the transport.
   * @returns Recovery strategy identifier.
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
   * Executes the supplied recovery strategy against the transport.
   * @param transport - WebRTC transport targeted for recovery.
   * @param config - Active transport configuration.
   * @param strategy - Strategy to execute for recovery.
   * @returns `true` when the strategy completes successfully.
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
   * Attempts to reconnect the transport using the existing configuration.
   * @param transport - WebRTC transport to reconnect.
   * @param config - WebRTC configuration used for reconnection.
   * @returns `true` when the connection is re-established successfully.
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
   * Requests an ICE restart from the transport.
   * @param transport - WebRTC transport undergoing recovery.
   * @param config - Transport configuration passed to the restart call.
   * @returns `true` when the restart succeeds.
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
   * Recreates the transport data channel.
   * @param transport - WebRTC transport in recovery.
   * @param config - Configuration context for the data channel recreation.
   * @returns `true` when a channel is available after recreation.
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
   * Tears down the transport and establishes a fresh connection.
   * @param transport - WebRTC transport to reconnect.
   * @param config - Configuration for the new connection attempt.
   * @returns `true` when reconnection succeeds.
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
   * Calculates the delay for the next recovery attempt using exponential backoff with jitter.
   * @returns Delay in milliseconds before the next attempt.
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
   * Updates state following a successful recovery attempt.
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
   * Logs and retains state when a recovery attempt fails.
   */
  private onRecoveryFailure(): void {
    this.logger.warn("Connection recovery failed", {
      attempt: this.currentAttempt,
      successiveFailures: this.successiveFailures,
    });
  }

  /**
   * Suspends execution for the specified duration.
   * @param ms - Number of milliseconds to wait.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Notifies registered observers of the latest recovery lifecycle event.
   * @param event - Recovery event to broadcast.
   */
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

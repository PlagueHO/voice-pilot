import { Logger } from "../core/logger";
import {
  WebRTCConfig,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  WebRTCTransport,
} from "../types/webrtc";
import {
  ConnectionRecoveryEvent,
  ConnectionRecoveryManager,
  ConnectionRecoveryObserver,
} from "./connection-recovery-manager";

/**
 * Handles WebRTC errors with classification, recovery, and reporting
 */
export class WebRTCErrorHandler {
  private logger: Logger;
  private recoveryManager: ConnectionRecoveryManager;
  private readonly recoveryObservers = new Set<ConnectionRecoveryObserver>();
  private readonly recoverySubscription: { dispose: () => void };

  // Error tracking
  private errorHistory: ErrorHistoryEntry[] = [];
  private maxHistorySize = 100;

  // Error callbacks
  private onAuthenticationErrorCallback?: (
    error: WebRTCErrorImpl,
  ) => Promise<void>;
  private onConnectionErrorCallback?: (error: WebRTCErrorImpl) => Promise<void>;
  private onFatalErrorCallback?: (error: WebRTCErrorImpl) => Promise<void>;

  /**
   * Create a new error handler wired to the shared recovery manager and logger.
   *
   * @param logger - Optional logger instance; defaults to a scoped logger when omitted.
   */
  constructor(logger?: Logger) {
    this.logger = logger || new Logger("WebRTCErrorHandler");
    this.recoveryManager = new ConnectionRecoveryManager(logger);
    this.recoverySubscription = this.recoveryManager.addObserver((event) => {
      this.notifyRecoveryObservers(event);
    });
  }

  /**
   * Handle a classified WebRTC error using the appropriate recovery or escalation strategy.
   *
   * @param error - Error instance to process.
   * @param transport - Transport impacted by the failure.
   * @param config - Connection configuration providing retry context.
   */
  async handleError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logError(error);
    this.addToErrorHistory(error);

    try {
      switch (error.code) {
        case WebRTCErrorCode.AuthenticationFailed:
          await this.handleAuthenticationError(error, transport, config);
          break;

        case WebRTCErrorCode.IceConnectionFailed:
        case WebRTCErrorCode.NetworkTimeout:
          await this.handleConnectionError(error, transport, config);
          break;

        case WebRTCErrorCode.DataChannelFailed:
          await this.handleDataChannelError(error, transport, config);
          break;

        case WebRTCErrorCode.SdpNegotiationFailed:
          await this.handleSdpError(error, transport, config);
          break;

        case WebRTCErrorCode.AudioTrackFailed:
          await this.handleAudioTrackError(error, transport, config);
          break;

        case WebRTCErrorCode.RegionNotSupported:
        case WebRTCErrorCode.ConfigurationInvalid:
          await this.handleFatalError(error);
          break;

        default:
          await this.handleUnknownError(error, transport, config);
          break;
      }
    } catch (handlingError: any) {
      this.logger.error("Error handling failed", {
        originalError: error.code,
        handlingError: handlingError.message,
      });
    }
  }

  /**
   * Classify an arbitrary error into a WebRTC error code.
   *
   * @param error - Unknown error thrown by the media pipeline or browser APIs.
   * @returns Matching WebRTC error code used for downstream handling.
   */
  classifyError(error: any): WebRTCErrorCode {
    // Permission errors
    if (error.name === "NotAllowedError") {
      return WebRTCErrorCode.AuthenticationFailed;
    }

    // Device errors
    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError"
    ) {
      return WebRTCErrorCode.AudioTrackFailed;
    }

    // Network errors
    if (error.name === "NetworkError" || error.code === "NETWORK_FAILURE") {
      return WebRTCErrorCode.NetworkTimeout;
    }

    // SDP errors
    if (
      error.message?.includes("SDP") ||
      error.message?.includes("offer") ||
      error.message?.includes("answer")
    ) {
      return WebRTCErrorCode.SdpNegotiationFailed;
    }

    // ICE errors
    if (
      error.message?.includes("ICE") ||
      error.message?.includes("connection") ||
      error.message?.includes("candidate")
    ) {
      return WebRTCErrorCode.IceConnectionFailed;
    }

    // Data channel errors
    if (
      error.message?.includes("data channel") ||
      error.message?.includes("datachannel")
    ) {
      return WebRTCErrorCode.DataChannelFailed;
    }

    // Timeout errors
    if (error.message?.includes("timeout") || error.name === "TimeoutError") {
      return WebRTCErrorCode.NetworkTimeout;
    }

    // Authentication errors
    if (
      error.message?.includes("401") ||
      error.message?.includes("403") ||
      error.message?.includes("auth")
    ) {
      return WebRTCErrorCode.AuthenticationFailed;
    }

    // Region errors
    if (
      error.message?.includes("region") ||
      error.message?.includes("endpoint")
    ) {
      return WebRTCErrorCode.RegionNotSupported;
    }

    return WebRTCErrorCode.ConfigurationInvalid;
  }

  /**
   * Create a structured WebRTC error wrapper around an unknown error.
   *
   * @param error - Source error thrown by the transport or related APIs.
   * @param recoverable - Optional override for the recoverable flag.
   * @returns Structured WebRTC error with metadata for logging and recovery.
   */
  createWebRTCError(error: any, recoverable?: boolean): WebRTCErrorImpl {
    const code = this.classifyError(error);
    const isRecoverable = recoverable ?? this.isRecoverableErrorCode(code);

    return new WebRTCErrorImpl({
      code,
      message: error.message || "Unknown error",
      details: error,
      recoverable: isRecoverable,
      timestamp: new Date(),
    });
  }

  /**
   * Summarize recent error history for diagnostics.
   *
   * @returns Aggregate error metrics including counts, history, and last occurrence.
   */
  getErrorStatistics(): ErrorStatistics {
    const totalErrors = this.errorHistory.length;
    const errorsByCode = new Map<WebRTCErrorCode, number>();
    const recentErrors = this.errorHistory.filter(
      (entry) => Date.now() - entry.timestamp.getTime() < 300000, // Last 5 minutes
    );

    for (const entry of this.errorHistory) {
      const count = errorsByCode.get(entry.error.code) || 0;
      errorsByCode.set(entry.error.code, count + 1);
    }

    return {
      totalErrors,
      recentErrors: recentErrors.length,
      errorsByCode: Object.fromEntries(errorsByCode),
      lastError: this.errorHistory[this.errorHistory.length - 1]?.error,
      averageErrorsPerHour: this.calculateAverageErrorsPerHour(),
    };
  }

  /**
   * Register a callback for authentication failures requiring token refresh.
   *
   * @param callback - Handler invoked when authentication fails.
   */
  onAuthenticationError(
    callback: (error: WebRTCErrorImpl) => Promise<void>,
  ): void {
    this.onAuthenticationErrorCallback = callback;
  }

  /**
   * Register a callback that runs after connection recovery attempts fail.
   *
   * @param callback - Handler invoked when a recoverable transport failure persists.
   */
  onConnectionError(callback: (error: WebRTCErrorImpl) => Promise<void>): void {
    this.onConnectionErrorCallback = callback;
  }

  /**
   * Register a callback that runs when a non-recoverable error is detected.
   *
   * @param callback - Handler invoked for fatal errors that require user intervention.
   */
  onFatalError(callback: (error: WebRTCErrorImpl) => Promise<void>): void {
    this.onFatalErrorCallback = callback;
  }

  /**
   * Configure recovery manager
   *
   * @param options - Overrides for retry attempt count, delays, and backoff.
   */
  configureRecovery(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  }): void {
    this.recoveryManager.configure(options);
  }

  /**
   * Subscribe to recovery lifecycle events emitted by the recovery manager.
   *
   * @param observer - Callback notified on recovery attempt progress and results.
   * @returns Disposable used to stop receiving recovery notifications.
   */
  onRecoveryEvent(observer: ConnectionRecoveryObserver): {
    dispose: () => void;
  } {
    this.recoveryObservers.add(observer);
    return {
      dispose: () => this.recoveryObservers.delete(observer),
    };
  }

  /**
   * Dispose of recovery subscriptions and observers held by the handler.
   */
  dispose(): void {
    this.recoverySubscription.dispose();
    this.recoveryObservers.clear();
  }

  // Private error handling methods
  /**
   * Resolve authentication-related failures by reissuing credentials if possible.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleAuthenticationError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.warn("Handling authentication error", { error: error.code });

    // Request new ephemeral key through callback
    if (this.onAuthenticationErrorCallback) {
      await this.onAuthenticationErrorCallback(error);
    } else {
      this.logger.error("No authentication error handler configured");
    }
  }

  /**
   * Attempt transport recovery for ICE or timeout failures before surfacing the error.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleConnectionError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.warn("Handling connection error", { error: error.code });

    // Attempt connection recovery
    const recovered = await this.recoveryManager.handleConnectionFailure(
      transport,
      config,
      error,
    );

    if (!recovered && this.onConnectionErrorCallback) {
      await this.onConnectionErrorCallback(error);
    }
  }

  /**
   * Attempt recovery for data channel failures and fall back to audio-only when allowed.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleDataChannelError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.warn("Handling data channel error", { error: error.code });

    const recovered = await this.recoveryManager.handleConnectionFailure(
      transport,
      config,
      error,
    );

    if (recovered) {
      return;
    }

    if (this.isDataChannelOptional()) {
      this.logger.info(
        "Audio-only fallback active after data channel recovery failure",
      );
      return;
    }

    if (this.onConnectionErrorCallback) {
      await this.onConnectionErrorCallback(error);
    }
  }

  /**
   * Escalate SDP negotiation failures, which are treated as non-recoverable.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleSdpError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.error("Handling SDP negotiation error", { error: error.code });

    // SDP errors are usually fatal and require reconnection
    await this.handleFatalError(error);
  }

  /**
   * Surface audio track failures so the caller can prompt the user for remediation.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleAudioTrackError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.error("Handling audio track error", { error: error.code });

    // Audio track errors might require permission request or device change
    if (this.onConnectionErrorCallback) {
      await this.onConnectionErrorCallback(error);
    }
  }

  /**
   * Surface fatal errors via the registered callback without attempting recovery.
   *
   * @param error - Classified WebRTC error instance.
   */
  private async handleFatalError(error: WebRTCErrorImpl): Promise<void> {
    this.logger.error("Handling fatal error", { error: error.code });

    if (this.onFatalErrorCallback) {
      await this.onFatalErrorCallback(error);
    }
  }

  /**
   * Attempt recovery for unclassified errors when marked recoverable, otherwise escalate.
   *
   * @param error - Classified WebRTC error instance.
   * @param transport - Active transport experiencing the failure.
   * @param config - WebRTC configuration used for the connection.
   */
  private async handleUnknownError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.warn("Handling unknown error", { error: error.code });

    // Try recovery for unknown errors if they're marked as recoverable
    if (error.recoverable) {
      await this.recoveryManager.handleConnectionFailure(
        transport,
        config,
        error,
      );
    } else {
      await this.handleFatalError(error);
    }
  }

  /**
   * Determine whether the supplied error code should trigger automated recovery.
   *
   * @param code - Error code to evaluate.
   * @returns True when automated recovery is appropriate.
   */
  private isRecoverableErrorCode(code: WebRTCErrorCode): boolean {
    switch (code) {
      case WebRTCErrorCode.NetworkTimeout:
      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.DataChannelFailed:
        return true;

      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
      case WebRTCErrorCode.SdpNegotiationFailed:
      case WebRTCErrorCode.AudioTrackFailed:
        return false;

      default:
        return false;
    }
  }

  /**
   * Identify whether the data channel is optional for the current runtime configuration.
   *
   * @returns True when the session can continue in audio-only mode.
   */
  private isDataChannelOptional(): boolean {
    // In most cases, data channel is critical for realtime events
    // This could be configurable based on application requirements
    return false;
  }

  /**
   * Emit structured logs with severity derived from the error code.
   *
   * @param error - Error to log with metadata.
   */
  private logError(error: WebRTCErrorImpl): void {
    const logLevel = this.getLogLevel(error.code);
    const message = `WebRTC Error: ${error.code} - ${error.message}`;
    const data = {
      code: error.code,
      recoverable: error.recoverable,
      timestamp: error.timestamp,
      details: error.details,
    };

    switch (logLevel) {
      case "error":
        this.logger.error(message, data);
        break;
      case "warn":
        this.logger.warn(message, data);
        break;
      case "info":
        this.logger.info(message, data);
        break;
      default:
        this.logger.debug(message, data);
        break;
    }
  }

  /**
   * Map an error code to the desired log level for downstream telemetry.
   *
   * @param code - Error code to classify.
   * @returns Log level string understood by the logger.
   */
  private getLogLevel(
    code: WebRTCErrorCode,
  ): "error" | "warn" | "info" | "debug" {
    switch (code) {
      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.SdpNegotiationFailed:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
        return "error";

      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.AudioTrackFailed:
        return "warn";

      case WebRTCErrorCode.DataChannelFailed:
      case WebRTCErrorCode.NetworkTimeout:
        return "info";

      default:
        return "debug";
    }
  }

  /**
   * Record the error in the bounded in-memory history.
   *
   * @param error - Error instance to persist in the ring buffer.
   */
  private addToErrorHistory(error: WebRTCErrorImpl): void {
    this.errorHistory.push({
      error,
      timestamp: error.timestamp,
    });

    // Limit history size
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Compute average errors per hour using the recent error history window.
   *
   * @returns Number of errors observed within the last hour.
   */
  private calculateAverageErrorsPerHour(): number {
    if (this.errorHistory.length === 0) {
      return 0;
    }

    const now = Date.now();
    const oneHourAgo = now - 3600000; // 1 hour in milliseconds

    const recentErrors = this.errorHistory.filter(
      (entry) => entry.timestamp.getTime() > oneHourAgo,
    );

    return recentErrors.length;
  }

  /**
   * Notify each registered recovery observer while protecting the handler from exceptions.
   *
   * @param event - Recovery lifecycle event to broadcast to observers.
   */
  private notifyRecoveryObservers(event: ConnectionRecoveryEvent): void {
    for (const observer of Array.from(this.recoveryObservers)) {
      try {
        observer(event);
      } catch (error: any) {
        this.logger.debug("Recovery observer failed", {
          error: error?.message ?? error,
          event,
        });
      }
    }
  }
}

interface ErrorHistoryEntry {
  error: WebRTCErrorImpl;
  timestamp: Date;
}

interface ErrorStatistics {
  totalErrors: number;
  recentErrors: number;
  errorsByCode: Record<string, number>;
  lastError?: WebRTCErrorImpl;
  averageErrorsPerHour: number;
}

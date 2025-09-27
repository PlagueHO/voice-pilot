import { Logger } from "../core/logger";
import {
  WebRTCConfig,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  WebRTCTransport,
} from "../types/webrtc";
import { ConnectionRecoveryManager } from "./connection-recovery-manager";

/**
 * Handles WebRTC errors with classification, recovery, and reporting
 */
export class WebRTCErrorHandler {
  private logger: Logger;
  private recoveryManager: ConnectionRecoveryManager;

  // Error tracking
  private errorHistory: ErrorHistoryEntry[] = [];
  private maxHistorySize = 100;

  // Error callbacks
  private onAuthenticationErrorCallback?: (
    error: WebRTCErrorImpl,
  ) => Promise<void>;
  private onConnectionErrorCallback?: (error: WebRTCErrorImpl) => Promise<void>;
  private onFatalErrorCallback?: (error: WebRTCErrorImpl) => Promise<void>;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("WebRTCErrorHandler");
    this.recoveryManager = new ConnectionRecoveryManager(logger);
  }

  /**
   * Handle WebRTC error with appropriate response strategy
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
   * Classify error type from generic error
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
   * Create WebRTC error from generic error
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
   * Get error statistics
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
   * Set error callbacks
   */
  onAuthenticationError(
    callback: (error: WebRTCErrorImpl) => Promise<void>,
  ): void {
    this.onAuthenticationErrorCallback = callback;
  }

  onConnectionError(callback: (error: WebRTCErrorImpl) => Promise<void>): void {
    this.onConnectionErrorCallback = callback;
  }

  onFatalError(callback: (error: WebRTCErrorImpl) => Promise<void>): void {
    this.onFatalErrorCallback = callback;
  }

  /**
   * Configure recovery manager
   */
  configureRecovery(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  }): void {
    this.recoveryManager.configure(options);
  }

  // Private error handling methods
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

  private async handleDataChannelError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.warn("Handling data channel error", { error: error.code });

    // Data channel failures might be recoverable by continuing with audio-only
    if (this.isDataChannelOptional()) {
      this.logger.info(
        "Continuing with audio-only mode after data channel failure",
      );
      return;
    }

    // Attempt recovery if data channel is critical
    await this.recoveryManager.handleConnectionFailure(
      transport,
      config,
      error,
    );
  }

  private async handleSdpError(
    error: WebRTCErrorImpl,
    transport: WebRTCTransport,
    config: WebRTCConfig,
  ): Promise<void> {
    this.logger.error("Handling SDP negotiation error", { error: error.code });

    // SDP errors are usually fatal and require reconnection
    await this.handleFatalError(error);
  }

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

  private async handleFatalError(error: WebRTCErrorImpl): Promise<void> {
    this.logger.error("Handling fatal error", { error: error.code });

    if (this.onFatalErrorCallback) {
      await this.onFatalErrorCallback(error);
    }
  }

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

  private isDataChannelOptional(): boolean {
    // In most cases, data channel is critical for realtime events
    // This could be configurable based on application requirements
    return false;
  }

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

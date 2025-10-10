import type {
  ConnectionRecoveryEvent,
  ConnectionRecoveryObserver,
} from "../../../audio/connection-recovery-manager";
import { WebRTCErrorHandler } from "../../../audio/webrtc-error-handler";
import type { Logger } from "../../../core/logger";
import type { RealtimeEvent } from "../../../types/realtime-events";
import {
  ConnectionQuality,
  WebRTCConnectionState,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  type AudioTrackRegistrationOptions,
  type ConnectionResult,
  type ConnectionStatistics,
  type RecoveryEventPayload,
  type WebRTCConfig,
  type WebRTCEventHandler,
  type WebRTCEventType,
  type WebRTCTransport,
} from "../../../types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
}

function createTestLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = {
    debug: (message: string, data?: unknown) => {
      entries.push({ level: "debug", message, data });
    },
    info: (message: string, data?: unknown) => {
      entries.push({ level: "info", message, data });
    },
    warn: (message: string, data?: unknown) => {
      entries.push({ level: "warn", message, data });
    },
    error: (message: string, data?: unknown) => {
      entries.push({ level: "error", message, data });
    },
    setLevel: () => {
      /* noop */
    },
    dispose: () => {
      /* noop */
    },
    recordGateTaskOutcome: async () => {
      /* noop */
    },
  } as unknown as Logger;

  return { logger, entries };
}

class RecoveryManagerTestDouble {
  public configureCalls: Array<{
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  }> = [];
  public handleCalls: Array<{
    transport: WebRTCTransport;
    config: WebRTCConfig;
    error: WebRTCErrorImpl;
  }> = [];
  public nextResults: boolean[] = [];
  public observers: ConnectionRecoveryObserver[] = [];
  public disposed = false;

  configure(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  }): void {
    this.configureCalls.push(options);
  }

  addObserver(observer: ConnectionRecoveryObserver): { dispose: () => void } {
    this.observers.push(observer);
    return {
      dispose: () => {
        this.observers = this.observers.filter((entry) => entry !== observer);
      },
    };
  }

  async handleConnectionFailure(
    transport: WebRTCTransport,
    config: WebRTCConfig,
    error: WebRTCErrorImpl,
  ): Promise<boolean> {
    this.handleCalls.push({ transport, config, error });
    if (this.nextResults.length > 0) {
      return this.nextResults.shift()!;
    }
    return true;
  }

  emit(event: ConnectionRecoveryEvent): void {
    for (const observer of [...this.observers]) {
      observer(event);
    }
  }

  clearObservers(): void {
    this.observers = [];
  }
}

class WebRTCTransportStub implements WebRTCTransport {
  public recoveryEvents: RecoveryEventPayload[] = [];

  async establishConnection(config: WebRTCConfig): Promise<ConnectionResult> {
    return {
      success: true,
      connectionId: "test",
      connectionState: WebRTCConnectionState.Connected,
      audioTracks: [],
    };
  }

  async closeConnection(): Promise<void> {
    /* noop */
  }

  async restartIce(config: WebRTCConfig): Promise<boolean> {
    return true;
  }

  async recreateDataChannel(config: WebRTCConfig): Promise<RTCDataChannel | null> {
    return null;
  }

  getConnectionState(): WebRTCConnectionState {
    return WebRTCConnectionState.Connected;
  }

  getConnectionStatistics(): ConnectionStatistics {
    return {
      connectionId: "test",
      connectionDurationMs: 0,
      audioPacketsSent: 0,
      audioPacketsReceived: 0,
      audioBytesSent: 0,
      audioBytesReceived: 0,
      currentRoundTripTime: 0,
      packetsLost: 0,
      jitter: 0,
      dataChannelState: "open",
      iceConnectionState: "connected" as RTCIceConnectionState,
      connectionQuality: ConnectionQuality.Good,
    };
  }

  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return "open";
  }

  isDataChannelFallbackActive(): boolean {
    return false;
  }

  publishRecoveryEvent(event: RecoveryEventPayload): void {
    this.recoveryEvents.push(event);
  }

  async addAudioTrack(
    track: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    /* noop */
  }

  async replaceAudioTrack(
    oldTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    /* noop */
  }

  async removeAudioTrack(track: MediaStreamTrack): Promise<void> {
    /* noop */
  }

  getRemoteAudioStream(): MediaStream | null {
    return null;
  }

  getAudioContext(): AudioContext | null {
    return null;
  }

  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    /* noop */
  }

  addEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void {
    /* noop */
  }

  removeEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void {
    /* noop */
  }
}

function createConfig(): WebRTCConfig {
  const expiresAt = new Date(Date.now() + 60000);
  const refreshAt = new Date(Date.now() + 30000);

  return {
    endpoint: {
      region: "eastus2",
      url: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
      deployment: "gpt-4o-realtime-preview",
      apiVersion: "2025-08-28",
    },
    authentication: {
      ephemeralKey: "ephemeral-key",
      expiresAt,
      keyInfo: {
        key: "ephemeral-key",
        sessionId: "session",
        issuedAt: new Date(),
        expiresAt,
        isValid: true,
        secondsRemaining: 60,
        refreshAt,
        secondsUntilRefresh: 30,
        ttlSeconds: 60,
        refreshIntervalSeconds: 45,
      },
    },
    audioConfig: {
      sampleRate: 24000,
      codecProfileId: "pcm16-24k-mono",
      format: "pcm16",
      channels: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: "interactive",
        resumeOnActivation: true,
        requiresUserGesture: true,
      },
      workletModuleUrls: [],
    },
    sessionConfig: {
      voice: "alloy",
      locale: "en-US",
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      transcriptionModel: "whisper-1",
      turnDetection: undefined,
    },
    dataChannelConfig: {
      channelName: "realtime-channel",
      ordered: true,
      maxRetransmits: 3,
    },
    connectionConfig: {
      reconnectAttempts: 3,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 5000,
    },
  };
}

function createHandlerHarness(): {
  handler: WebRTCErrorHandler;
  recoveryManager: RecoveryManagerTestDouble;
  entries: LogEntry[];
  logger: Logger;
} {
  const { logger, entries } = createTestLogger();
  const handler = new WebRTCErrorHandler(logger);

  const originalSubscription = (handler as any).recoverySubscription as {
    dispose: () => void;
  };
  originalSubscription.dispose();

  const recoveryManager = new RecoveryManagerTestDouble();
  (handler as any).recoveryManager = recoveryManager;
  const forwarder = (event: ConnectionRecoveryEvent) => {
    (handler as any).notifyRecoveryObservers(event);
  };
  const subscription = recoveryManager.addObserver(forwarder);
  (handler as any).recoverySubscription = {
    dispose: () => {
      recoveryManager.disposed = true;
      subscription.dispose();
      recoveryManager.clearObservers();
    },
  };

  return { handler, recoveryManager, entries, logger };
}

function buildError(
  code: WebRTCErrorCode | (string & { readonly brand?: unique symbol }),
  options: {
    message?: string;
    recoverable?: boolean;
    timestamp?: Date;
    details?: unknown;
  } = {},
): WebRTCErrorImpl {
  return new WebRTCErrorImpl({
    code: code as WebRTCErrorCode,
    message: options.message ?? "test-error",
    recoverable: options.recoverable ?? false,
    details: options.details,
    timestamp: options.timestamp ?? new Date(),
  });
}

suite("WebRTCErrorHandler", () => {
  test("classifies errors based on known patterns", () => {
    const { handler } = createHandlerHarness();

    expect(handler.classifyError({ name: "NotAllowedError" })).to.equal(
      WebRTCErrorCode.AuthenticationFailed,
    );
    expect(handler.classifyError({ name: "DevicesNotFoundError" })).to.equal(
      WebRTCErrorCode.AudioTrackFailed,
    );
    expect(
      handler.classifyError({ message: "data channel closed" }),
    ).to.equal(WebRTCErrorCode.DataChannelFailed);
    expect(
      handler.classifyError({ message: "ICE connection lost" }),
    ).to.equal(WebRTCErrorCode.IceConnectionFailed);
    expect(
      handler.classifyError({ message: "region unsupported" }),
    ).to.equal(WebRTCErrorCode.RegionNotSupported);
  });

  test("wraps unknown errors with recoverable flags inferred from classification", () => {
    const { handler } = createHandlerHarness();

    const dataChannelError = handler.createWebRTCError({
      message: "data channel failure",
    });
    expect(dataChannelError.code).to.equal(WebRTCErrorCode.DataChannelFailed);
    expect(dataChannelError.recoverable).to.be.true;

    const authError = handler.createWebRTCError({
      name: "NotAllowedError",
      message: "permission denied",
    });
    expect(authError.code).to.equal(WebRTCErrorCode.AuthenticationFailed);
    expect(authError.recoverable).to.be.false;
  });

  test("invokes authentication callback when credentials fail", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [true];

    let invoked = 0;
    handler.onAuthenticationError(async (error) => {
      invoked += 1;
      expect(error.code).to.equal(WebRTCErrorCode.AuthenticationFailed);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.AuthenticationFailed),
      transport,
      config,
    );

    expect(invoked).to.equal(1);
    expect(recoveryManager.handleCalls).to.have.lengthOf(0);
  });

  test("attempts recovery and raises connection callback when recovery fails", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [false];

    let callbackCount = 0;
    handler.onConnectionError(async (error) => {
      callbackCount += 1;
      expect(error.code).to.equal(WebRTCErrorCode.NetworkTimeout);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.NetworkTimeout, { recoverable: true }),
      transport,
      config,
    );

    expect(recoveryManager.handleCalls).to.have.lengthOf(1);
    expect(callbackCount).to.equal(1);
  });

  test("suppresses connection callback when data channel recovery succeeds", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [true];

    let callbackCount = 0;
    handler.onConnectionError(async () => {
      callbackCount += 1;
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.DataChannelFailed, { recoverable: true }),
      transport,
      config,
    );

    expect(recoveryManager.handleCalls).to.have.lengthOf(1);
    expect(callbackCount).to.equal(0);
  });

  test("escalates fatal errors via the registered callback", async () => {
    const { handler } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    let fatalCount = 0;
    handler.onFatalError(async (error) => {
      fatalCount += 1;
      expect(error.code).to.equal(WebRTCErrorCode.ConfigurationInvalid);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.ConfigurationInvalid),
      transport,
      config,
    );

    expect(fatalCount).to.equal(1);
  });

  test("routes unknown recoverable errors through the recovery manager", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [true];

    await handler.handleError(
      buildError("CUSTOM_ERROR" as any, { recoverable: true }),
      transport,
      config,
    );

    expect(recoveryManager.handleCalls).to.have.lengthOf(1);
  });

  test("forwards recovery events to observers", () => {
    const { handler, recoveryManager } = createHandlerHarness();

    const received: ConnectionRecoveryEvent[] = [];
    const disposable = handler.onRecoveryEvent((event) => {
      received.push(event);
    });

    const event: ConnectionRecoveryEvent = {
      type: "attempt",
      attempt: 1,
      strategy: "full_reconnect",
      delayMs: 100,
    };

    recoveryManager.emit(event);

    expect(received).to.have.lengthOf(1);
    expect(received[0]).to.equal(event);

    disposable.dispose();
    recoveryManager.emit(event);
    expect(received).to.have.lengthOf(1);
  });

  test("collects error statistics including recency and counts", async () => {
    const { handler } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    const baseline = Date.now();
    const originalNow = Date.now;
    Date.now = () => baseline;

    try {
      await handler.handleError(
        buildError(WebRTCErrorCode.NetworkTimeout, {
          recoverable: true,
          timestamp: new Date(baseline - 60000),
        }),
        transport,
        config,
      );

      await handler.handleError(
        buildError(WebRTCErrorCode.AuthenticationFailed, {
          timestamp: new Date(baseline - 7200000),
        }),
        transport,
        config,
      );
    } finally {
      Date.now = originalNow;
    }

    const stats = handler.getErrorStatistics();
    expect(stats.totalErrors).to.equal(2);
    expect(stats.recentErrors).to.equal(1);
    expect(stats.errorsByCode[WebRTCErrorCode.NetworkTimeout]).to.equal(1);
    expect(stats.errorsByCode[WebRTCErrorCode.AuthenticationFailed]).to.equal(1);
    expect(stats.lastError).to.exist;
    expect(stats.averageErrorsPerHour).to.equal(1);
  });

  test("configures recovery strategy options", () => {
    const { handler, recoveryManager } = createHandlerHarness();

    handler.configureRecovery({ maxAttempts: 5, baseDelayMs: 250 });

    expect(recoveryManager.configureCalls).to.have.lengthOf(1);
    expect(recoveryManager.configureCalls[0]).to.deep.equal({
      maxAttempts: 5,
      baseDelayMs: 250,
    });
  });

  test("disposes recovery subscription and observers", () => {
    const { handler, recoveryManager } = createHandlerHarness();

    handler.dispose();

    expect(recoveryManager.disposed).to.be.true;
    expect(recoveryManager.observers).to.have.lengthOf(0);
  });

  test("logs each handled error with structured metadata", async () => {
    const { handler, entries } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    await handler.handleError(
      buildError(WebRTCErrorCode.AudioTrackFailed),
      transport,
      config,
    );

    const log = entries.find((entry) => entry.message.includes("WebRTC Error"));
    expect(log, "expected log entry for handled error").to.exist;
    expect((log?.data as { code?: WebRTCErrorCode } | undefined)?.code).to.equal(
      WebRTCErrorCode.AudioTrackFailed,
    );
  });
});

import * as assert from "assert";
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

describe("WebRTCErrorHandler", () => {
  it("classifies errors based on known patterns", () => {
    const { handler } = createHandlerHarness();

    assert.strictEqual(
      handler.classifyError({ name: "NotAllowedError" }),
      WebRTCErrorCode.AuthenticationFailed,
    );
    assert.strictEqual(
      handler.classifyError({ name: "DevicesNotFoundError" }),
      WebRTCErrorCode.AudioTrackFailed,
    );
    assert.strictEqual(
      handler.classifyError({ message: "data channel closed" }),
      WebRTCErrorCode.DataChannelFailed,
    );
    assert.strictEqual(
      handler.classifyError({ message: "ICE connection lost" }),
      WebRTCErrorCode.IceConnectionFailed,
    );
    assert.strictEqual(
      handler.classifyError({ message: "region unsupported" }),
      WebRTCErrorCode.RegionNotSupported,
    );
  });

  it("wraps unknown errors with recoverable flags inferred from classification", () => {
    const { handler } = createHandlerHarness();

    const dataChannelError = handler.createWebRTCError({
      message: "data channel failure",
    });
    assert.strictEqual(dataChannelError.code, WebRTCErrorCode.DataChannelFailed);
    assert.strictEqual(dataChannelError.recoverable, true);

    const authError = handler.createWebRTCError({
      name: "NotAllowedError",
      message: "permission denied",
    });
    assert.strictEqual(authError.code, WebRTCErrorCode.AuthenticationFailed);
    assert.strictEqual(authError.recoverable, false);
  });

  it("invokes authentication callback when credentials fail", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [true];

    let invoked = 0;
    handler.onAuthenticationError(async (error) => {
      invoked += 1;
      assert.strictEqual(error.code, WebRTCErrorCode.AuthenticationFailed);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.AuthenticationFailed),
      transport,
      config,
    );

    assert.strictEqual(invoked, 1);
    assert.strictEqual(recoveryManager.handleCalls.length, 0);
  });

  it("attempts recovery and raises connection callback when recovery fails", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [false];

    let callbackCount = 0;
    handler.onConnectionError(async (error) => {
      callbackCount += 1;
      assert.strictEqual(error.code, WebRTCErrorCode.NetworkTimeout);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.NetworkTimeout, { recoverable: true }),
      transport,
      config,
    );

    assert.strictEqual(recoveryManager.handleCalls.length, 1);
    assert.strictEqual(callbackCount, 1);
  });

  it("suppresses connection callback when data channel recovery succeeds", async () => {
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

    assert.strictEqual(recoveryManager.handleCalls.length, 1);
    assert.strictEqual(callbackCount, 0);
  });

  it("escalates fatal errors via the registered callback", async () => {
    const { handler } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    let fatalCount = 0;
    handler.onFatalError(async (error) => {
      fatalCount += 1;
      assert.strictEqual(error.code, WebRTCErrorCode.ConfigurationInvalid);
    });

    await handler.handleError(
      buildError(WebRTCErrorCode.ConfigurationInvalid),
      transport,
      config,
    );

    assert.strictEqual(fatalCount, 1);
  });

  it("routes unknown recoverable errors through the recovery manager", async () => {
    const { handler, recoveryManager } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    recoveryManager.nextResults = [true];

    await handler.handleError(
      buildError("CUSTOM_ERROR" as any, { recoverable: true }),
      transport,
      config,
    );

    assert.strictEqual(recoveryManager.handleCalls.length, 1);
  });

  it("forwards recovery events to observers", () => {
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

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0], event);

    disposable.dispose();
    recoveryManager.emit(event);
    assert.strictEqual(received.length, 1);
  });

  it("collects error statistics including recency and counts", async () => {
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
    assert.strictEqual(stats.totalErrors, 2);
    assert.strictEqual(stats.recentErrors, 1);
    assert.strictEqual(stats.errorsByCode[WebRTCErrorCode.NetworkTimeout], 1);
    assert.strictEqual(
      stats.errorsByCode[WebRTCErrorCode.AuthenticationFailed],
      1,
    );
    assert.ok(stats.lastError);
    assert.strictEqual(stats.averageErrorsPerHour, 1);
  });

  it("configures recovery strategy options", () => {
    const { handler, recoveryManager } = createHandlerHarness();

    handler.configureRecovery({ maxAttempts: 5, baseDelayMs: 250 });

    assert.strictEqual(recoveryManager.configureCalls.length, 1);
    assert.deepStrictEqual(recoveryManager.configureCalls[0], {
      maxAttempts: 5,
      baseDelayMs: 250,
    });
  });

  it("disposes recovery subscription and observers", () => {
    const { handler, recoveryManager } = createHandlerHarness();

    handler.dispose();

    assert.strictEqual(recoveryManager.disposed, true);
    assert.strictEqual(recoveryManager.observers.length, 0);
  });

  it("logs each handled error with structured metadata", async () => {
    const { handler, entries } = createHandlerHarness();
    const transport = new WebRTCTransportStub();
    const config = createConfig();

    await handler.handleError(
      buildError(WebRTCErrorCode.AudioTrackFailed),
      transport,
      config,
    );

    const log = entries.find((entry) => entry.message.includes("WebRTC Error"));
    assert.ok(log, "expected log entry for handled error");
    assert.strictEqual(log?.data && (log.data as any).code, WebRTCErrorCode.AudioTrackFailed);
  });
});

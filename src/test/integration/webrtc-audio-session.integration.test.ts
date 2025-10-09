import * as assert from "assert";
import { WebRTCAudioService } from "../../audio/webrtc-audio-service";
import { WebRTCConfigFactory } from "../../audio/webrtc-config-factory";
import { Logger } from "../../core/logger";
import type { RealtimeEvent } from "../../types/realtime-events";
import type {
  AudioTrackRegistrationOptions,
} from "../../types/webrtc";
import {
  ConnectionQuality,
  WebRTCConnectionState,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  type ConnectionResult,
  type ConnectionStatistics,
  type RecoveryEventPayload,
  type WebRTCConfig,
  type WebRTCEvent,
  type WebRTCEventHandler,
  type WebRTCTransport,
} from "../../types/webrtc";

function createTestLogger(): Logger {
  const noop = () => {
    /* no-op */
  };

  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    setLevel: noop,
    dispose: noop,
  } as unknown as Logger;
}

type EventRegistry = Map<string, Set<WebRTCEventHandler>>;

class IntegrationStubTransport implements WebRTCTransport {
  public readonly registry: EventRegistry = new Map();
  public readonly published: RecoveryEventPayload[] = [];
  public restartIceCalls = 0;
  public fallbackActive = false;
  public queuedMessages = 0;
  private readonly restartPlan: boolean[];

  constructor(restartPlan: boolean[]) {
    this.restartPlan = restartPlan;
  }

  async establishConnection(_config: WebRTCConfig): Promise<ConnectionResult> {
    return {
      success: true,
      connectionId: "stub",
      connectionState: WebRTCConnectionState.Connected,
      audioTracks: [],
      remoteStream: undefined,
      dataChannel: undefined,
    };
  }

  async closeConnection(): Promise<void> {
    /* no-op */
  }

  dispose(): void {
    /* no-op */
  }

  async restartIce(_config: WebRTCConfig): Promise<boolean> {
    const result = this.restartPlan[this.restartIceCalls] ?? true;
    this.restartIceCalls += 1;
    return result;
  }

  async recreateDataChannel(_config: WebRTCConfig): Promise<RTCDataChannel | null> {
    return null;
  }

  getConnectionState(): WebRTCConnectionState {
    return WebRTCConnectionState.Connected;
  }

  getConnectionStatistics(): ConnectionStatistics {
    return {
      connectionId: "stub",
      connectionDurationMs: 0,
      audioPacketsSent: 0,
      audioPacketsReceived: 0,
      audioBytesSent: 0,
      audioBytesReceived: 0,
      packetsLost: 0,
      jitter: 0,
      dataChannelState: this.fallbackActive ? "connecting" : "open",
      iceConnectionState: "connected",
      connectionQuality: ConnectionQuality.Good,
    };
  }

  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return this.fallbackActive ? "connecting" : "open";
  }

  isDataChannelFallbackActive(): boolean {
    return this.fallbackActive;
  }

  publishRecoveryEvent(event: RecoveryEventPayload): void {
    this.published.push(event);
    this.emit({
      type: event.type,
      connectionId: "stub",
      timestamp: new Date(),
      data:
        event.type === "reconnectAttempt"
          ? {
              strategy: event.strategy,
              attempt: event.attempt,
              delayMs: event.delayMs,
            }
          : {
              strategy: event.strategy,
              attempt: event.attempt,
              durationMs: event.durationMs,
              error: event.type === "reconnectFailed" ? event.error : undefined,
            },
    });
  }

  addAudioTrack(
    _track: MediaStreamTrack,
    _options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    return Promise.resolve();
  }

  removeAudioTrack(_track: MediaStreamTrack): Promise<void> {
    return Promise.resolve();
  }

  getRemoteAudioStream(): MediaStream | null {
    return null;
  }

  getAudioContext(): AudioContext | null {
    return null;
  }

  sendDataChannelMessage(_message: RealtimeEvent): Promise<void> {
    return Promise.resolve();
  }

  addEventListener(type: string, handler: WebRTCEventHandler): void {
    if (!this.registry.has(type)) {
      this.registry.set(type, new Set());
    }
    this.registry.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: WebRTCEventHandler): void {
    this.registry.get(type)?.delete(handler);
  }

  simulateFallback(active: boolean, queued: number, reason: string): void {
    this.fallbackActive = active;
    this.queuedMessages = queued;
    this.emit({
      type: "fallbackStateChanged",
      connectionId: "stub",
      timestamp: new Date(),
      data: {
        state: this.getDataChannelState(),
        fallbackActive: active,
        queuedMessages: queued,
        reason,
      },
    });
  }

  simulateConnectionDiagnostics(
    negotiation?: {
      durationMs: number;
      timeoutMs: number;
      timedOut: boolean;
      errorCode?: WebRTCErrorCode;
    },
    overrides?: Partial<ConnectionStatistics>,
  ): void {
    const statistics = {
      ...this.getConnectionStatistics(),
      ...overrides,
    };

    this.emit({
      type: "connectionDiagnostics",
      connectionId: "stub",
      timestamp: new Date(),
      data: {
        statistics,
        statsIntervalMs: 5000,
        negotiation,
      },
    });
  }

  simulateNegotiationTimeout(durationMs: number): void {
    this.simulateConnectionDiagnostics({
      durationMs,
      timeoutMs: 5000,
      timedOut: true,
      errorCode: WebRTCErrorCode.SdpNegotiationFailed,
    });
  }

  private emit(event: WebRTCEvent): void {
    const listeners = this.registry.get(event.type);
    if (!listeners) {
      return;
    }
    for (const handler of listeners) {
      handler(event);
    }
  }
}

describe("WebRTC audio service recovery integration", () => {
  const logger = createTestLogger();
  const configFactory = new WebRTCConfigFactory(logger);
  const config = configFactory.createTestConfig();

  it("retries ICE restart until success and reports telemetry", async () => {
    const service = new WebRTCAudioService(undefined, undefined, undefined, logger);
    const transport = new IntegrationStubTransport([false, false, true]);
    (service as any).transport = transport;
    (service as any).setupEventHandlers();

    const telemetry: any[] = [];
    service.addTelemetryObserver((event) => telemetry.push(event));

    transport.simulateNegotiationTimeout(5200);

    const diagnosticsEvent = telemetry.find(
      (event) => event.type === "connectionDiagnostics",
    );

    assert.ok(diagnosticsEvent, "Diagnostics telemetry should be emitted");
    assert.strictEqual(diagnosticsEvent.negotiation?.timedOut, true);
    assert.strictEqual(
      diagnosticsEvent.negotiation?.errorCode,
      WebRTCErrorCode.SdpNegotiationFailed,
    );

    const errorHandler = (service as any).errorHandler;
    errorHandler.configureRecovery({ baseDelayMs: 0, maxAttempts: 3 });

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.IceConnectionFailed,
      message: "Simulated ICE failure",
      recoverable: true,
      timestamp: new Date(),
    });

    await errorHandler.handleError(error, transport, config);

    assert.strictEqual(transport.restartIceCalls, 3);
    const eventTypes = telemetry.map((event) => event.type);
    assert.deepStrictEqual(eventTypes.slice(0, 7), [
      "connectionDiagnostics",
      "reconnectAttempt",
      "reconnectFailed",
      "reconnectAttempt",
      "reconnectFailed",
      "reconnectAttempt",
      "reconnectSucceeded",
    ]);

    transport.simulateFallback(true, 2, "Data channel closed");
    await new Promise((resolve) => setImmediate(resolve));
    const lastEvent = telemetry[telemetry.length - 1];
    assert.strictEqual(lastEvent.type, "fallbackStateChanged");
    assert.strictEqual(lastEvent.fallbackActive, true);
    assert.strictEqual(lastEvent.queuedMessages, 2);
    assert.strictEqual(service.getSessionStatus().fallbackActive, true);

    transport.simulateFallback(false, 0, "Data channel restored");
    await new Promise((resolve) => setImmediate(resolve));
    const finalEvent = telemetry[telemetry.length - 1];
    assert.strictEqual(finalEvent.type, "fallbackStateChanged");
    assert.strictEqual(finalEvent.fallbackActive, false);

    service.dispose();
  });
});

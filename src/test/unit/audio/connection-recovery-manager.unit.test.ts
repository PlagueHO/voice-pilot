import * as assert from "assert";
import { ConnectionRecoveryManager } from "../../../audio/connection-recovery-manager";
import { WebRTCConfigFactory } from "../../../audio/webrtc-config-factory";
import { WebRTCTransportImpl } from "../../../audio/webrtc-transport";
import { Logger } from "../../../core/logger";
import type { RealtimeEvent } from "../../../types/realtime-events";
import type {
  AudioTrackRegistrationOptions,
  RecoveryEventPayload,
  WebRTCConfig,
} from "../../../types/webrtc";
import {
  ConnectionQuality,
  RecoveryStrategy,
  WebRTCConnectionState,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  type ConnectionResult,
  type ConnectionStatistics,
  type WebRTCEventHandler,
  type WebRTCTransport,
} from "../../../types/webrtc";

type RecoveryEvent = Parameters<WebRTCTransport["publishRecoveryEvent"]>[0];

type EventMap = Map<string, Set<WebRTCEventHandler>>;

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

class StubTransport implements WebRTCTransport {
  public readonly published: RecoveryEvent[] = [];
  public readonly events: EventMap = new Map();
  public restartIceCalls = 0;
  public recreateCalls = 0;
  public fallbackActive = false;
  public dataChannelState: RTCDataChannelState | "unavailable" = "unavailable";

  constructor(private readonly restartSequence: boolean[]) {}

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

  async restartIce(_config: WebRTCConfig): Promise<boolean> {
    const result = this.restartSequence[this.restartIceCalls] ?? true;
    this.restartIceCalls += 1;
    return result;
  }

  async recreateDataChannel(_config: WebRTCConfig): Promise<RTCDataChannel | null> {
    this.recreateCalls += 1;
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
      dataChannelState: "open",
      iceConnectionState: "connected",
      connectionQuality: ConnectionQuality.Good,
    };
  }

  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return this.dataChannelState;
  }

  isDataChannelFallbackActive(): boolean {
    return this.fallbackActive;
  }

  getRemoteAudioStream(): MediaStream | null {
    return null;
  }

  getAudioContext(): AudioContext | null {
    return null;
  }

  publishRecoveryEvent(event: RecoveryEventPayload): void {
    this.published.push(event);
    const handlerSet = this.events.get(event.type);
    if (handlerSet) {
      const payload = {
        type: event.type,
        connectionId: "stub",
        timestamp: new Date(),
        data: event.type === "reconnectAttempt"
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
      } as any;
      for (const handler of handlerSet) {
        handler(payload);
      }
    }
  }

  addAudioTrack(
    _track: MediaStreamTrack,
    _options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    throw new Error("Not implemented");
  }

  removeAudioTrack(_track: MediaStreamTrack): Promise<void> {
    throw new Error("Not implemented");
  }

  sendDataChannelMessage(_message: RealtimeEvent): Promise<void> {
    throw new Error("Not implemented");
  }

  addEventListener(type: string, handler: WebRTCEventHandler): void {
    if (!this.events.has(type)) {
      this.events.set(type, new Set());
    }
    this.events.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: WebRTCEventHandler): void {
    this.events.get(type)?.delete(handler);
  }

  replaceAudioTrack?: any;
}

describe("ConnectionRecoveryManager", () => {
  const logger = createTestLogger();
  const configFactory = new WebRTCConfigFactory(logger);
  const config: WebRTCConfig = configFactory.createTestConfig();

  it("restarts ICE with exponential backoff and publishes telemetry", async () => {
    const manager = new ConnectionRecoveryManager(logger);
    manager.configure({ baseDelayMs: 0, maxAttempts: 5, backoffMultiplier: 2 });

    const events: RecoveryStrategy[] = [];
    manager.addObserver((event) => {
      if (event.type === "attempt" || event.type === "success") {
        events.push(event.strategy);
      }
    });

    const transport = new StubTransport([false, false, true]);

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.IceConnectionFailed,
      message: "ICE failed",
      recoverable: true,
      timestamp: new Date(),
    });

    const recovered = await manager.handleConnectionFailure(
      transport,
      config,
      error,
    );

    assert.strictEqual(recovered, true);
    assert.strictEqual(transport.restartIceCalls, 3);
  assert.strictEqual(events.length, 4);
  assert.strictEqual(events.every((strategy) => strategy === "restart_ice"), true);
    assert.strictEqual(transport.published.filter((e) => e.type === "reconnectAttempt").length, 3);
    assert.strictEqual(transport.published.some((e) => e.type === "reconnectSucceeded"), true);
  });

  it("attempts data channel recreation and emits failure telemetry", async () => {
    const manager = new ConnectionRecoveryManager(logger);
    manager.configure({ baseDelayMs: 0, maxAttempts: 1 });

    const transport = new StubTransport([false]);
    transport.recreateDataChannel = async () => {
      transport.recreateCalls += 1;
      return null;
    };

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.DataChannelFailed,
      message: "Channel closed",
      recoverable: true,
      timestamp: new Date(),
    });

    const recovered = await manager.handleConnectionFailure(
      transport,
      config,
      error,
    );

    assert.strictEqual(recovered, false);
    assert.strictEqual(transport.recreateCalls, 1);
    assert.strictEqual(
      transport.published.some((event) => event.type === "reconnectFailed"),
      true,
    );
  });

  it("applies exponential backoff and updates recovery stats", async () => {
    const manager = new ConnectionRecoveryManager(logger);
    manager.configure({ baseDelayMs: 10, maxAttempts: 3, backoffMultiplier: 2 });

    const transport = new StubTransport([false, false, true]);

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.IceConnectionFailed,
      message: "ICE failed",
      recoverable: true,
      timestamp: new Date(),
    });

    const recordedDelays: number[] = [];
    const originalDelay = (manager as any).delay;
    const originalRandom = Math.random;

    (manager as any).delay = async (ms: number) => {
      recordedDelays.push(ms);
    };
    Math.random = () => 0;

    try {
      const recovered = await manager.handleConnectionFailure(
        transport,
        config,
        error,
      );

      assert.strictEqual(recovered, true);
      assert.deepStrictEqual(recordedDelays, [10, 20]);

      const stats = manager.getRecoveryStats();
      assert.strictEqual(stats.isRecovering, false);
      assert.strictEqual(stats.currentAttempt, 0);
      assert.strictEqual(stats.successiveFailures, 0);
      assert.ok(stats.totalRecoveryAttempts >= 1);
      assert.ok(stats.lastConnectionTime > 0);

      const attemptEvents = transport.published.filter(
        (event) => event.type === "reconnectAttempt",
      );
      const successEvents = transport.published.filter(
        (event) => event.type === "reconnectSucceeded",
      );

      assert.strictEqual(attemptEvents.length, 3);
      assert.strictEqual(successEvents.length, 1);
    } finally {
      (manager as any).delay = originalDelay;
      Math.random = originalRandom;
    }
  });
});

describe("WebRTCTransportImpl fallback queue", () => {
  const logger = createTestLogger();

  function createEventlessTransport(): WebRTCTransportImpl {
    return new WebRTCTransportImpl(logger);
  }

  function createFakeDataChannel() {
    const sent: string[] = [];
    const channel: any = {
      readyState: "connecting",
      label: "test",
      ordered: true,
      binaryType: "arraybuffer",
      bufferedAmount: 0,
      bufferedAmountLowThreshold: 0,
      id: 1,
      maxPacketLifeTime: null,
      maxRetransmits: null,
      negotiated: true,
      protocol: "",
      close: () => {
        channel.readyState = "closed";
        if (typeof channel.onclose === "function") {
          channel.onclose(undefined as any);
        }
      },
      send: (payload: string) => {
        sent.push(payload);
      },
      get sentMessages() {
        return sent;
      },
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    };

    return channel as RTCDataChannel & { sentMessages: string[] };
  }

  it("queues messages when data channel unavailable and flushes after reopen", async () => {
    const transport = createEventlessTransport();

    await transport.sendDataChannelMessage({ type: "test.event" });

    const pending = (transport as any).pendingDataChannelMessages as RealtimeEvent[];
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(transport.isDataChannelFallbackActive(), true);

    const fakeChannel = createFakeDataChannel();
    const attach = (transport as any).attachDataChannel.bind(transport);
    attach(fakeChannel, "local");

  (fakeChannel as any).readyState = "open";
    if (typeof fakeChannel.onopen === "function") {
      fakeChannel.onopen(undefined as any);
    }

    await new Promise((resolve) => setImmediate(resolve));

    assert.strictEqual(pending.length, 0);
    assert.strictEqual(fakeChannel.sentMessages.length, 1);
    assert.strictEqual(transport.isDataChannelFallbackActive(), false);

    await transport.sendDataChannelMessage({ type: "after.open" });
    assert.strictEqual(fakeChannel.sentMessages.length, 2);
  });
});

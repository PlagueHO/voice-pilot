import { ConnectionRecoveryManager } from "../../../src/audio/connection-recovery-manager";
import { WebRTCConfigFactory } from "../../../src/audio/webrtc-config-factory";
import { WebRTCTransportImpl } from "../../../src/audio/webrtc-transport";
import { Logger } from "../../../src/core/logger";
import type { RealtimeEvent } from "../../../src/types/realtime-events";
import type {
    AudioTrackRegistrationOptions,
    RecoveryEventPayload,
    WebRTCConfig,
} from "../../../src/types/webrtc";
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
} from "../../../src/types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

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
  private readonly restartSequence: boolean[];

  constructor(restartSequence: boolean[]) {
    this.restartSequence = restartSequence;
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

suite("Unit: ConnectionRecoveryManager", () => {
  const logger = createTestLogger();
  const configFactory = new WebRTCConfigFactory(logger);
  const config: WebRTCConfig = configFactory.createTestConfig();

  test("restarts ICE with exponential backoff and publishes telemetry", async () => {
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

    expect(recovered).to.be.true;
    expect(transport.restartIceCalls).to.equal(3);
    expect(events.length).to.equal(4);
    expect(events.every((strategy) => strategy === "restart_ice")).to.be.true;
    expect(transport.published.filter((e) => e.type === "reconnectAttempt").length).to.equal(3);
    expect(transport.published.some((e) => e.type === "reconnectSucceeded")).to.be.true;
  });

  test("attempts data channel recreation and emits failure telemetry", async () => {
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

    expect(recovered).to.be.false;
    expect(transport.recreateCalls).to.equal(1);
    expect(transport.published.some((event) => event.type === "reconnectFailed")).to.be.true;
  });

  test("applies exponential backoff and updates recovery stats", async () => {
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

      expect(recovered).to.be.true;
      expect(recordedDelays).to.deep.equal([10, 20]);

      const stats = manager.getRecoveryStats();
      expect(stats.isRecovering).to.be.false;
      expect(stats.currentAttempt).to.equal(0);
      expect(stats.successiveFailures).to.equal(0);
      expect(stats.totalRecoveryAttempts >= 1).to.be.true;
      expect(stats.lastConnectionTime > 0).to.be.true;

      const attemptEvents = transport.published.filter(
        (event) => event.type === "reconnectAttempt",
      );
      const successEvents = transport.published.filter(
        (event) => event.type === "reconnectSucceeded",
      );

      expect(attemptEvents.length).to.equal(3);
      expect(successEvents.length).to.equal(1);
    } finally {
      (manager as any).delay = originalDelay;
      Math.random = originalRandom;
    }
  });
});

suite("Unit: WebRTCTransportImpl fallback queue", () => {
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

  test("queues messages when data channel unavailable and flushes after reopen", async () => {
    const transport = createEventlessTransport();

    await transport.sendDataChannelMessage({ type: "test.event" });

    const pending = (transport as any).pendingDataChannelMessages as RealtimeEvent[];
  expect(pending.length).to.equal(1);
  expect(transport.isDataChannelFallbackActive()).to.be.true;

    const fakeChannel = createFakeDataChannel();
    const attach = (transport as any).attachDataChannel.bind(transport);
    attach(fakeChannel, "local");

    (fakeChannel as any).readyState = "open";
    if (typeof fakeChannel.onopen === "function") {
      fakeChannel.onopen(undefined as any);
    }

    await new Promise((resolve) => setImmediate(resolve));

    expect(pending.length).to.equal(0);
    expect(fakeChannel.sentMessages.length).to.equal(1);
    expect(transport.isDataChannelFallbackActive()).to.be.false;

    await transport.sendDataChannelMessage({ type: "after.open" });
    expect(fakeChannel.sentMessages.length).to.equal(2);
  });
});

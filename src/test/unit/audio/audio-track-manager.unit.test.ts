import * as assert from "assert";
import { AudioContextProvider } from "../../../audio/audio-context-provider";
import { AudioTrackManager } from "../../../audio/audio-track-manager";
import { Logger } from "../../../core/logger";
import type { RealtimeEvent } from "../../../types/realtime-events";
import type {
  AudioConfiguration,
  ConnectionResult,
  ConnectionStatistics,
  RecoveryEventPayload,
  WebRTCConfig,
  WebRTCEventHandler,
  WebRTCEventType,
  WebRTCTransport,
} from "../../../types/webrtc";
import {
  ConnectionQuality,
  WebRTCConnectionState,
  WebRTCErrorCode,
  WebRTCErrorImpl,
} from "../../../types/webrtc";
import {
  installMockAudioEnvironment,
  MockMediaStream,
} from "./audio-mock-environment";

class MockTransport implements WebRTCTransport {
  public addCalls: Array<{
    track: MediaStreamTrack;
    options?: any;
  }> = [];
  public removeCalls: MediaStreamTrack[] = [];
  public replaceCalls: Array<{
    oldTrack: MediaStreamTrack;
    newTrack: MediaStreamTrack;
    options?: any;
  }> = [];
  public publishedEvents: any[] = [];
  public stats: ConnectionStatistics | undefined;
  public fallback = false;

  async establishConnection(): Promise<ConnectionResult> {
    return {
      success: true,
      connectionId: "mock",
      connectionState: WebRTCConnectionState.Connected,
      audioTracks: [],
    };
  }
  async closeConnection(): Promise<void> {}
  async restartIce(_config: WebRTCConfig): Promise<boolean> {
    return true;
  }
  async recreateDataChannel(_config: WebRTCConfig): Promise<RTCDataChannel | null> {
    return null;
  }
  getConnectionState(): WebRTCConnectionState {
    return WebRTCConnectionState.Connected;
  }
  getConnectionStatistics(): ConnectionStatistics {
    if (!this.stats) {
      throw new Error("stats not set");
    }
    return this.stats;
  }
  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return "open";
  }
  isDataChannelFallbackActive(): boolean {
    return this.fallback;
  }
  publishRecoveryEvent(event: RecoveryEventPayload): void {
    this.publishedEvents.push(event);
  }
  async addAudioTrack(
    track: MediaStreamTrack,
    options?: any,
  ): Promise<void> {
    this.addCalls.push({ track, options });
  }
  async replaceAudioTrack(
    oldTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack,
    options?: any,
  ): Promise<void> {
    this.replaceCalls.push({ oldTrack, newTrack, options });
  }
  async removeAudioTrack(track: MediaStreamTrack): Promise<void> {
    this.removeCalls.push(track);
  }
  getRemoteAudioStream(): MediaStream | null {
    return null;
  }
  getAudioContext(): AudioContext | null {
    return null;
  }
  async sendDataChannelMessage(_message: RealtimeEvent): Promise<void> {}
  addEventListener(_type: WebRTCEventType, _handler: WebRTCEventHandler): void {}
  removeEventListener(_type: WebRTCEventType, _handler: WebRTCEventHandler): void {}
}

describe("AudioTrackManager", () => {
  const audioConfig: AudioConfiguration = {
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
      resumeOnActivation: false,
      requiresUserGesture: false,
    },
    workletModuleUrls: [] as ReadonlyArray<string>,
  };

  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  it("captures microphone audio through the processing graph", async () => {
    const logger = new Logger("AudioTrackManagerTest");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);
    const capturedStreams: MockMediaStream[] = [];
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );

    (navigator.mediaDevices.getUserMedia as any) = async (
      constraints?: MediaStreamConstraints,
    ) => {
      const result = (await originalGetUserMedia(
        constraints,
      )) as unknown as MockMediaStream;
      capturedStreams.push(result);
      return result as unknown as MediaStream;
    };

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      const processedTrack = await manager.captureMicrophone();
      assert.ok(processedTrack, "Processed track should be returned");

      const rawStream = capturedStreams[0];
      const rawTrack = rawStream?.getAudioTracks()[0];
      assert.ok(rawTrack, "Capture pipeline should retain raw input track");
      assert.notStrictEqual(
        processedTrack.id,
        rawTrack?.id,
        "Processed track must differ from raw microphone track",
      );
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      manager.dispose();
      logger.dispose();
    }
  });

  it("propagates mute state to underlying input track", async () => {
    const logger = new Logger("AudioTrackManagerTestMute");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      const processedTrack = await manager.captureMicrophone();
      const rawTrack = env.capturedStreams[0]!.getAudioTracks()[0];

      manager.setTrackMuted(processedTrack.id, true);
      assert.strictEqual(processedTrack.enabled, false);
      assert.strictEqual(rawTrack.enabled, false);

      manager.setTrackMuted(processedTrack.id, false);
      assert.strictEqual(processedTrack.enabled, true);
      assert.strictEqual(rawTrack.enabled, true);
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("stops and cleans up capture graph when track ends", async () => {
    const logger = new Logger("AudioTrackManagerTestStop");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      const processedTrack = await manager.captureMicrophone();
      const rawTrack = env.capturedStreams[0]!.getAudioTracks()[0];

      manager.stopTrack(processedTrack.id);

      assert.strictEqual(processedTrack.readyState, "ended");
      assert.strictEqual(rawTrack.readyState, "ended");
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("keeps adaptive sample rates within supported bounds", async () => {
    const logger = new Logger("AudioTrackManagerSampleRateTest");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      manager.adjustAudioQuality(ConnectionQuality.Poor);
      assert.strictEqual(
        (manager as any).audioConstraints.sampleRate,
        16000,
        "Sample rate should clamp to 16 kHz for poor networks",
      );

      manager.adjustAudioQuality(ConnectionQuality.Excellent);
      assert.strictEqual(
        (manager as any).audioConstraints.sampleRate,
        48000,
        "Sample rate should scale up to 48 kHz when excellent",
      );

      manager.adjustAudioQuality(ConnectionQuality.Failed);
      assert.strictEqual(
        (manager as any).audioConstraints.sampleRate,
        48000,
        "Failed state should not reduce sample rate below negotiated bounds",
      );
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("throws during initialization when getUserMedia is unavailable", async () => {
    const logger = new Logger("AudioTrackManagerInitGuard");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

  const original = navigator.mediaDevices.getUserMedia;
  delete (navigator.mediaDevices as any).getUserMedia;

    try {
      await assert.rejects(
        () => manager.initialize(),
        /getUserMedia not supported/,
      );
    } finally {
      (navigator.mediaDevices as any).getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  it("wraps NotAllowedError into non-recoverable WebRTCError", async () => {
    const logger = new Logger("AudioTrackManagerNotAllowed");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    const original = navigator.mediaDevices.getUserMedia;
    (navigator.mediaDevices.getUserMedia as any) = async () => {
      const error = new Error("denied");
      (error as any).name = "NotAllowedError";
      throw error;
    };

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      await assert.rejects(async () => {
        await manager.captureMicrophone();
      }, (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.AudioTrackFailed);
        assert.strictEqual(error.recoverable, false);
        return true;
      });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  it("marks NotFoundError as non-recoverable when microphone missing", async () => {
    const logger = new Logger("AudioTrackManagerNotFound");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    const original = navigator.mediaDevices.getUserMedia;
    (navigator.mediaDevices.getUserMedia as any) = async () => {
      const error = new Error("missing");
      (error as any).name = "NotFoundError";
      throw error;
    };

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      await assert.rejects(async () => {
        await manager.captureMicrophone();
      }, (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.AudioTrackFailed);
        assert.strictEqual(error.recoverable, false);
        return true;
      });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  it("treats unexpected capture errors as recoverable", async () => {
    const logger = new Logger("AudioTrackManagerGenericError");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    const original = navigator.mediaDevices.getUserMedia;
    (navigator.mediaDevices.getUserMedia as any) = async () => {
      throw new Error("transient failure");
    };

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      await assert.rejects(async () => {
        await manager.captureMicrophone();
      }, (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.AudioTrackFailed);
        assert.strictEqual(error.recoverable, true);
        return true;
      });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  it("adds processed tracks to the WebRTC transport with metadata", async () => {
    const logger = new Logger("AudioTrackManagerTransportAdd");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);
    const transport = new MockTransport();

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);
      const track = await manager.captureMicrophone();

      await manager.addTrackToTransport(transport, track);

      assert.strictEqual(transport.addCalls.length, 1);
      const call = transport.addCalls[0];
      assert.strictEqual(call.track, track);
      assert.ok(call.options?.processedStream, "Processed stream should be included");
      assert.ok(call.options?.sourceStream, "Source stream should be retained");
      assert.strictEqual(call.options?.metadata?.graphNodes, "active");
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("removes transport tracks and emits terminal state", async () => {
    const logger = new Logger("AudioTrackManagerTransportRemove");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);
    const transport = new MockTransport();
    const states: Array<{ trackId: string; ended: boolean }> = [];

    manager.onTrackStateChanged((trackId, state) => {
      states.push({ trackId, ended: state.ended });
    });

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);
      const track = await manager.captureMicrophone();

      await manager.addTrackToTransport(transport, track);
      await manager.removeTrackFromTransport(transport, track);

      assert.strictEqual(transport.removeCalls.length, 1);
      assert.strictEqual(transport.removeCalls[0], track);
      assert.ok(states.some((entry) => entry.trackId === track.id && entry.ended));
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("switches audio devices using transport replace logic when available", async () => {
    const logger = new Logger("AudioTrackManagerSwitchDevice");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);
    const transport = new MockTransport();

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);
      await manager.captureMicrophone();

      const newTrack = await manager.switchAudioDevice("mock-device", transport);

      assert.ok(newTrack, "Switching devices should return the new track");
      assert.strictEqual(transport.replaceCalls.length, 1);
      const replaceCall = transport.replaceCalls[0];
      assert.strictEqual(replaceCall.newTrack, newTrack);
      assert.ok(replaceCall.options?.processedStream, "Replacement should include processed stream metadata");
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  it("monitors connection quality and clears interval on stop", async () => {
    const logger = new Logger("AudioTrackManagerQualityMonitor");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);
    const transport = new MockTransport();
    transport.stats = {
      connectionId: "abc",
      connectionDurationMs: 2000,
      audioPacketsSent: 2,
      audioPacketsReceived: 2,
      audioBytesSent: 32000,
      audioBytesReceived: 16000,
      currentRoundTripTime: 10,
      packetsLost: 0,
      jitter: 2,
      dataChannelState: "open",
      iceConnectionState: "connected",
      connectionQuality: ConnectionQuality.Good,
    };

    const qualityEvents: ConnectionQuality[] = [];
    manager.onTrackQualityChanged((quality) => qualityEvents.push(quality));

    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    let clearedHandle: any;
    let handleCounter = 0;

    (global as any).setInterval = (fn: () => void) => {
      handleCounter += 1;
      fn();
      return handleCounter;
    };
    (global as any).clearInterval = (handle: any) => {
      clearedHandle = handle;
    };

    try {
      await manager.initialize();
      manager.startQualityMonitor(transport, 5);
      assert.deepStrictEqual(qualityEvents, [ConnectionQuality.Good]);

      manager.stopQualityMonitor();
      assert.strictEqual(clearedHandle, 1);
    } finally {
      (global as any).setInterval = originalSetInterval;
      (global as any).clearInterval = originalClearInterval;
      manager.dispose();
      logger.dispose();
    }
  });

  it("builds track statistics with derived bitrate and audio level", async () => {
    const logger = new Logger("AudioTrackManagerStats");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);
      const track = await manager.captureMicrophone();

      const stats: ConnectionStatistics = {
        connectionId: "stat",
        connectionDurationMs: 4000,
        audioPacketsSent: 100,
        audioPacketsReceived: 120,
        audioBytesSent: 64000,
        audioBytesReceived: 128000,
        currentRoundTripTime: 12,
        packetsLost: 1,
        jitter: 3,
        dataChannelState: "open",
        iceConnectionState: "connected",
        connectionQuality: ConnectionQuality.Excellent,
      };

      const snapshot = manager.getTrackStatistics(track, stats);
      assert.strictEqual(snapshot.trackId, track.id);
      assert.ok(snapshot.bitrate && snapshot.bitrate > 0);
      assert.strictEqual(snapshot.jitter, stats.jitter);
      assert.strictEqual(snapshot.audioLevel, 0.9);
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });
});

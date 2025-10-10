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
import { expect } from "../../helpers/chai-setup";
import { afterEach, suite, test } from "../../mocha-globals";
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

suite("Unit: AudioTrackManager", () => {
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

  test("captures microphone audio through the processing graph", async () => {
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
      expect(processedTrack, "Processed track should be returned").to.exist;

      const rawStream = capturedStreams[0];
      const rawTrack = rawStream?.getAudioTracks()[0];
      expect(rawTrack, "Capture pipeline should retain raw input track").to.exist;
      expect(processedTrack.id, "Processed track must differ from raw microphone track").to.not.equal(
        rawTrack?.id,
      );
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      manager.dispose();
      logger.dispose();
    }
  });

  test("propagates mute state to underlying input track", async () => {
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
      expect(processedTrack.enabled).to.be.false;
      expect(rawTrack.enabled).to.be.false;

      manager.setTrackMuted(processedTrack.id, false);
      expect(processedTrack.enabled).to.be.true;
      expect(rawTrack.enabled).to.be.true;
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("stops and cleans up capture graph when track ends", async () => {
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

      expect(processedTrack.readyState).to.equal("ended");
      expect(rawTrack.readyState).to.equal("ended");
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("keeps adaptive sample rates within supported bounds", async () => {
    const logger = new Logger("AudioTrackManagerSampleRateTest");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    try {
      await manager.initialize();
      manager.setAudioConfiguration(audioConfig);

      manager.adjustAudioQuality(ConnectionQuality.Poor);
      expect((manager as any).audioConstraints.sampleRate, "Sample rate should clamp to 16 kHz for poor networks")
        .to.equal(16000);

      manager.adjustAudioQuality(ConnectionQuality.Excellent);
      expect((manager as any).audioConstraints.sampleRate, "Sample rate should scale up to 48 kHz when excellent")
        .to.equal(48000);

      manager.adjustAudioQuality(ConnectionQuality.Failed);
      expect((manager as any).audioConstraints.sampleRate, "Failed state should not reduce sample rate below negotiated bounds")
        .to.equal(48000);
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("throws during initialization when getUserMedia is unavailable", async () => {
    const logger = new Logger("AudioTrackManagerInitGuard");
    logger.setLevel("error");
    const provider = new AudioContextProvider();
    const manager = new AudioTrackManager(logger, provider);

    const original = navigator.mediaDevices.getUserMedia;
    delete (navigator.mediaDevices as any).getUserMedia;

    try {
      await expect(manager.initialize()).to.be.rejectedWith(/getUserMedia not supported/);
    } finally {
      (navigator.mediaDevices as any).getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  test("wraps NotAllowedError into non-recoverable WebRTCError", async () => {
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

      await manager
        .captureMicrophone()
        .then(() => expect.fail("captureMicrophone should reject when permission denied"))
        .catch((error: unknown) => {
          expect(error).to.be.instanceOf(WebRTCErrorImpl);
          expect((error as WebRTCErrorImpl).code).to.equal(WebRTCErrorCode.AudioTrackFailed);
          expect((error as WebRTCErrorImpl).recoverable).to.be.false;
        });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  test("marks NotFoundError as non-recoverable when microphone missing", async () => {
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

      await manager
        .captureMicrophone()
        .then(() => expect.fail("captureMicrophone should reject when device missing"))
        .catch((error: unknown) => {
          expect(error).to.be.instanceOf(WebRTCErrorImpl);
          expect((error as WebRTCErrorImpl).code).to.equal(WebRTCErrorCode.AudioTrackFailed);
          expect((error as WebRTCErrorImpl).recoverable).to.be.false;
        });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  test("treats unexpected capture errors as recoverable", async () => {
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

      await manager
        .captureMicrophone()
        .then(() => expect.fail("captureMicrophone should reject on unexpected errors"))
        .catch((error: unknown) => {
          expect(error).to.be.instanceOf(WebRTCErrorImpl);
          expect((error as WebRTCErrorImpl).code).to.equal(WebRTCErrorCode.AudioTrackFailed);
          expect((error as WebRTCErrorImpl).recoverable).to.be.true;
        });
    } finally {
      navigator.mediaDevices.getUserMedia = original;
      manager.dispose();
      logger.dispose();
    }
  });

  test("adds processed tracks to the WebRTC transport with metadata", async () => {
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

      expect(transport.addCalls.length).to.equal(1);
      const call = transport.addCalls[0];
      expect(call.track).to.equal(track);
      expect(call.options?.processedStream, "Processed stream should be included").to.exist;
      expect(call.options?.sourceStream, "Source stream should be retained").to.exist;
      expect(call.options?.metadata?.graphNodes).to.equal("active");
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("removes transport tracks and emits terminal state", async () => {
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

      expect(transport.removeCalls.length).to.equal(1);
      expect(transport.removeCalls[0]).to.equal(track);
      expect(states.some((entry) => entry.trackId === track.id && entry.ended)).to.be.true;
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("switches audio devices using transport replace logic when available", async () => {
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

      expect(newTrack, "Switching devices should return the new track").to.exist;
      expect(transport.replaceCalls.length).to.equal(1);
      const replaceCall = transport.replaceCalls[0];
      expect(replaceCall.newTrack).to.equal(newTrack);
      expect(
        replaceCall.options?.processedStream,
        "Replacement should include processed stream metadata",
      ).to.exist;
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });

  test("monitors connection quality and clears interval on stop", async () => {
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
      expect(qualityEvents).to.deep.equal([ConnectionQuality.Good]);

      manager.stopQualityMonitor();
      expect(clearedHandle).to.equal(1);
    } finally {
      (global as any).setInterval = originalSetInterval;
      (global as any).clearInterval = originalClearInterval;
      manager.dispose();
      logger.dispose();
    }
  });

  test("builds track statistics with derived bitrate and audio level", async () => {
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
      expect(snapshot.trackId).to.equal(track.id);
      expect(snapshot.bitrate, "Bitrate should be calculated").to.be.a("number");
      expect(snapshot.bitrate!, "Bitrate should be positive").to.be.greaterThan(0);
      expect(snapshot.jitter).to.equal(stats.jitter);
      expect(snapshot.audioLevel).to.equal(0.9);
    } finally {
      manager.dispose();
      logger.dispose();
    }
  });
});

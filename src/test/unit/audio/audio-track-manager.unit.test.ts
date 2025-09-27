import * as assert from "assert";
import { AudioContextProvider } from "../../../audio/audio-context-provider";
import { AudioTrackManager } from "../../../audio/audio-track-manager";
import { Logger } from "../../../core/logger";
import type { AudioConfiguration } from "../../../types/webrtc";
import {
    installMockAudioEnvironment,
    MockMediaStream,
} from "./audio-mock-environment";

describe("AudioTrackManager", () => {
  const audioConfig: AudioConfiguration = {
    sampleRate: 24000,
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
});

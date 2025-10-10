import { AudioCapture } from "../../../audio/audio-capture";
import { AudioContextProvider } from "../../../audio/audio-context-provider";
import type { WebAudioProcessingChain } from "../../../audio/audio-processing-chain";
import { WebAudioProcessingChain as WebAudioProcessingChainImpl } from "../../../audio/audio-processing-chain";
import type { AudioDeviceValidator } from "../../../audio/device-validator";
import { Logger } from "../../../core/logger";
import {
    AudioMetrics,
    AudioProcessingConfig,
    AudioProcessingGraph,
} from "../../../types/audio-capture";
import { AudioErrorCode, AudioErrorSeverity } from "../../../types/audio-errors";
import { expect } from "../../helpers/chai-setup";
import { afterEach, suite, test } from "../../mocha-globals";
import {
    installMockAudioEnvironment,
    MockAudioContext,
    MockMediaStream,
    MockMediaStreamTrack,
} from "./audio-mock-environment";

interface TestHarness {
  capture: AudioCapture;
  updateCalls: Array<Partial<AudioProcessingConfig>>;
  mockContext: AudioContext;
  provider: AudioContextProvider;
}

function createTestHarness(): TestHarness {
  const mockEnvContext = new MockAudioContext({}) as unknown as AudioContext;
  const updateCalls: Array<Partial<AudioProcessingConfig>> = [];

  const provider: AudioContextProvider = {
    configure: () => {},
    getOrCreateContext: async () => mockEnvContext,
    getCurrentContext: () => mockEnvContext,
    ensureContextMatchesConfiguration: async () => {},
    requiresUserGesture: () => false,
    registerStateListener: () => {},
    unregisterStateListener: () => {},
    resume: async () => {},
    suspend: async () => {},
    close: async () => {},
    createGraphForStream: async () => {
      throw new Error("not required for contract tests");
    },
    connectStreamToDestination: async () => {
      throw new Error("not required for contract tests");
    },
  } as unknown as AudioContextProvider;

  const processingChain: WebAudioProcessingChain = {
    createProcessingGraph: async () => {
      throw new Error("not required for contract tests");
    },
    updateProcessingParameters: async (
      _graph: AudioProcessingGraph,
      config: Partial<AudioProcessingConfig>,
    ) => {
      updateCalls.push(config);
    },
    analyzeAudioLevel: () => ({
      inputLevel: 0,
      peakLevel: 0,
      rmsLevel: 0,
      signalToNoiseRatio: 0,
      latencyEstimate: 0,
      latencyEstimateMs: 0,
      bufferHealth: 1,
      droppedFrameCount: 0,
      totalFrameCount: 0,
      analysisWindowMs: 0,
      analysisDurationMs: 0,
      cpuUtilization: 0,
      updatedAt: Date.now(),
    } as AudioMetrics),
    measureLatency: async () => 0,
    disposeGraph: () => {},
  } as unknown as WebAudioProcessingChain;

  const deviceValidator: AudioDeviceValidator = {
    validateDevice: async () => ({
      isValid: true,
      deviceId: "mock",
    }),
  } as unknown as AudioDeviceValidator;

  const capture = new AudioCapture({}, undefined, {
    audioContextProvider: provider,
    processingChain,
    deviceValidator,
  });

  (capture as any).processingGraph = { context: mockEnvContext } as AudioProcessingGraph;

  return {
    capture,
    updateCalls,
    mockContext: mockEnvContext,
    provider,
  };
}

suite("Unit: AudioCapture contract upgrades", () => {
  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  test("exposes the shared AudioContext instance via getAudioContext", () => {
    const { capture, mockContext } = createTestHarness();

    expect(capture.getAudioContext(), "getAudioContext should surface the provider context")
      .to.equal(mockContext);
  });

  test("setAudioProcessing replaces the processing configuration and notifies the chain", async () => {
    const { capture, updateCalls } = createTestHarness();

    const newConfig: AudioProcessingConfig = {
      noiseSuppressionLevel: "high",
      echoCancellationLevel: "low",
      autoGainControlLevel: "off",
      voiceActivitySensitivity: 0.8,
      analysisIntervalMs: 75,
    };

    await capture.setAudioProcessing(newConfig);

    expect(updateCalls[0], "Processing chain should receive the full configuration").to.deep.equal(
      newConfig,
    );
    expect((capture as any).processingConfig, "Internal processing state should mirror the provided configuration")
      .to.deep.equal(newConfig);
  });

  test("updateProcessingConfig merges partial overrides before delegating", async () => {
    const { capture, updateCalls } = createTestHarness();
    const baselineConfig = { ...(capture as any).processingConfig } as AudioProcessingConfig;

    await capture.updateProcessingConfig({ noiseSuppressionLevel: "low" });

    const merged = { ...baselineConfig, noiseSuppressionLevel: "low" };

    expect(updateCalls[0], "Partial updates should expand to the merged configuration").to.deep.equal(merged);
    expect((capture as any).processingConfig, "Internal state should reflect merged processing values")
      .to.deep.equal(merged);
  });

  test("marks buffer underrun errors as recoverable with retry guidance", () => {
    const { capture } = createTestHarness();

    const processingError = (capture as any).createProcessingError(
      AudioErrorCode.BufferUnderrun,
      "Detected buffer underrun",
      true,
    );

    expect(processingError.recovery?.recommendedAction, "Buffer underrun should recommend retry action")
      .to.equal("retry");
    expect(processingError.recovery?.recoverable, "Buffer underrun should be flagged as recoverable").to.be.true;
  });

  test("maps permission failures to fatal severity with prompt guidance", () => {
    const { capture } = createTestHarness();

    const permissionError = (capture as any).mapGetUserMediaError(
      { name: "NotAllowedError", message: "Permission denied" },
      "mock-device",
    );

    expect(permissionError.code).to.equal("PERMISSION_DENIED");
    expect(permissionError.severity).to.equal(AudioErrorSeverity.Fatal);
    expect(permissionError.recovery?.recoverable).to.be.false;
    expect(permissionError.recovery?.recommendedAction).to.equal("prompt");
    expect(permissionError.context?.sampleRate).to.equal(
      (capture as any).captureConfig.sampleRate,
    );
    expect(permissionError.context?.permissionsStatus).to.equal("unknown");
  });

  test("classifies unavailable devices as recoverable with retry guidance", () => {
    const { capture } = createTestHarness();

    const unavailableError = (capture as any).mapGetUserMediaError(
      { name: "NotReadableError", message: "Device busy" },
      "mock-device",
    );

    expect(unavailableError.code).to.equal("DEVICE_UNAVAILABLE");
    expect(unavailableError.severity).to.equal(AudioErrorSeverity.Warning);
    expect(unavailableError.recovery?.recoverable).to.be.true;
    expect(unavailableError.recovery?.recommendedAction).to.equal("retry");
    expect(unavailableError.recovery?.retryAfterMs).to.equal(1000);
  });

  test("negotiates supported sample rate from device settings", async () => {
    const logger = new Logger("AudioCaptureSampleRateTest");
    logger.setLevel("error");
    const provider = new AudioContextProvider(logger);
    const processingChain = new WebAudioProcessingChainImpl(logger, provider);
    const deviceValidator: AudioDeviceValidator = {
      validateDevice: async (deviceId?: string) => ({
        isValid: true,
        deviceId: deviceId ?? "mock-device",
        label: "Mock Microphone",
      }),
    } as AudioDeviceValidator;

    const capture = new AudioCapture({}, logger, {
      audioContextProvider: provider,
      processingChain,
      deviceValidator,
    });

    const permissionGrantedEvents: any[] = [];
    capture.addEventListener("permissionGranted", (event) => {
      permissionGrantedEvents.push(event);
    });

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    (navigator.mediaDevices.getUserMedia as any) = async () => {
      const track = new MockMediaStreamTrack("hi-res-mic", {
        sampleRate: 44100,
        channelCount: 2,
      });
      const stream = new MockMediaStream([track]);
      return stream as unknown as MediaStream;
    };

    const originalPermissions = (navigator as any).permissions;
    (navigator as any).permissions = {
      query: async () => ({ state: "prompt" as PermissionState }),
    };

    try {
      await capture.initialize();
      await capture.startCapture();

      expect(permissionGrantedEvents.length, "permissionGranted event should fire once").to.equal(1);
      expect(permissionGrantedEvents[0].data?.sampleRate, "Event should advertise negotiated supported sample rate")
        .to.equal(48000);
      expect(permissionGrantedEvents[0].data?.channelCount, "Event should include negotiated channel count")
        .to.equal(2);
      expect(
        permissionGrantedEvents[0].data?.guidance,
        "Event should surface user guidance",
      ).to.exist;
      expect((capture as any).captureConfig.sampleRate, "Capture configuration should adopt supported sample rate")
        .to.equal(48000);
      const context = capture.getAudioContext();
      expect(context?.sampleRate, "Shared AudioContext should be recreated at negotiated sample rate").to.equal(48000);
    } finally {
      await capture.stopCapture();
      capture.dispose();
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      if (originalPermissions) {
        (navigator as any).permissions = originalPermissions;
      } else {
        delete (navigator as any).permissions;
      }
      logger.dispose();
    }
  });

  test("emits permissionDenied guidance when microphone access is blocked", async () => {
    const logger = new Logger("AudioCapturePermissionDeniedTest");
    logger.setLevel("error");
    const provider = new AudioContextProvider(logger);
    const processingChain = new WebAudioProcessingChainImpl(logger, provider);
    const deviceValidator: AudioDeviceValidator = {
      validateDevice: async (deviceId?: string) => ({
        isValid: true,
        deviceId: deviceId ?? "mock-device",
      }),
    } as AudioDeviceValidator;

    const capture = new AudioCapture({}, logger, {
      audioContextProvider: provider,
      processingChain,
      deviceValidator,
    });

    const deniedEvents: any[] = [];
    capture.addEventListener("permissionDenied", (event) => {
      deniedEvents.push(event);
    });

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    (navigator.mediaDevices.getUserMedia as any) = async () => {
      const error = new Error("Denied");
      (error as any).name = "NotAllowedError";
      throw error;
    };

    const originalPermissions = (navigator as any).permissions;
    (navigator as any).permissions = {
      query: async () => ({ state: "prompt" as PermissionState }),
    };

    try {
      await capture.initialize();
      await expect(capture.startCapture()).to.be.rejectedWith(/Microphone access was denied/i);

      expect(deniedEvents.length, "permissionDenied event should be emitted once").to.equal(1);
      const event = deniedEvents[0];
      expect(
        /Enable microphone/i.test(event.data?.guidance ?? ""),
        "Guidance should instruct the user to unblock the microphone",
      ).to.be.true;
      expect(event.data?.canRetry).to.be.false;
      expect(capture.getAudioContext()).to.equal(null);
    } finally {
      capture.dispose();
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      if (originalPermissions) {
        (navigator as any).permissions = originalPermissions;
      } else {
        delete (navigator as any).permissions;
      }
      logger.dispose();
    }
  });
});

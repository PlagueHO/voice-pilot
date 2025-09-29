import * as assert from "assert";
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

describe("AudioCapture contract upgrades", () => {
  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  it("exposes the shared AudioContext instance via getAudioContext", () => {
    const { capture, mockContext } = createTestHarness();

    assert.strictEqual(
      capture.getAudioContext(),
      mockContext,
      "getAudioContext should surface the provider context",
    );
  });

  it("setAudioProcessing replaces the processing configuration and notifies the chain", async () => {
    const { capture, updateCalls } = createTestHarness();

    const newConfig: AudioProcessingConfig = {
      noiseSuppressionLevel: "high",
      echoCancellationLevel: "low",
      autoGainControlLevel: "off",
      voiceActivitySensitivity: 0.8,
      analysisIntervalMs: 75,
    };

    await capture.setAudioProcessing(newConfig);

    assert.deepStrictEqual(
      updateCalls[0],
      newConfig,
      "Processing chain should receive the full configuration",
    );
    assert.deepStrictEqual(
      (capture as any).processingConfig,
      newConfig,
      "Internal processing state should mirror the provided configuration",
    );
  });

  it("updateProcessingConfig merges partial overrides before delegating", async () => {
    const { capture, updateCalls } = createTestHarness();
    const baselineConfig = { ...(capture as any).processingConfig } as AudioProcessingConfig;

    await capture.updateProcessingConfig({ noiseSuppressionLevel: "low" });

    const merged = { ...baselineConfig, noiseSuppressionLevel: "low" };

    assert.deepStrictEqual(
      updateCalls[0],
      merged,
      "Partial updates should expand to the merged configuration",
    );
    assert.deepStrictEqual(
      (capture as any).processingConfig,
      merged,
      "Internal state should reflect merged processing values",
    );
  });

  it("marks buffer underrun errors as recoverable with retry guidance", () => {
    const { capture } = createTestHarness();

    const processingError = (capture as any).createProcessingError(
      AudioErrorCode.BufferUnderrun,
      "Detected buffer underrun",
      true,
    );

    assert.strictEqual(
      processingError.recovery?.recommendedAction,
      "retry",
      "Buffer underrun should recommend retry action",
    );
    assert.strictEqual(
      processingError.recovery?.recoverable,
      true,
      "Buffer underrun should be flagged as recoverable",
    );
  });

  it("maps permission failures to fatal severity with prompt guidance", () => {
    const { capture } = createTestHarness();

    const permissionError = (capture as any).mapGetUserMediaError(
      { name: "NotAllowedError", message: "Permission denied" },
      "mock-device",
    );

    assert.strictEqual(permissionError.code, "PERMISSION_DENIED");
    assert.strictEqual(permissionError.severity, AudioErrorSeverity.Fatal);
    assert.strictEqual(permissionError.recovery?.recoverable, false);
    assert.strictEqual(permissionError.recovery?.recommendedAction, "prompt");
    assert.strictEqual(
      permissionError.context?.sampleRate,
      (capture as any).captureConfig.sampleRate,
    );
    assert.strictEqual(permissionError.context?.permissionsStatus, "unknown");
  });

  it("classifies unavailable devices as recoverable with retry guidance", () => {
    const { capture } = createTestHarness();

    const unavailableError = (capture as any).mapGetUserMediaError(
      { name: "NotReadableError", message: "Device busy" },
      "mock-device",
    );

    assert.strictEqual(unavailableError.code, "DEVICE_UNAVAILABLE");
    assert.strictEqual(unavailableError.severity, AudioErrorSeverity.Warning);
    assert.strictEqual(unavailableError.recovery?.recoverable, true);
    assert.strictEqual(unavailableError.recovery?.recommendedAction, "retry");
  assert.strictEqual(unavailableError.recovery?.retryAfterMs, 1000);
  });

  it("negotiates supported sample rate from device settings", async () => {
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

      assert.strictEqual(
        permissionGrantedEvents.length,
        1,
        "permissionGranted event should fire once",
      );
      assert.strictEqual(
        permissionGrantedEvents[0].data?.sampleRate,
        48000,
        "Event should advertise negotiated supported sample rate",
      );
      assert.strictEqual(
        permissionGrantedEvents[0].data?.channelCount,
        2,
        "Event should include negotiated channel count",
      );
      assert.ok(
        permissionGrantedEvents[0].data?.guidance,
        "Event should surface user guidance",
      );
      assert.strictEqual(
        (capture as any).captureConfig.sampleRate,
        48000,
        "Capture configuration should adopt supported sample rate",
      );
      const context = capture.getAudioContext();
      assert.strictEqual(
        context?.sampleRate,
        48000,
        "Shared AudioContext should be recreated at negotiated sample rate",
      );
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

  it("emits permissionDenied guidance when microphone access is blocked", async () => {
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
      await assert.rejects(capture.startCapture(), (error: any) => {
        assert.ok(
          /Microphone access was denied/i.test(error.message),
          "Start capture should reject with permission guidance",
        );
        return true;
      });

      assert.strictEqual(
        deniedEvents.length,
        1,
        "permissionDenied event should be emitted once",
      );
      const event = deniedEvents[0];
      assert.ok(
        /Enable microphone/i.test(event.data?.guidance ?? ""),
        "Guidance should instruct the user to unblock the microphone",
      );
      assert.strictEqual(event.data?.canRetry, false);
      assert.strictEqual(capture.getAudioContext(), null);
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

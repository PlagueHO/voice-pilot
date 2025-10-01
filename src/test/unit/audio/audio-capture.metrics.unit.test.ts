import * as assert from "assert";
import { AudioCapture } from "../../../audio/audio-capture";
import { AudioContextProvider } from "../../../audio/audio-context-provider";
import { WebAudioProcessingChain } from "../../../audio/audio-processing-chain";
import { AudioDeviceValidator } from "../../../audio/device-validator";
import type {
    AudioMetrics,
    AudioProcessingGraph,
    RenderQuantumTelemetry,
} from "../../../types/audio-capture";
import { AudioErrorCode } from "../../../types/audio-errors";
import {
    installMockAudioEnvironment,
    MockAnalyserNode,
    MockAudioContext,
    MockAudioWorkletNode,
    MockGainNode,
    MockMediaStream,
    MockMediaStreamAudioSourceNode,
    MockMediaStreamTrack,
} from "./audio-mock-environment";

describe("AudioCapture performance diagnostics", () => {
  let env = installMockAudioEnvironment();

  beforeEach(() => {
    env = installMockAudioEnvironment();
  });

  afterEach(() => {
    env.restore();
  });

  function createMockGraph(): AudioProcessingGraph {
    const context = new MockAudioContext({ sampleRate: 24000 });
    const track = new MockMediaStreamTrack("diagnostic-track");
    const stream = new MockMediaStream([track]);
    const source = new MockMediaStreamAudioSourceNode(context, {
      mediaStream: stream,
    });
    const gainNode = new MockGainNode(context);
    const analyserNode = new MockAnalyserNode(context);
    const workletNode = new MockAudioWorkletNode(context, "pcm-encoder") as unknown as AudioWorkletNode;

    return {
      context: context as unknown as AudioContext,
      source: source as unknown as MediaStreamAudioSourceNode,
      gainNode: gainNode as unknown as GainNode,
      analyserNode: analyserNode as unknown as AnalyserNode,
      workletNode,
    };
  }

  function flushMetricsLoop(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof setImmediate === "function") {
        setImmediate(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function createCapture(
    overrideMetrics?: Partial<AudioMetrics>,
    telemetrySink?: RenderQuantumTelemetry[],
  ) {
    const provider = {
      configure: () => {},
      getOrCreateContext: async () => new MockAudioContext({ sampleRate: 24000 }) as unknown as AudioContext,
      getCurrentContext: () => new MockAudioContext({ sampleRate: 24000 }) as unknown as AudioContext,
      ensureContextMatchesConfiguration: async () => {},
      requiresUserGesture: () => false,
      registerStateListener: () => {},
      unregisterStateListener: () => {},
      resume: async () => {},
      suspend: async () => {},
      close: async () => {},
      createGraphForStream: async () => {
        throw new Error("Not required for diagnostics tests");
      },
      connectStreamToDestination: async () => {
        throw new Error("Not required for diagnostics tests");
      },
    } as unknown as AudioContextProvider;

    const metrics: AudioMetrics = {
      inputLevel: 0.5,
      peakLevel: 0.6,
      rmsLevel: 0.4,
      signalToNoiseRatio: 20,
      latencyEstimate: 0.05,
      latencyEstimateMs: 50,
      bufferHealth: 0.9,
      droppedFrameCount: 2,
      totalFrameCount: 200,
      analysisWindowMs: 100,
      analysisDurationMs: 2,
      cpuUtilization: 0.025,
      updatedAt: Date.now(),
      renderQuantumFrames: 128,
      expectedRenderQuantumFrames: 128,
      renderUnderrunCount: 0,
      renderOverrunCount: 0,
      renderDroppedFrameCount: 0,
      consecutiveUnderruns: 0,
      lastRenderUnderrunAt: undefined,
      ...overrideMetrics,
    };

    const processingChain = {
      createProcessingGraph: async () => createMockGraph(),
      updateProcessingParameters: async () => {},
      analyzeAudioLevel: () => metrics,
      measureLatency: async () => metrics.latencyEstimate,
      disposeGraph: () => {},
      ingestRenderTelemetry: (
        _graph: AudioProcessingGraph,
        telemetry: RenderQuantumTelemetry,
      ) => {
        telemetrySink?.push(telemetry);
      },
      addRenderTelemetryListener: () => () => {},
      removeRenderTelemetryListener: () => {},
    } as unknown as WebAudioProcessingChain;

    const deviceValidator = {
      validateDevice: async () => ({
        isValid: true,
        deviceId: "mock-device",
      }),
    } as unknown as AudioDeviceValidator;

    const capture = new AudioCapture({}, undefined, {
      audioContextProvider: provider,
      processingChain,
      deviceValidator,
    });

  (capture as any).processingGraph = createMockGraph();

    return capture;
  }

  it("records initialization and analysis performance budgets", async () => {
    const capture = createCapture();

    await capture.initialize();

    try {
      await capture.startCapture();
      await flushMetricsLoop();

      const diagnostics = capture.getPerformanceDiagnostics();
      assert.ok(diagnostics.budgets.length >= 2, "Expected diagnostics for initialization and analysis budgets");
      const initialization = diagnostics.budgets.find((item) => item.id === "initialization");
      const analysis = diagnostics.budgets.find((item) => item.id === "analysis-cycle");

      assert.ok(initialization, "Initialization budget should be tracked");
      assert.ok(analysis, "Analysis cycle budget should be tracked");
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  it("captures CPU utilization samples", async () => {
    const capture = createCapture();

    await capture.initialize();

    try {
      await capture.startCapture();
      await flushMetricsLoop();

      const diagnostics = capture.getPerformanceDiagnostics();
      assert.ok(diagnostics.cpu, "CPU diagnostics should be available");
      assert.ok(
        typeof diagnostics.cpu!.maxUtilization === "number",
        "CPU diagnostics should include utilization statistics",
      );
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  it("forwards render telemetry payloads from the audio worklet", async () => {
    const telemetryEvents: RenderQuantumTelemetry[] = [];
    const capture = createCapture(undefined, telemetryEvents);

    await capture.initialize();

    try {
      await capture.startCapture();
      const graph = (capture as any).processingGraph as AudioProcessingGraph;
      const port = graph.workletNode.port as Record<string, any>;

      assert.ok(typeof port.onmessage === "function", "Worklet port should have an onmessage handler");

      port.onmessage({
        data: {
          type: "render-quantum",
          frameCount: 96,
          expectedFrameCount: 128,
          underrun: true,
          overrun: false,
          droppedFrames: 32,
          timestamp: 0.02,
          sequence: 7,
          totals: {
            underrunCount: 3,
            overrunCount: 0,
          },
        },
      });

      assert.strictEqual(telemetryEvents.length, 1, "Expected telemetry to be forwarded once");
      const event = telemetryEvents[0];
      assert.strictEqual(event.frameCount, 96);
      assert.strictEqual(event.expectedFrameCount, 128);
      assert.strictEqual(event.droppedFrames, 32);
      assert.strictEqual(event.sequence, 7);
      assert.ok(event.underrun);
      assert.ok(event.timestamp > 0);
      assert.strictEqual(event.totals?.underrunCount, 3);
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  it("buffer underrun recovery metadata remains available", () => {
    const capture = createCapture();
    const underrunError = (capture as any).createProcessingError(
      AudioErrorCode.BufferUnderrun,
      "buffer underrun detected",
      true,
    );

    assert.strictEqual(
      underrunError.recovery?.recommendedAction,
      "retry",
      "Buffer underrun errors should recommend retry",
    );
    assert.strictEqual(underrunError.recovery?.recoverable, true);
  });
});

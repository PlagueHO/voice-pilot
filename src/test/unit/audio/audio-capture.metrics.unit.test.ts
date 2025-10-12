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
import { expect } from "../../helpers/chai-setup";
import { afterEach, beforeEach, suite, test } from "../../mocha-globals";
import {
    installMockAudioEnvironment,
    MockAnalyserNode,
    MockAudioContext,
    MockAudioWorkletNode,
    MockGainNode,
    MockMediaStream,
    MockMediaStreamAudioDestinationNode,
    MockMediaStreamAudioSourceNode,
    MockMediaStreamTrack,
} from "./audio-mock-environment";

suite("Unit: AudioCapture performance diagnostics", () => {
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
    const destination = new MockMediaStreamAudioDestinationNode(context);

    return {
      context: context as unknown as AudioContext,
      source: source as unknown as MediaStreamAudioSourceNode,
      gainNode: gainNode as unknown as GainNode,
      analyserNode: analyserNode as unknown as AnalyserNode,
      workletNode,
      destination: destination as unknown as MediaStreamAudioDestinationNode,
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

  test("records initialization and analysis performance budgets", async () => {
    const capture = createCapture();

    await capture.initialize();

    try {
      await capture.startCapture();
      await flushMetricsLoop();

      const diagnostics = capture.getPerformanceDiagnostics();
      expect(
        diagnostics.budgets.length >= 2,
        "Expected diagnostics for initialization and analysis budgets",
      ).to.be.true;
      const initialization = diagnostics.budgets.find((item) => item.id === "initialization");
      const analysis = diagnostics.budgets.find((item) => item.id === "analysis-cycle");

      expect(initialization, "Initialization budget should be tracked").to.exist;
      expect(analysis, "Analysis cycle budget should be tracked").to.exist;
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  test("captures CPU utilization samples", async () => {
    const capture = createCapture();

    await capture.initialize();

    try {
      await capture.startCapture();
      await flushMetricsLoop();

      const diagnostics = capture.getPerformanceDiagnostics();
      expect(diagnostics.cpu, "CPU diagnostics should be available").to.exist;
      expect(
        typeof diagnostics.cpu!.maxUtilization === "number",
        "CPU diagnostics should include utilization statistics",
      ).to.be.true;
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  test("forwards render telemetry payloads from the audio worklet", async () => {
    const telemetryEvents: RenderQuantumTelemetry[] = [];
    const capture = createCapture(undefined, telemetryEvents);

    await capture.initialize();

    try {
      await capture.startCapture();
      const graph = (capture as any).processingGraph as AudioProcessingGraph;
      const port = graph.workletNode.port as Record<string, any>;

      expect(typeof port.onmessage === "function", "Worklet port should have an onmessage handler").to.be.true;

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

      expect(telemetryEvents.length, "Expected telemetry to be forwarded once").to.equal(1);
      const event = telemetryEvents[0];
      expect(event.frameCount).to.equal(96);
      expect(event.expectedFrameCount).to.equal(128);
      expect(event.droppedFrames).to.equal(32);
      expect(event.sequence).to.equal(7);
      expect(event.underrun).to.be.true;
      expect(event.timestamp > 0).to.be.true;
      expect(event.totals?.underrunCount).to.equal(3);
    } finally {
      await capture.stopCapture();
      capture.dispose();
    }
  });

  test("buffer underrun recovery metadata remains available", () => {
    const capture = createCapture();
    const underrunError = (capture as any).createProcessingError(
      AudioErrorCode.BufferUnderrun,
      "buffer underrun detected",
      true,
    );

    expect(underrunError.recovery?.recommendedAction, "Buffer underrun errors should recommend retry").to.equal(
      "retry",
    );
    expect(underrunError.recovery?.recoverable).to.be.true;
  });
});

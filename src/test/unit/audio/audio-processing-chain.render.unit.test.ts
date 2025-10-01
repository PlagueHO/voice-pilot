import * as assert from "assert";
import {
    createEmptyMetrics,
    DEFAULT_EXPECTED_RENDER_QUANTUM,
} from "../../../audio/audio-metrics";
import { WebAudioProcessingChain } from "../../../audio/audio-processing-chain";
import type {
    AudioProcessingGraph,
    RenderQuantumTelemetry,
} from "../../../types/audio-capture";
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

describe("WebAudioProcessingChain render telemetry", () => {
  let environment = installMockAudioEnvironment();

  beforeEach(() => {
    environment = installMockAudioEnvironment();
  });

  afterEach(() => {
    environment.restore();
  });

  async function createGraph() {
    const chain = new WebAudioProcessingChain();
    const context = new MockAudioContext({ sampleRate: 24000 });
    const stream = new MockMediaStream([
      new MockMediaStreamTrack("render-test-track"),
    ]);
    const source = new MockMediaStreamAudioSourceNode(context, {
      mediaStream: stream,
    });
    const gainNode = new MockGainNode(context);
    const analyserNode = new MockAnalyserNode(context);
    const workletNode = new MockAudioWorkletNode(context, "pcm-encoder");

    const graph: AudioProcessingGraph = {
      context: context as unknown as AudioContext,
      source: source as unknown as MediaStreamAudioSourceNode,
      gainNode: gainNode as unknown as GainNode,
      analyserNode: analyserNode as unknown as AnalyserNode,
      workletNode: workletNode as unknown as AudioWorkletNode,
    };

    const metricsState = (chain as any).metricsState as WeakMap<
      AudioProcessingGraph,
      Record<string, unknown>
    >;

    metricsState.set(graph, {
      totalFrames: 0,
      droppedFrames: 0,
      lastAnalysisTimestamp: performance.now(),
      metrics: createEmptyMetrics(),
      lastRenderQuantum: DEFAULT_EXPECTED_RENDER_QUANTUM,
      expectedRenderQuantum: DEFAULT_EXPECTED_RENDER_QUANTUM,
      renderUnderrunCount: 0,
      renderOverrunCount: 0,
      consecutiveUnderruns: 0,
      renderFrameTotal: 0,
      telemetryListeners: new Set(),
    });

    return { chain, graph };
  }

  it("updates metrics and notifies listeners when render telemetry is ingested", async () => {
    const { chain, graph } = await createGraph();
    const received: RenderQuantumTelemetry[] = [];
    const disposeListener = chain.addRenderTelemetryListener(graph, (event) => {
      received.push(event);
    });

    try {
      const timestamp = Date.now();
      chain.ingestRenderTelemetry(graph, {
        frameCount: 64,
        expectedFrameCount: 128,
        underrun: true,
        overrun: false,
        droppedFrames: 64,
        timestamp,
        sequence: 1,
      });

      const underrunMetrics = chain.analyzeAudioLevel(graph);
      assert.strictEqual(underrunMetrics.renderUnderrunCount, 1);
      assert.strictEqual(underrunMetrics.renderDroppedFrameCount, 64);
      assert.strictEqual(underrunMetrics.consecutiveUnderruns, 1);
      assert.strictEqual(Math.round(underrunMetrics.bufferHealth * 100), 50);

      chain.ingestRenderTelemetry(graph, {
        frameCount: 128,
        expectedFrameCount: 128,
        underrun: false,
        overrun: false,
        droppedFrames: 0,
        timestamp: timestamp + 5,
        sequence: 2,
      });

      const recoveryMetrics = chain.analyzeAudioLevel(graph);
      assert.strictEqual(recoveryMetrics.renderUnderrunCount, 1);
      assert.strictEqual(recoveryMetrics.renderDroppedFrameCount, 64);
      assert.strictEqual(recoveryMetrics.consecutiveUnderruns, 0);
      assert.strictEqual(Math.round(recoveryMetrics.bufferHealth * 100), 75);

      assert.strictEqual(received.length, 2, "Expected listener to receive two telemetry events");
      assert.ok(received[0].underrun, "First telemetry should reflect an underrun");
      assert.ok(!received[1].underrun, "Second telemetry should be healthy");
    } finally {
      disposeListener();
      chain.disposeGraph(graph);
    }
  });
});

import {
    createEmptyMetrics,
    DEFAULT_EXPECTED_RENDER_QUANTUM,
} from "../../../audio/audio-metrics";
import { WebAudioProcessingChain } from "../../../audio/audio-processing-chain";
import type {
    AudioProcessingGraph,
    RenderQuantumTelemetry,
} from "../../../types/audio-capture";
import { expect } from "../../helpers/chai-setup";
import { afterEach, beforeEach, suite, test } from "../../mocha-globals";
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

suite("Unit: WebAudioProcessingChain render telemetry", () => {
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

  test("updates metrics and notifies listeners when render telemetry is ingested", async () => {
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
      expect(underrunMetrics.renderUnderrunCount).to.equal(1);
      expect(underrunMetrics.renderDroppedFrameCount).to.equal(64);
      expect(underrunMetrics.consecutiveUnderruns).to.equal(1);
      expect(Math.round(underrunMetrics.bufferHealth * 100)).to.equal(50);

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
      expect(recoveryMetrics.renderUnderrunCount).to.equal(1);
      expect(recoveryMetrics.renderDroppedFrameCount).to.equal(64);
      expect(recoveryMetrics.consecutiveUnderruns).to.equal(0);
      expect(Math.round(recoveryMetrics.bufferHealth * 100)).to.equal(75);

      expect(received.length, "Expected listener to receive two telemetry events").to.equal(2);
      expect(received[0].underrun, "First telemetry should reflect an underrun").to.be.true;
      expect(received[1].underrun, "Second telemetry should be healthy").to.be.false;
    } finally {
      disposeListener();
      chain.disposeGraph(graph);
    }
  });
});

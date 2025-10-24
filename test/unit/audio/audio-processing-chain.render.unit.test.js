"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_metrics_1 = require("../../src/../audio/audio-metrics");
const audio_processing_chain_1 = require("../../src/../audio/audio-processing-chain");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
(0, mocha_globals_1.suite)("Unit: WebAudioProcessingChain render telemetry", () => {
    let environment = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.beforeEach)(() => {
        environment = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.afterEach)(() => {
        environment.restore();
    });
    async function createGraph() {
        const chain = new audio_processing_chain_1.WebAudioProcessingChain();
        const context = new audio_mock_environment_1.MockAudioContext({ sampleRate: 24000 });
        const stream = new audio_mock_environment_1.MockMediaStream([
            new audio_mock_environment_1.MockMediaStreamTrack("render-test-track"),
        ]);
        const source = new audio_mock_environment_1.MockMediaStreamAudioSourceNode(context, {
            mediaStream: stream,
        });
        const gainNode = new audio_mock_environment_1.MockGainNode(context);
        const analyserNode = new audio_mock_environment_1.MockAnalyserNode(context);
        const workletNode = new audio_mock_environment_1.MockAudioWorkletNode(context, "pcm-encoder");
        const destination = new audio_mock_environment_1.MockMediaStreamAudioDestinationNode(context);
        const graph = {
            context: context,
            source: source,
            gainNode: gainNode,
            analyserNode: analyserNode,
            workletNode: workletNode,
            destination: destination,
        };
        const metricsState = chain.metricsState;
        metricsState.set(graph, {
            totalFrames: 0,
            droppedFrames: 0,
            lastAnalysisTimestamp: performance.now(),
            metrics: (0, audio_metrics_1.createEmptyMetrics)(),
            lastRenderQuantum: audio_metrics_1.DEFAULT_EXPECTED_RENDER_QUANTUM,
            expectedRenderQuantum: audio_metrics_1.DEFAULT_EXPECTED_RENDER_QUANTUM,
            renderUnderrunCount: 0,
            renderOverrunCount: 0,
            consecutiveUnderruns: 0,
            renderFrameTotal: 0,
            telemetryListeners: new Set(),
        });
        return { chain, graph };
    }
    (0, mocha_globals_1.test)("updates metrics and notifies listeners when render telemetry is ingested", async () => {
        const { chain, graph } = await createGraph();
        const received = [];
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
            (0, chai_setup_1.expect)(underrunMetrics.renderUnderrunCount).to.equal(1);
            (0, chai_setup_1.expect)(underrunMetrics.renderDroppedFrameCount).to.equal(64);
            (0, chai_setup_1.expect)(underrunMetrics.consecutiveUnderruns).to.equal(1);
            (0, chai_setup_1.expect)(Math.round(underrunMetrics.bufferHealth * 100)).to.equal(50);
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
            (0, chai_setup_1.expect)(recoveryMetrics.renderUnderrunCount).to.equal(1);
            (0, chai_setup_1.expect)(recoveryMetrics.renderDroppedFrameCount).to.equal(64);
            (0, chai_setup_1.expect)(recoveryMetrics.consecutiveUnderruns).to.equal(0);
            (0, chai_setup_1.expect)(Math.round(recoveryMetrics.bufferHealth * 100)).to.equal(75);
            (0, chai_setup_1.expect)(received.length, "Expected listener to receive two telemetry events").to.equal(2);
            (0, chai_setup_1.expect)(received[0].underrun, "First telemetry should reflect an underrun").to.be.true;
            (0, chai_setup_1.expect)(received[1].underrun, "Second telemetry should be healthy").to.be.false;
        }
        finally {
            disposeListener();
            chain.disposeGraph(graph);
        }
    });
});
//# sourceMappingURL=audio-processing-chain.render.unit.test.js.map
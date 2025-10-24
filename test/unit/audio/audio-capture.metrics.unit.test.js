"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_capture_1 = require("../../src/../audio/audio-capture");
const audio_errors_1 = require("../../src/../types/audio-errors");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
(0, mocha_globals_1.suite)("Unit: AudioCapture performance diagnostics", () => {
    let env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.beforeEach)(() => {
        env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.afterEach)(() => {
        env.restore();
    });
    function createMockGraph() {
        const context = new audio_mock_environment_1.MockAudioContext({ sampleRate: 24000 });
        const track = new audio_mock_environment_1.MockMediaStreamTrack("diagnostic-track");
        const stream = new audio_mock_environment_1.MockMediaStream([track]);
        const source = new audio_mock_environment_1.MockMediaStreamAudioSourceNode(context, {
            mediaStream: stream,
        });
        const gainNode = new audio_mock_environment_1.MockGainNode(context);
        const analyserNode = new audio_mock_environment_1.MockAnalyserNode(context);
        const workletNode = new audio_mock_environment_1.MockAudioWorkletNode(context, "pcm-encoder");
        const destination = new audio_mock_environment_1.MockMediaStreamAudioDestinationNode(context);
        return {
            context: context,
            source: source,
            gainNode: gainNode,
            analyserNode: analyserNode,
            workletNode,
            destination: destination,
        };
    }
    function flushMetricsLoop() {
        return new Promise((resolve) => {
            if (typeof setImmediate === "function") {
                setImmediate(resolve);
            }
            else {
                setTimeout(resolve, 0);
            }
        });
    }
    function createCapture(overrideMetrics, telemetrySink) {
        const provider = {
            configure: () => { },
            getOrCreateContext: async () => new audio_mock_environment_1.MockAudioContext({ sampleRate: 24000 }),
            getCurrentContext: () => new audio_mock_environment_1.MockAudioContext({ sampleRate: 24000 }),
            ensureContextMatchesConfiguration: async () => { },
            requiresUserGesture: () => false,
            registerStateListener: () => { },
            unregisterStateListener: () => { },
            resume: async () => { },
            suspend: async () => { },
            close: async () => { },
            createGraphForStream: async () => {
                throw new Error("Not required for diagnostics tests");
            },
            connectStreamToDestination: async () => {
                throw new Error("Not required for diagnostics tests");
            },
        };
        const metrics = {
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
            updateProcessingParameters: async () => { },
            analyzeAudioLevel: () => metrics,
            measureLatency: async () => metrics.latencyEstimate,
            disposeGraph: () => { },
            ingestRenderTelemetry: (_graph, telemetry) => {
                telemetrySink?.push(telemetry);
            },
            addRenderTelemetryListener: () => () => { },
            removeRenderTelemetryListener: () => { },
        };
        const deviceValidator = {
            validateDevice: async () => ({
                isValid: true,
                deviceId: "mock-device",
            }),
        };
        const capture = new audio_capture_1.AudioCapture({}, undefined, {
            audioContextProvider: provider,
            processingChain,
            deviceValidator,
        });
        capture.processingGraph = createMockGraph();
        return capture;
    }
    (0, mocha_globals_1.test)("records initialization and analysis performance budgets", async () => {
        const capture = createCapture();
        await capture.initialize();
        try {
            await capture.startCapture();
            await flushMetricsLoop();
            const diagnostics = capture.getPerformanceDiagnostics();
            (0, chai_setup_1.expect)(diagnostics.budgets.length >= 2, "Expected diagnostics for initialization and analysis budgets").to.be.true;
            const initialization = diagnostics.budgets.find((item) => item.id === "initialization");
            const analysis = diagnostics.budgets.find((item) => item.id === "analysis-cycle");
            (0, chai_setup_1.expect)(initialization, "Initialization budget should be tracked").to.exist;
            (0, chai_setup_1.expect)(analysis, "Analysis cycle budget should be tracked").to.exist;
        }
        finally {
            await capture.stopCapture();
            capture.dispose();
        }
    });
    (0, mocha_globals_1.test)("captures CPU utilization samples", async () => {
        const capture = createCapture();
        await capture.initialize();
        try {
            await capture.startCapture();
            await flushMetricsLoop();
            const diagnostics = capture.getPerformanceDiagnostics();
            (0, chai_setup_1.expect)(diagnostics.cpu, "CPU diagnostics should be available").to.exist;
            (0, chai_setup_1.expect)(typeof diagnostics.cpu.maxUtilization === "number", "CPU diagnostics should include utilization statistics").to.be.true;
        }
        finally {
            await capture.stopCapture();
            capture.dispose();
        }
    });
    (0, mocha_globals_1.test)("forwards render telemetry payloads from the audio worklet", async () => {
        const telemetryEvents = [];
        const capture = createCapture(undefined, telemetryEvents);
        await capture.initialize();
        try {
            await capture.startCapture();
            const graph = capture.processingGraph;
            const port = graph.workletNode.port;
            (0, chai_setup_1.expect)(typeof port.onmessage === "function", "Worklet port should have an onmessage handler").to.be.true;
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
            (0, chai_setup_1.expect)(telemetryEvents.length, "Expected telemetry to be forwarded once").to.equal(1);
            const event = telemetryEvents[0];
            (0, chai_setup_1.expect)(event.frameCount).to.equal(96);
            (0, chai_setup_1.expect)(event.expectedFrameCount).to.equal(128);
            (0, chai_setup_1.expect)(event.droppedFrames).to.equal(32);
            (0, chai_setup_1.expect)(event.sequence).to.equal(7);
            (0, chai_setup_1.expect)(event.underrun).to.be.true;
            (0, chai_setup_1.expect)(event.timestamp > 0).to.be.true;
            (0, chai_setup_1.expect)(event.totals?.underrunCount).to.equal(3);
        }
        finally {
            await capture.stopCapture();
            capture.dispose();
        }
    });
    (0, mocha_globals_1.test)("buffer underrun recovery metadata remains available", () => {
        const capture = createCapture();
        const underrunError = capture.createProcessingError(audio_errors_1.AudioErrorCode.BufferUnderrun, "buffer underrun detected", true);
        (0, chai_setup_1.expect)(underrunError.recovery?.recommendedAction, "Buffer underrun errors should recommend retry").to.equal("retry");
        (0, chai_setup_1.expect)(underrunError.recovery?.recoverable).to.be.true;
    });
});
//# sourceMappingURL=audio-capture.metrics.unit.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_capture_1 = require("../../src/../audio/audio-capture");
const audio_context_provider_1 = require("../../src/../audio/audio-context-provider");
const audio_processing_chain_1 = require("../../src/../audio/audio-processing-chain");
const logger_1 = require("../../src/../core/logger");
const audio_errors_1 = require("../../src/../types/audio-errors");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
function createTestHarness() {
    const mockEnvContext = new audio_mock_environment_1.MockAudioContext({});
    const updateCalls = [];
    const provider = {
        configure: () => { },
        getOrCreateContext: async () => mockEnvContext,
        getCurrentContext: () => mockEnvContext,
        ensureContextMatchesConfiguration: async () => { },
        requiresUserGesture: () => false,
        registerStateListener: () => { },
        unregisterStateListener: () => { },
        resume: async () => { },
        suspend: async () => { },
        close: async () => { },
        createGraphForStream: async () => {
            throw new Error("not required for contract tests");
        },
        connectStreamToDestination: async () => {
            throw new Error("not required for contract tests");
        },
    };
    const processingChain = {
        createProcessingGraph: async () => {
            throw new Error("not required for contract tests");
        },
        updateProcessingParameters: async (_graph, config) => {
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
        }),
        measureLatency: async () => 0,
        disposeGraph: () => { },
    };
    const deviceValidator = {
        validateDevice: async () => ({
            isValid: true,
            deviceId: "mock",
        }),
    };
    const capture = new audio_capture_1.AudioCapture({}, undefined, {
        audioContextProvider: provider,
        processingChain,
        deviceValidator,
    });
    const stubGraph = {
        context: mockEnvContext,
        source: {
            disconnect: () => { },
        },
        gainNode: {
            disconnect: () => { },
            gain: { value: 1 },
        },
        analyserNode: {
            disconnect: () => { },
        },
        workletNode: {
            disconnect: () => { },
            port: {
                onmessage: null,
                onmessageerror: null,
                close: () => { },
            },
        },
        destination: {
            disconnect: () => { },
            stream: { id: "mock-destination" },
        },
    };
    capture.processingGraph = stubGraph;
    return {
        capture,
        updateCalls,
        mockContext: mockEnvContext,
        provider,
    };
}
(0, mocha_globals_1.suite)("Unit: AudioCapture contract upgrades", () => {
    let env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.afterEach)(() => {
        env.restore();
        env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.test)("exposes the shared AudioContext instance via getAudioContext", () => {
        const { capture, mockContext } = createTestHarness();
        (0, chai_setup_1.expect)(capture.getAudioContext(), "getAudioContext should surface the provider context")
            .to.equal(mockContext);
    });
    (0, mocha_globals_1.test)("setAudioProcessing replaces the processing configuration and notifies the chain", async () => {
        const { capture, updateCalls } = createTestHarness();
        const newConfig = {
            noiseSuppressionLevel: "high",
            echoCancellationLevel: "low",
            autoGainControlLevel: "off",
            voiceActivitySensitivity: 0.8,
            analysisIntervalMs: 75,
        };
        await capture.setAudioProcessing(newConfig);
        (0, chai_setup_1.expect)(updateCalls[0], "Processing chain should receive the full configuration").to.deep.equal(newConfig);
        (0, chai_setup_1.expect)(capture.processingConfig, "Internal processing state should mirror the provided configuration")
            .to.deep.equal(newConfig);
    });
    (0, mocha_globals_1.test)("updateProcessingConfig merges partial overrides before delegating", async () => {
        const { capture, updateCalls } = createTestHarness();
        const baselineConfig = { ...capture.processingConfig };
        await capture.updateProcessingConfig({ noiseSuppressionLevel: "low" });
        const merged = { ...baselineConfig, noiseSuppressionLevel: "low" };
        (0, chai_setup_1.expect)(updateCalls[0], "Partial updates should expand to the merged configuration").to.deep.equal(merged);
        (0, chai_setup_1.expect)(capture.processingConfig, "Internal state should reflect merged processing values")
            .to.deep.equal(merged);
    });
    (0, mocha_globals_1.test)("marks buffer underrun errors as recoverable with retry guidance", () => {
        const { capture } = createTestHarness();
        const processingError = capture.createProcessingError(audio_errors_1.AudioErrorCode.BufferUnderrun, "Detected buffer underrun", true);
        (0, chai_setup_1.expect)(processingError.recovery?.recommendedAction, "Buffer underrun should recommend retry action")
            .to.equal("retry");
        (0, chai_setup_1.expect)(processingError.recovery?.recoverable, "Buffer underrun should be flagged as recoverable").to.be.true;
    });
    (0, mocha_globals_1.test)("maps permission failures to fatal severity with prompt guidance", () => {
        const { capture } = createTestHarness();
        const permissionError = capture.mapGetUserMediaError({ name: "NotAllowedError", message: "Permission denied" }, "mock-device");
        (0, chai_setup_1.expect)(permissionError.code).to.equal("PERMISSION_DENIED");
        (0, chai_setup_1.expect)(permissionError.severity).to.equal(audio_errors_1.AudioErrorSeverity.Fatal);
        (0, chai_setup_1.expect)(permissionError.recovery?.recoverable).to.be.false;
        (0, chai_setup_1.expect)(permissionError.recovery?.recommendedAction).to.equal("prompt");
        (0, chai_setup_1.expect)(permissionError.context?.sampleRate).to.equal(capture.captureConfig.sampleRate);
        (0, chai_setup_1.expect)(permissionError.context?.permissionsStatus).to.equal("unknown");
    });
    (0, mocha_globals_1.test)("classifies unavailable devices as recoverable with retry guidance", () => {
        const { capture } = createTestHarness();
        const unavailableError = capture.mapGetUserMediaError({ name: "NotReadableError", message: "Device busy" }, "mock-device");
        (0, chai_setup_1.expect)(unavailableError.code).to.equal("DEVICE_UNAVAILABLE");
        (0, chai_setup_1.expect)(unavailableError.severity).to.equal(audio_errors_1.AudioErrorSeverity.Warning);
        (0, chai_setup_1.expect)(unavailableError.recovery?.recoverable).to.be.true;
        (0, chai_setup_1.expect)(unavailableError.recovery?.recommendedAction).to.equal("retry");
        (0, chai_setup_1.expect)(unavailableError.recovery?.retryAfterMs).to.equal(1000);
    });
    (0, mocha_globals_1.test)("negotiates supported sample rate from device settings", async () => {
        const logger = new logger_1.Logger("AudioCaptureSampleRateTest");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider(logger);
        const processingChain = new audio_processing_chain_1.WebAudioProcessingChain(logger, provider);
        const deviceValidator = {
            validateDevice: async (deviceId) => ({
                isValid: true,
                deviceId: deviceId ?? "mock-device",
                label: "Mock Microphone",
            }),
        };
        const capture = new audio_capture_1.AudioCapture({}, logger, {
            audioContextProvider: provider,
            processingChain,
            deviceValidator,
        });
        const permissionGrantedEvents = [];
        capture.addEventListener("permissionGranted", (event) => {
            permissionGrantedEvents.push(event);
        });
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            const track = new audio_mock_environment_1.MockMediaStreamTrack("hi-res-mic", {
                sampleRate: 44100,
                channelCount: 2,
            });
            const stream = new audio_mock_environment_1.MockMediaStream([track]);
            return stream;
        };
        const originalPermissions = navigator.permissions;
        navigator.permissions = {
            query: async () => ({ state: "prompt" }),
        };
        try {
            await capture.initialize();
            await capture.startCapture();
            (0, chai_setup_1.expect)(permissionGrantedEvents.length, "permissionGranted event should fire once").to.equal(1);
            (0, chai_setup_1.expect)(permissionGrantedEvents[0].data?.sampleRate, "Event should advertise negotiated supported sample rate")
                .to.equal(48000);
            (0, chai_setup_1.expect)(permissionGrantedEvents[0].data?.channelCount, "Event should include negotiated channel count")
                .to.equal(2);
            (0, chai_setup_1.expect)(permissionGrantedEvents[0].data?.guidance, "Event should surface user guidance").to.exist;
            (0, chai_setup_1.expect)(capture.captureConfig.sampleRate, "Capture configuration should adopt supported sample rate")
                .to.equal(48000);
            const context = capture.getAudioContext();
            (0, chai_setup_1.expect)(context?.sampleRate, "Shared AudioContext should be recreated at negotiated sample rate").to.equal(48000);
        }
        finally {
            await capture.stopCapture();
            capture.dispose();
            navigator.mediaDevices.getUserMedia = originalGetUserMedia;
            if (originalPermissions) {
                navigator.permissions = originalPermissions;
            }
            else {
                delete navigator.permissions;
            }
            logger.dispose();
        }
    });
    (0, mocha_globals_1.test)("emits permissionDenied guidance when microphone access is blocked", async () => {
        const logger = new logger_1.Logger("AudioCapturePermissionDeniedTest");
        logger.setLevel("error");
        const provider = new audio_context_provider_1.AudioContextProvider(logger);
        const processingChain = new audio_processing_chain_1.WebAudioProcessingChain(logger, provider);
        const deviceValidator = {
            validateDevice: async (deviceId) => ({
                isValid: true,
                deviceId: deviceId ?? "mock-device",
            }),
        };
        const capture = new audio_capture_1.AudioCapture({}, logger, {
            audioContextProvider: provider,
            processingChain,
            deviceValidator,
        });
        const deniedEvents = [];
        capture.addEventListener("permissionDenied", (event) => {
            deniedEvents.push(event);
        });
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            const error = new Error("Denied");
            error.name = "NotAllowedError";
            throw error;
        };
        const originalPermissions = navigator.permissions;
        navigator.permissions = {
            query: async () => ({ state: "prompt" }),
        };
        try {
            await capture.initialize();
            await (0, chai_setup_1.expect)(capture.startCapture()).to.be.rejectedWith(/Microphone access was denied/i);
            (0, chai_setup_1.expect)(deniedEvents.length, "permissionDenied event should be emitted once").to.equal(1);
            const event = deniedEvents[0];
            (0, chai_setup_1.expect)(/Enable microphone/i.test(event.data?.guidance ?? ""), "Guidance should instruct the user to unblock the microphone").to.be.true;
            (0, chai_setup_1.expect)(event.data?.canRetry).to.be.false;
            (0, chai_setup_1.expect)(capture.getAudioContext()).to.equal(null);
        }
        finally {
            capture.dispose();
            navigator.mediaDevices.getUserMedia = originalGetUserMedia;
            if (originalPermissions) {
                navigator.permissions = originalPermissions;
            }
            else {
                delete navigator.permissions;
            }
            logger.dispose();
        }
    });
});
//# sourceMappingURL=audio-capture.contract.unit.test.js.map
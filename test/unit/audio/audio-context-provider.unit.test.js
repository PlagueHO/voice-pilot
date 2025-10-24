"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_context_provider_1 = require("../../src/../audio/audio-context-provider");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
(0, mocha_globals_1.suite)("Unit: AudioContextProvider", () => {
    const baseAudioConfig = {
        sampleRate: 24000,
        codecProfileId: "pcm16-24k-mono",
        format: "pcm16",
        channels: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        audioContextProvider: {
            strategy: "shared",
            latencyHint: "interactive",
            resumeOnActivation: true,
            requiresUserGesture: false,
        },
        workletModuleUrls: [],
    };
    let env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.afterEach)(() => {
        env.restore();
        env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.test)("creates a single shared AudioContext instance", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        provider.configure(baseAudioConfig);
        const contextA = await provider.getOrCreateContext();
        const contextB = await provider.getOrCreateContext();
        (0, chai_setup_1.expect)(contextA, "Context instances should be reused").to.equal(contextB);
        (0, chai_setup_1.expect)(env.createdContexts.length, "Only one context should be created").to.equal(1);
    });
    (0, mocha_globals_1.test)("exposes the current AudioContext via getCurrentContext", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        provider.configure(baseAudioConfig);
        (0, chai_setup_1.expect)(provider.getCurrentContext(), "No context should be available before creation").to.equal(null);
        const context = await provider.getOrCreateContext();
        (0, chai_setup_1.expect)(provider.getCurrentContext(), "getCurrentContext should return the active AudioContext").to.equal(context);
    });
    (0, mocha_globals_1.test)("loads external worklet modules declared in configuration", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        const configWithWorklet = {
            ...baseAudioConfig,
            workletModuleUrls: ["https://example.com/worklet.js"],
        };
        provider.configure(configWithWorklet);
        await provider.getOrCreateContext();
        (0, chai_setup_1.expect)(env.workletModules.includes("https://example.com/worklet.js"), "Worklet module should be loaded via audioWorklet").to.be.true;
    });
    (0, mocha_globals_1.test)("creates a processing graph that emits a processed track", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        provider.configure(baseAudioConfig);
        const context = await provider.getOrCreateContext();
        (0, chai_setup_1.expect)(context.state).to.equal("suspended");
        const inputStream = new audio_mock_environment_1.MockMediaStream([new audio_mock_environment_1.MockMediaStreamTrack("microphone")]);
        const graph = await provider.createGraphForStream(inputStream);
        const processedTracks = graph.destination.stream.getAudioTracks();
        (0, chai_setup_1.expect)(processedTracks.length, "Processed stream should expose a single track").to.equal(1);
        (0, chai_setup_1.expect)(processedTracks[0].id, "Processed track must differ from input track")
            .to.not.equal(inputStream.getAudioTracks()[0].id);
    });
    (0, mocha_globals_1.test)("notifies state listeners when context transitions", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        provider.configure(baseAudioConfig);
        await provider.getOrCreateContext();
        const observedStates = [];
        provider.registerStateListener((state) => {
            observedStates.push(state);
        });
        await provider.resume();
        await provider.suspend();
        await provider.close();
        (0, chai_setup_1.expect)(observedStates).to.deep.equal(["suspended", "running", "suspended", "closed"]);
    });
    (0, mocha_globals_1.test)("cleans up resources and reloads worklets after close", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        const configWithWorklet = {
            ...baseAudioConfig,
            workletModuleUrls: [
                "https://example.com/worklet.js",
            ],
        };
        provider.configure(configWithWorklet);
        const firstContext = await provider.getOrCreateContext();
        const firstContextId = firstContext.id;
        const initialLoadCount = env.workletModules.filter((url) => url === "https://example.com/worklet.js").length;
        await provider.close();
        const secondContext = await provider.getOrCreateContext();
        const secondContextId = secondContext.id;
        (0, chai_setup_1.expect)(secondContextId, "Provider should create a new AudioContext after close").to.not.equal(firstContextId);
        (0, chai_setup_1.expect)(env.createdContexts.length, "A fresh AudioContext should be instantiated after cleanup").to.equal(2);
        const totalLoadCount = env.workletModules.filter((url) => url === "https://example.com/worklet.js").length;
        (0, chai_setup_1.expect)(totalLoadCount, "Worklet modules should reload when the provider is reinitialized").to.equal(initialLoadCount + 1);
    });
    (0, mocha_globals_1.test)("reinitializes the shared context when sample rate changes", async () => {
        const provider = new audio_context_provider_1.AudioContextProvider();
        provider.configure(baseAudioConfig);
        const firstContext = await provider.getOrCreateContext();
        const firstId = firstContext.id;
        provider.configure({
            ...baseAudioConfig,
            sampleRate: 48000,
            codecProfileId: "opus-48k-fallback",
        });
        await provider.ensureContextMatchesConfiguration();
        const secondContext = await provider.getOrCreateContext();
        const secondId = secondContext.id;
        (0, chai_setup_1.expect)(secondId, "Provider should rebuild the AudioContext when sample rate changes").to.not.equal(firstId);
        (0, chai_setup_1.expect)(secondContext.sampleRate, "Rebuilt AudioContext should adopt updated sample rate").to.equal(48000);
    });
});
//# sourceMappingURL=audio-context-provider.unit.test.js.map
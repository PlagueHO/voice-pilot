import * as assert from "assert";
import { AudioContextProvider } from "../../../audio/audio-context-provider";
import type { AudioConfiguration } from "../../../types/webrtc";
import {
    installMockAudioEnvironment,
    MockMediaStream,
    MockMediaStreamTrack,
} from "./audio-mock-environment";

describe("AudioContextProvider", () => {
  const baseAudioConfig: AudioConfiguration = {
    sampleRate: 24000,
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
    workletModuleUrls: [] as ReadonlyArray<string>,
  };

  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  it("creates a single shared AudioContext instance", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const contextA = await provider.getOrCreateContext();
    const contextB = await provider.getOrCreateContext();

    assert.strictEqual(contextA, contextB, "Context instances should be reused");
    assert.strictEqual(env.createdContexts.length, 1, "Only one context should be created");
  });

  it("exposes the current AudioContext via getCurrentContext", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    assert.strictEqual(provider.getCurrentContext(), null, "No context should be available before creation");

    const context = await provider.getOrCreateContext();

    assert.strictEqual(
      provider.getCurrentContext(),
      context,
      "getCurrentContext should return the active AudioContext",
    );
  });

  it("loads external worklet modules declared in configuration", async () => {
    const provider = new AudioContextProvider();
    const configWithWorklet: AudioConfiguration = {
      ...baseAudioConfig,
      workletModuleUrls: ["https://example.com/worklet.js"] as ReadonlyArray<string>,
    };

    provider.configure(configWithWorklet);
    await provider.getOrCreateContext();

    assert.ok(
      env.workletModules.includes("https://example.com/worklet.js"),
      "Worklet module should be loaded via audioWorklet",
    );
  });

  it("creates a processing graph that emits a processed track", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const context = await provider.getOrCreateContext();
    assert.strictEqual(context.state, "suspended");

    const inputStream = new MockMediaStream([new MockMediaStreamTrack("microphone")]);
    const graph = await provider.createGraphForStream(
      inputStream as unknown as MediaStream,
    );
    const processedTracks = graph.destination.stream.getAudioTracks();

    assert.strictEqual(processedTracks.length, 1, "Processed stream should expose a single track");
    assert.notStrictEqual(
      processedTracks[0].id,
      inputStream.getAudioTracks()[0].id,
      "Processed track must differ from input track",
    );
  });

  it("notifies state listeners when context transitions", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    await provider.getOrCreateContext();

    const observedStates: AudioContextState[] = [];
    provider.registerStateListener((state) => {
      observedStates.push(state);
    });

    await provider.resume();
    await provider.suspend();
    await provider.close();

    assert.deepStrictEqual(observedStates, ["suspended", "running", "suspended", "closed"]);
  });

  it("cleans up resources and reloads worklets after close", async () => {
    const provider = new AudioContextProvider();
    const configWithWorklet: AudioConfiguration = {
      ...baseAudioConfig,
      workletModuleUrls: [
        "https://example.com/worklet.js",
      ] as ReadonlyArray<string>,
    };

    provider.configure(configWithWorklet);

    const firstContext = await provider.getOrCreateContext();
    const firstContextId = (firstContext as any).id;

    const initialLoadCount = env.workletModules.filter(
      (url) => url === "https://example.com/worklet.js",
    ).length;

    await provider.close();

    const secondContext = await provider.getOrCreateContext();
    const secondContextId = (secondContext as any).id;

    assert.notStrictEqual(secondContextId, firstContextId, "Provider should create a new AudioContext after close");
    assert.strictEqual(env.createdContexts.length, 2, "A fresh AudioContext should be instantiated after cleanup");

    const totalLoadCount = env.workletModules.filter(
      (url) => url === "https://example.com/worklet.js",
    ).length;

    assert.strictEqual(
      totalLoadCount,
      initialLoadCount + 1,
      "Worklet modules should reload when the provider is reinitialized",
    );
  });

  it("reinitializes the shared context when sample rate changes", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const firstContext = await provider.getOrCreateContext();
    const firstId = (firstContext as any).id;

    provider.configure({ ...baseAudioConfig, sampleRate: 48000 });
    await provider.ensureContextMatchesConfiguration();

    const secondContext = await provider.getOrCreateContext();
    const secondId = (secondContext as any).id;

    assert.notStrictEqual(
      secondId,
      firstId,
      "Provider should rebuild the AudioContext when sample rate changes",
    );
    assert.strictEqual(
      secondContext.sampleRate,
      48000,
      "Rebuilt AudioContext should adopt updated sample rate",
    );
  });
});

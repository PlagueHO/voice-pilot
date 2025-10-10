import { AudioContextProvider } from "../../../audio/audio-context-provider";
import type { AudioConfiguration } from "../../../types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { afterEach, suite, test } from "../../mocha-globals";
import {
    installMockAudioEnvironment,
    MockMediaStream,
    MockMediaStreamTrack,
} from "./audio-mock-environment";

suite("Unit: AudioContextProvider", () => {
  const baseAudioConfig: AudioConfiguration = {
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
    workletModuleUrls: [] as ReadonlyArray<string>,
  };

  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  test("creates a single shared AudioContext instance", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const contextA = await provider.getOrCreateContext();
    const contextB = await provider.getOrCreateContext();

    expect(contextA, "Context instances should be reused").to.equal(contextB);
    expect(env.createdContexts.length, "Only one context should be created").to.equal(1);
  });

  test("exposes the current AudioContext via getCurrentContext", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    expect(provider.getCurrentContext(), "No context should be available before creation").to.equal(null);

    const context = await provider.getOrCreateContext();

    expect(provider.getCurrentContext(), "getCurrentContext should return the active AudioContext").to.equal(
      context,
    );
  });

  test("loads external worklet modules declared in configuration", async () => {
    const provider = new AudioContextProvider();
    const configWithWorklet: AudioConfiguration = {
      ...baseAudioConfig,
      workletModuleUrls: ["https://example.com/worklet.js"] as ReadonlyArray<string>,
    };

    provider.configure(configWithWorklet);
    await provider.getOrCreateContext();

    expect(
      env.workletModules.includes("https://example.com/worklet.js"),
      "Worklet module should be loaded via audioWorklet",
    ).to.be.true;
  });

  test("creates a processing graph that emits a processed track", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const context = await provider.getOrCreateContext();
    expect(context.state).to.equal("suspended");

    const inputStream = new MockMediaStream([new MockMediaStreamTrack("microphone")]);
    const graph = await provider.createGraphForStream(
      inputStream as unknown as MediaStream,
    );
    const processedTracks = graph.destination.stream.getAudioTracks();

    expect(processedTracks.length, "Processed stream should expose a single track").to.equal(1);
    expect(processedTracks[0].id, "Processed track must differ from input track")
      .to.not.equal(inputStream.getAudioTracks()[0].id);
  });

  test("notifies state listeners when context transitions", async () => {
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

    expect(observedStates).to.deep.equal(["suspended", "running", "suspended", "closed"]);
  });

  test("cleans up resources and reloads worklets after close", async () => {
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

    expect(secondContextId, "Provider should create a new AudioContext after close").to.not.equal(firstContextId);
    expect(env.createdContexts.length, "A fresh AudioContext should be instantiated after cleanup").to.equal(2);

    const totalLoadCount = env.workletModules.filter(
      (url) => url === "https://example.com/worklet.js",
    ).length;

    expect(totalLoadCount, "Worklet modules should reload when the provider is reinitialized").to.equal(
      initialLoadCount + 1,
    );
  });

  test("reinitializes the shared context when sample rate changes", async () => {
    const provider = new AudioContextProvider();
    provider.configure(baseAudioConfig);

    const firstContext = await provider.getOrCreateContext();
    const firstId = (firstContext as any).id;

    provider.configure({
      ...baseAudioConfig,
      sampleRate: 48000,
      codecProfileId: "opus-48k-fallback",
    });
    await provider.ensureContextMatchesConfiguration();

    const secondContext = await provider.getOrCreateContext();
    const secondId = (secondContext as any).id;

    expect(secondId, "Provider should rebuild the AudioContext when sample rate changes").to.not.equal(firstId);
    expect(secondContext.sampleRate, "Rebuilt AudioContext should adopt updated sample rate").to.equal(48000);
  });
});

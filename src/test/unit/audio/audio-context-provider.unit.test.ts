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
});

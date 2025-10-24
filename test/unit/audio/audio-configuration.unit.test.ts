import {
    AudioConfiguration,
    MINIMUM_AUDIO_SAMPLE_RATE,
    SUPPORTED_AUDIO_SAMPLE_RATES,
    validateAudioConfiguration,
} from "../../../src/types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

suite("Unit: AudioConfiguration contract", () => {
  function createConfig(sampleRate: AudioConfiguration["sampleRate"]): AudioConfiguration {
    const codecProfileId =
      sampleRate === 16000
        ? "pcm16-16k-mono"
        : sampleRate === 48000
          ? "opus-48k-fallback"
          : "pcm16-24k-mono";

    return {
      sampleRate,
      codecProfileId,
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
  }

  test("accepts all supported capture sample rates", () => {
    for (const rate of SUPPORTED_AUDIO_SAMPLE_RATES) {
      const errors = validateAudioConfiguration(createConfig(rate));
      expect(errors.length, `Expected no validation errors for ${rate} Hz sample rate`).to.equal(0);
    }
  });

  test("rejects unsupported sample rates", () => {
    const config = createConfig(22050 as AudioConfiguration["sampleRate"]);
    const errors = validateAudioConfiguration(config);
    expect(
      errors.some((message) => message.includes("24000")),
      "Error message should reference supported rates",
    ).to.be.true;
  });

  test("enforces the documented minimum sample rate guard", () => {
    const config = createConfig(12000 as AudioConfiguration["sampleRate"]);
    const errors = validateAudioConfiguration(config);

    expect(
      errors.some((message) => message.includes(`${MINIMUM_AUDIO_SAMPLE_RATE}`)),
      "Error message should mention the minimum supported sample rate",
    ).to.be.true;
  });
});

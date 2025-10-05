import * as assert from "assert";
import {
    AudioConfiguration,
    MINIMUM_AUDIO_SAMPLE_RATE,
    SUPPORTED_AUDIO_SAMPLE_RATES,
    validateAudioConfiguration,
} from "../../../types/webrtc";

describe("AudioConfiguration contract", () => {
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

  it("accepts all supported capture sample rates", () => {
    for (const rate of SUPPORTED_AUDIO_SAMPLE_RATES) {
      const errors = validateAudioConfiguration(createConfig(rate));
      assert.strictEqual(
        errors.length,
        0,
        `Expected no validation errors for ${rate} Hz sample rate`,
      );
    }
  });

  it("rejects unsupported sample rates", () => {
    const config = createConfig(22050 as AudioConfiguration["sampleRate"]);
    const errors = validateAudioConfiguration(config);
    assert.ok(errors.some((message) => message.includes("24000")), "Error message should reference supported rates");
  });

  it("enforces the documented minimum sample rate guard", () => {
    const config = createConfig(12000 as AudioConfiguration["sampleRate"]);
    const errors = validateAudioConfiguration(config);

    assert.ok(
      errors.some((message) =>
        message.includes(`${MINIMUM_AUDIO_SAMPLE_RATE}`),
      ),
      "Error message should mention the minimum supported sample rate",
    );
  });
});

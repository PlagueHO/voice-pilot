"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webrtc_1 = require("../../src/../types/webrtc");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)("Unit: AudioConfiguration contract", () => {
    function createConfig(sampleRate) {
        const codecProfileId = sampleRate === 16000
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
            workletModuleUrls: [],
        };
    }
    (0, mocha_globals_1.test)("accepts all supported capture sample rates", () => {
        for (const rate of webrtc_1.SUPPORTED_AUDIO_SAMPLE_RATES) {
            const errors = (0, webrtc_1.validateAudioConfiguration)(createConfig(rate));
            (0, chai_setup_1.expect)(errors.length, `Expected no validation errors for ${rate} Hz sample rate`).to.equal(0);
        }
    });
    (0, mocha_globals_1.test)("rejects unsupported sample rates", () => {
        const config = createConfig(22050);
        const errors = (0, webrtc_1.validateAudioConfiguration)(config);
        (0, chai_setup_1.expect)(errors.some((message) => message.includes("24000")), "Error message should reference supported rates").to.be.true;
    });
    (0, mocha_globals_1.test)("enforces the documented minimum sample rate guard", () => {
        const config = createConfig(12000);
        const errors = (0, webrtc_1.validateAudioConfiguration)(config);
        (0, chai_setup_1.expect)(errors.some((message) => message.includes(`${webrtc_1.MINIMUM_AUDIO_SAMPLE_RATE}`)), "Error message should mention the minimum supported sample rate").to.be.true;
    });
});
//# sourceMappingURL=audio-configuration.unit.test.js.map
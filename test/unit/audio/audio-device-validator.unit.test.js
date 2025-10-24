"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const device_validator_1 = require("../../src/../audio/device-validator");
const audio_errors_1 = require("../../src/../types/audio-errors");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
const audio_mock_environment_1 = require("./audio-mock-environment");
(0, mocha_globals_1.suite)("Unit: AudioDeviceValidator error metadata", () => {
    let env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    (0, mocha_globals_1.afterEach)(() => {
        env.restore();
        env = (0, audio_mock_environment_1.installMockAudioEnvironment)();
    });
    (0, mocha_globals_1.test)("marks missing devices as non-recoverable errors", async () => {
        const validator = new device_validator_1.AudioDeviceValidator();
        const result = await validator.validateDevice("non-existent-device");
        (0, chai_setup_1.expect)(result.isValid).to.be.false;
        (0, chai_setup_1.expect)(result.error, "Expected a structured error").to.exist;
        (0, chai_setup_1.expect)(result.error?.severity).to.equal(audio_errors_1.AudioErrorSeverity.Error);
        (0, chai_setup_1.expect)(result.error?.recoverable).to.be.false;
        (0, chai_setup_1.expect)(result.error?.recovery?.recoverable).to.be.false;
        (0, chai_setup_1.expect)(result.error?.recovery?.recommendedAction).to.equal("fallback");
    });
    (0, mocha_globals_1.test)("classifies temporarily unavailable devices as recoverable", async () => {
        const validator = new device_validator_1.AudioDeviceValidator();
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => {
            const error = new Error("Device busy");
            error.name = "NotReadableError";
            throw error;
        };
        try {
            const result = await validator.validateDevice("mock-device");
            (0, chai_setup_1.expect)(result.isValid).to.be.false;
            (0, chai_setup_1.expect)(result.error, "Expected a structured error").to.exist;
            (0, chai_setup_1.expect)(result.error?.severity).to.equal(audio_errors_1.AudioErrorSeverity.Warning);
            (0, chai_setup_1.expect)(result.error?.recoverable).to.be.true;
            (0, chai_setup_1.expect)(result.error?.recovery?.recommendedAction).to.equal("retry");
            (0, chai_setup_1.expect)(typeof result.error?.recovery?.retryAfterMs === "number", "Recoverable errors should include retry guidance").to.be.true;
        }
        finally {
            navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        }
    });
});
//# sourceMappingURL=audio-device-validator.unit.test.js.map
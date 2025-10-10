import { AudioDeviceValidator } from "../../../audio/device-validator";
import { AudioErrorSeverity } from "../../../types/audio-errors";
import { expect } from "../../helpers/chai-setup";
import { afterEach, suite, test } from "../../mocha-globals";
import { installMockAudioEnvironment } from "./audio-mock-environment";

suite("Unit: AudioDeviceValidator error metadata", () => {
  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  test("marks missing devices as non-recoverable errors", async () => {
    const validator = new AudioDeviceValidator();
    const result = await validator.validateDevice("non-existent-device");

    expect(result.isValid).to.be.false;
    expect(result.error, "Expected a structured error").to.exist;
    expect(result.error?.severity).to.equal(AudioErrorSeverity.Error);
    expect(result.error?.recoverable).to.be.false;
    expect(result.error?.recovery?.recoverable).to.be.false;
    expect(result.error?.recovery?.recommendedAction).to.equal("fallback");
  });

  test("classifies temporarily unavailable devices as recoverable", async () => {
    const validator = new AudioDeviceValidator();

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => {
      const error = new Error("Device busy");
      (error as any).name = "NotReadableError";
      throw error;
    };

    try {
      const result = await validator.validateDevice("mock-device");

      expect(result.isValid).to.be.false;
      expect(result.error, "Expected a structured error").to.exist;
      expect(result.error?.severity).to.equal(AudioErrorSeverity.Warning);
      expect(result.error?.recoverable).to.be.true;
      expect(result.error?.recovery?.recommendedAction).to.equal("retry");
      expect(
        typeof result.error?.recovery?.retryAfterMs === "number",
        "Recoverable errors should include retry guidance",
      ).to.be.true;
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});

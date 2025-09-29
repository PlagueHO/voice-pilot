import * as assert from "assert";
import { AudioDeviceValidator } from "../../../audio/device-validator";
import { AudioErrorSeverity } from "../../../types/audio-errors";
import { installMockAudioEnvironment } from "./audio-mock-environment";

describe("AudioDeviceValidator error metadata", () => {
  let env = installMockAudioEnvironment();

  afterEach(() => {
    env.restore();
    env = installMockAudioEnvironment();
  });

  it("marks missing devices as non-recoverable errors", async () => {
    const validator = new AudioDeviceValidator();
    const result = await validator.validateDevice("non-existent-device");

    assert.strictEqual(result.isValid, false);
    assert.ok(result.error, "Expected a structured error");
    assert.strictEqual(result.error?.severity, AudioErrorSeverity.Error);
    assert.strictEqual(result.error?.recoverable, false);
    assert.strictEqual(result.error?.recovery?.recoverable, false);
    assert.strictEqual(result.error?.recovery?.recommendedAction, "fallback");
  });

  it("classifies temporarily unavailable devices as recoverable", async () => {
    const validator = new AudioDeviceValidator();

    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => {
      const error = new Error("Device busy");
      (error as any).name = "NotReadableError";
      throw error;
    };

    try {
      const result = await validator.validateDevice("mock-device");

      assert.strictEqual(result.isValid, false);
      assert.ok(result.error, "Expected a structured error");
      assert.strictEqual(result.error?.severity, AudioErrorSeverity.Warning);
      assert.strictEqual(result.error?.recoverable, true);
      assert.strictEqual(result.error?.recovery?.recommendedAction, "retry");
      assert.ok(
        typeof result.error?.recovery?.retryAfterMs === "number",
        "Recoverable errors should include retry guidance",
      );
    } finally {
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
  });
});

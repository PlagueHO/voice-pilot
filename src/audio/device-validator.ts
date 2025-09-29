import { Logger } from "../core/logger";
import { DeviceValidationResult } from "../types/audio-capture";
import type { AudioErrorRecoveryMetadata } from "../types/audio-errors";
import {
    AudioErrorCode,
    AudioErrorSeverity,
    AudioProcessingError,
} from "../types/audio-errors";

const MEDIA_KIND_AUDIO_INPUT = "audioinput";

export class AudioDeviceValidator {
  private readonly logger: Logger;

  /**
   * Creates a new audio device validator that logs diagnostic information.
   * @param logger - Optional logger instance for emitting structured logs.
   */
  constructor(logger?: Logger) {
    this.logger = logger || new Logger("AudioDeviceValidator");
  }

  /**
   * Validates that a microphone device is present and accessible by the browser.
   * @param deviceId - Optional identifier of the audio input device to validate.
   * @returns Validation result including device metadata or a structured error.
   */
  async validateDevice(deviceId?: string): Promise<DeviceValidationResult> {
    if (!navigator?.mediaDevices) {
      return {
        isValid: false,
        deviceId: deviceId ?? "default",
        error: this.createError(
          AudioErrorCode.DeviceUnavailable,
          "Media devices API is not available in this environment",
          false,
        ),
      };
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(
        (device) => device.kind === MEDIA_KIND_AUDIO_INPUT,
      );

      if (audioInputs.length === 0) {
        return {
          isValid: false,
          deviceId: deviceId ?? "default",
          error: this.createError(
            AudioErrorCode.DeviceNotFound,
            "No audio input devices found",
            false,
          ),
        };
      }

      const target = deviceId
        ? audioInputs.find((device) => device.deviceId === deviceId)
        : audioInputs[0];

      if (!target) {
        return {
          isValid: false,
          deviceId: deviceId ?? "default",
          error: this.createError(
            AudioErrorCode.DeviceNotFound,
            `Audio device ${deviceId} not found`,
            false,
          ),
        };
      }

      const validationResult = await this.testDeviceAccess(target.deviceId);
      if (!validationResult) {
        return {
          isValid: false,
          deviceId: target.deviceId,
          label: target.label,
          error: this.createError(
            AudioErrorCode.DeviceUnavailable,
            "Unable to access audio device",
            true,
          ),
        };
      }

      return {
        isValid: true,
        deviceId: target.deviceId,
        label: target.label,
        capabilities: validationResult.capabilities,
        settings: validationResult.settings,
      };
    } catch (error: any) {
      this.logger.error("Failed to validate audio device", {
        error: error?.message,
      });
      return {
        isValid: false,
        deviceId: deviceId ?? "default",
        error: this.createError(
          AudioErrorCode.DeviceUnavailable,
          error?.message ?? "Device validation failed",
          true,
          error,
        ),
      };
    }
  }

  /**
   * Attempts to acquire the specified device to verify capabilities and settings.
   * @param deviceId - Identifier of the audio device being tested.
   * @returns Capture settings and capabilities when successful; otherwise `null`.
   */
  private async testDeviceAccess(deviceId: string): Promise<{
    settings: MediaTrackSettings;
    capabilities?: MediaTrackCapabilities;
  } | null> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        return null;
      }

      const settings = track.getSettings();
      const capabilities =
        typeof track.getCapabilities === "function"
          ? track.getCapabilities()
          : undefined;

      stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
      return { settings, capabilities };
    } catch (error: any) {
      const code = this.mapErrorToCode(error);
      this.logger.warn("Device access test failed", {
        deviceId,
        error: error?.message,
        code,
      });
      return null;
    }
  }

  /**
   * Maps a browser error to the corresponding audio error code classification.
   * @param error - Error thrown while accessing media devices.
   * @returns Audio-specific error code representing the failure.
   */
  private mapErrorToCode(error: any): AudioErrorCode {
    const name = error?.name;
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return AudioErrorCode.PermissionDenied;
      case "NotFoundError":
      case "OverconstrainedError":
        return AudioErrorCode.DeviceNotFound;
      case "NotReadableError":
      case "InvalidStateError":
      case "AbortError":
      case "DeviceInUseError":
        return AudioErrorCode.DeviceUnavailable;
      default:
        return AudioErrorCode.ConfigurationInvalid;
    }
  }

  /**
   * Creates a standardized audio processing error payload for downstream handling.
   * @param code - Error code describing the failure category.
   * @param message - Human-readable description of the failure.
   * @param recoverable - Indicates whether the failure can be retried safely.
   * @param cause - Optional underlying error for diagnostic purposes.
   * @returns Structured audio processing error.
   */
  private createError(
    code: AudioErrorCode,
    message: string,
    recoverable: boolean,
    cause?: unknown,
  ): AudioProcessingError {
    const severity = this.deriveSeverity(code, recoverable);
    const recovery = this.buildRecoveryMetadata(code, recoverable, message);
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
    const webAudioSupported =
      (typeof globalThis !== "undefined" && "AudioContext" in globalThis) ||
      (typeof globalThis !== "undefined" && "webkitAudioContext" in globalThis);

    return {
      code,
      message,
      severity,
      recoverable,
      recovery,
      timestamp: Date.now(),
      context: {
        userAgent,
        webAudioSupported,
        mediaDevicesSupported: !!navigator?.mediaDevices,
        getUserMediaSupported: !!navigator?.mediaDevices?.getUserMedia,
        permissionsStatus: "unknown",
      },
      cause,
    };
  }

  private deriveSeverity(
    code: AudioErrorCode,
    recoverable: boolean,
  ): AudioErrorSeverity {
    if (!recoverable) {
      return code === AudioErrorCode.PermissionDenied
        ? AudioErrorSeverity.Fatal
        : AudioErrorSeverity.Error;
    }

    return AudioErrorSeverity.Warning;
  }

  private buildRecoveryMetadata(
    code: AudioErrorCode,
    recoverable: boolean,
    guidance: string,
  ): AudioErrorRecoveryMetadata {
    if (!recoverable) {
      return {
        recoverable: false,
        recommendedAction: code === AudioErrorCode.PermissionDenied ? "prompt" : "fallback",
        guidance,
      };
    }

    const retryCodes = new Set<AudioErrorCode>([
      AudioErrorCode.ContextSuspended,
      AudioErrorCode.BufferUnderrun,
      AudioErrorCode.DeviceUnavailable,
    ]);

    return {
      recoverable: true,
      recommendedAction: retryCodes.has(code) ? "retry" : "prompt",
      guidance,
      retryAfterMs: retryCodes.has(code) ? 1000 : undefined,
    };
  }
}

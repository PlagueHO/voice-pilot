import { Logger } from "../core/logger";
import { DeviceValidationResult } from "../types/audio-capture";
import { AudioErrorCode, AudioProcessingError } from "../types/audio-errors";

const MEDIA_KIND_AUDIO_INPUT = "audioinput";

export class AudioDeviceValidator {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("AudioDeviceValidator");
  }

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

  private async testDeviceAccess(
    deviceId: string,
  ): Promise<{
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

  private createError(
    code: AudioErrorCode,
    message: string,
    recoverable: boolean,
    cause?: unknown,
  ): AudioProcessingError {
    return {
      code,
      message,
      recoverable,
      timestamp: Date.now(),
      context: {
        mediaDevicesSupported: !!navigator?.mediaDevices,
        getUserMediaSupported: !!navigator?.mediaDevices?.getUserMedia,
      },
      cause,
    };
  }
}

import { normalizeTurnDetectionConfig } from "../audio/turn-detection-defaults";
import type { AudioConfig, AzureRealtimeConfig } from "../types/configuration";
import type { AzureSessionRequest } from "../types/ephemeral";

export const DEFAULT_REALTIME_API_VERSION = "2025-08-28";

export interface RealtimeSessionPreferences {
  apiVersion: string;
  voice?: string;
  turnDetection?: AzureSessionRequest["turn_detection"];
}

export function resolveRealtimeSessionPreferences(
  realtimeConfig: AzureRealtimeConfig,
  audioConfig: AudioConfig,
): RealtimeSessionPreferences {
  const normalizedTurn = normalizeTurnDetectionConfig(
    audioConfig.turnDetection,
  );

  const turnDetection =
    normalizedTurn.type === "none"
      ? undefined
      : {
          type:
            normalizedTurn.type === "semantic_vad"
              ? "semantic_vad"
              : "server_vad",
          threshold: normalizedTurn.threshold,
          prefix_padding_ms: normalizedTurn.prefixPaddingMs,
          silence_duration_ms: normalizedTurn.silenceDurationMs,
          create_response: normalizedTurn.createResponse,
          interrupt_response: normalizedTurn.interruptResponse,
          ...(normalizedTurn.type === "semantic_vad" && normalizedTurn.eagerness
            ? { eagerness: normalizedTurn.eagerness }
            : {}),
        } satisfies AzureSessionRequest["turn_detection"];

  return {
    apiVersion:
      realtimeConfig.apiVersion || DEFAULT_REALTIME_API_VERSION,
    voice: audioConfig.tts.voice?.name,
    turnDetection,
  };
}

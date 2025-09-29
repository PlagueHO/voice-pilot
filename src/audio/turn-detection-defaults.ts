import { TurnDetectionConfig } from "../types/configuration";

/**
 * Immutable baseline values for the turn detection engine.
 *
 * @remarks
 * The configuration mirrors the server-side VAD defaults expected by the
 * realtime audio service. Consumers should call
 * {@link createDefaultTurnDetectionConfig} before mutating values.
 */
export const DEFAULT_TURN_DETECTION_CONFIG: Readonly<TurnDetectionConfig> =
  Object.freeze({
    type: "server_vad",
    threshold: 0.5,
    prefixPaddingMs: 300,
    silenceDurationMs: 200,
    createResponse: true,
    interruptResponse: true,
    eagerness: "auto",
  });

/**
 * Returns a mutable copy of the default turn detection configuration.
 *
 * @returns A new {@link TurnDetectionConfig} instance seeded with the default
 * values.
 */
export function createDefaultTurnDetectionConfig(): TurnDetectionConfig {
  return { ...DEFAULT_TURN_DETECTION_CONFIG };
}

/**
 * Normalizes user-provided turn detection configuration against defaults and
 * clamps numeric ranges to safe values.
 *
 * @param config - Optional partial configuration supplied by the caller.
 * @returns A complete {@link TurnDetectionConfig} containing validated values.
 */
export function normalizeTurnDetectionConfig(
  config?: Partial<TurnDetectionConfig>,
): TurnDetectionConfig {
  const defaults = createDefaultTurnDetectionConfig();
  if (!config) {
    return defaults;
  }

  const normalized: TurnDetectionConfig = {
    ...defaults,
    ...config,
    type: config.type ?? defaults.type,
  };

  if (normalized.type === "none") {
    normalized.createResponse = config.createResponse ?? false;
    normalized.interruptResponse = config.interruptResponse ?? false;
  }

  if (normalized.type !== "semantic_vad") {
    normalized.eagerness = "auto";
  } else {
    normalized.eagerness = config.eagerness ?? defaults.eagerness;
  }

  if (typeof normalized.threshold === "number") {
    normalized.threshold = Math.max(0, Math.min(1, normalized.threshold));
  }

  if (typeof normalized.prefixPaddingMs === "number") {
    normalized.prefixPaddingMs = Math.max(
      0,
      Math.round(normalized.prefixPaddingMs),
    );
  }

  if (typeof normalized.silenceDurationMs === "number") {
    normalized.silenceDurationMs = Math.max(
      0,
      Math.round(normalized.silenceDurationMs),
    );
  }

  return normalized;
}

import * as vscode from "vscode";
import type {
    AccessibilityProfile,
    AudioCueCategory,
    AudioFeedbackConfig,
    DuckingStrategy,
} from "../../types/audio-feedback";

const CATEGORY_KEYS: ReadonlyArray<AudioCueCategory> = [
  "session",
  "state",
  "error",
  "accessibility",
];

const DEFAULT_CATEGORY_GAINS: Record<AudioCueCategory, number> = {
  session: 1,
  state: 0.9,
  error: 1,
  accessibility: 1,
};

const DEFAULT_DUCKING: DuckingStrategy = "attenuate";
const DEFAULT_ACCESSIBILITY_PROFILE: AccessibilityProfile = "standard";

function clampGain(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 0), 2);
}

function sanitizeDucking(raw: unknown): DuckingStrategy {
  if (raw === "pause" || raw === "crossfade" || raw === "none") {
    return raw;
  }
  return DEFAULT_DUCKING;
}

function sanitizeProfile(raw: unknown): AccessibilityProfile {
  if (raw === "standard" || raw === "high-contrast" || raw === "silent") {
    return raw;
  }
  return DEFAULT_ACCESSIBILITY_PROFILE;
}

/**
 * Reads VS Code configuration to produce a normalized audio feedback config snapshot.
 */
export class AudioFeedbackSection {
  read(): AudioFeedbackConfig {
    const configuration = vscode.workspace.getConfiguration(
      "agentvoice.audioFeedback",
    );

    const enabled = configuration.get<boolean>("enabled", true);
    const spacing = configuration.get<number>("psychoacousticSpacingMs", 500);
    const telemetryEnabled = configuration.get<boolean>(
      "telemetryEnabled",
      true,
    );
    const ducking = sanitizeDucking(
      configuration.get<string>("defaultDucking", DEFAULT_DUCKING),
    );
    const accessibility = sanitizeProfile(
      configuration.get<string>(
        "accessibilityProfile",
        DEFAULT_ACCESSIBILITY_PROFILE,
      ),
    );

    const categoryGains: Record<AudioCueCategory, number> = {
      ...DEFAULT_CATEGORY_GAINS,
    };
    for (const category of CATEGORY_KEYS) {
      const key = `volume.${category}`;
      const value = configuration.get<number>(key, DEFAULT_CATEGORY_GAINS[category]);
      categoryGains[category] = clampGain(value, DEFAULT_CATEGORY_GAINS[category]);
    }

    const failureThreshold = Math.max(
      1,
      configuration.get<number>("degradedFailureThreshold", 3),
    );
    const windowSeconds = Math.max(
      1,
      configuration.get<number>("degradedWindowSeconds", 60),
    );
    const cooldownSeconds = Math.max(
      5,
      configuration.get<number>("degradedCooldownSeconds", 180),
    );

    return {
      enabled,
      defaultDucking: ducking,
      accessibilityProfile: accessibility,
      telemetryEnabled,
      categoryGains,
      psychoacousticSpacingMs: Math.max(100, spacing),
      degradedMode: {
        failureThreshold,
        windowMs: windowSeconds * 1000,
        cooldownMs: cooldownSeconds * 1000,
      },
    };
  }
}

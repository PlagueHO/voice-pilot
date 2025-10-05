import * as vscode from "vscode";
import {
    isFaultDomain
} from "../../types/error/error-taxonomy";
import type {
    RetryConfig,
    RetryDomainOverride,
} from "../../types/retry";

const OVERRIDE_KEYS: Array<keyof RetryDomainOverride> = [
  "policy",
  "initialDelayMs",
  "multiplier",
  "maxDelayMs",
  "maxAttempts",
  "jitterStrategy",
  "coolDownMs",
  "failureBudgetMs",
];

function sanitizeOverride(raw: unknown): RetryDomainOverride | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const override: RetryDomainOverride = {};
  for (const key of OVERRIDE_KEYS) {
    const value = (raw as Record<string, unknown>)[key as string];
    if (value === undefined || value === null) {
      continue;
    }
    switch (key) {
      case "policy":
        if (
          typeof value === "string" &&
          ["none", "immediate", "exponential", "linear", "hybrid"].includes(value)
        ) {
          override.policy = value as RetryDomainOverride["policy"];
        }
        break;
      case "jitterStrategy":
        if (
          typeof value === "string" &&
          ["none", "deterministic-full", "deterministic-equal"].includes(value)
        ) {
          override.jitterStrategy =
            value as RetryDomainOverride["jitterStrategy"];
        }
        break;
      default:
        if (typeof value === "number" && Number.isFinite(value)) {
          (override as Record<string, number>)[key as string] = value;
        }
        break;
    }
  }
  return Object.keys(override).length > 0 ? override : undefined;
}

export class RetrySection {
  read(): RetryConfig {
    const config = vscode.workspace.getConfiguration("voicepilot.retry");
    const overridesRaw = config.get<Record<string, unknown>>("overrides", {});
    const overrides: RetryConfig["overrides"] = {};

    for (const [key, value] of Object.entries(overridesRaw ?? {})) {
      if (!isFaultDomain(key)) {
        continue;
      }
      const override = sanitizeOverride(value);
      if (override) {
        overrides[key] = override;
      }
    }

    return { overrides };
  }
}

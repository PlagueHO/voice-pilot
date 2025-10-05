import { VOICE_PILOT_FAULT_DOMAINS } from "../../types/error/error-taxonomy";
import type { RetryEnvelope } from "../../types/retry";

export const RETRY_GUARDRAILS = {
  minAttempts: 0,
  maxAttempts: 8,
  minInitialDelayMs: 0,
  maxInitialDelayMs: 5_000,
  minMultiplier: 1,
  maxMultiplier: 5,
  minMaxDelayMs: 0,
  maxMaxDelayMs: 60_000,
  minCoolDownMs: 5_000,
  maxCoolDownMs: 120_000,
  minFailureBudgetMs: 1_000,
  maxFailureBudgetMs: 120_000,
} as const;

const createEnvelope = (
  domain: RetryEnvelope["domain"],
  overrides: Partial<Omit<RetryEnvelope, "domain">>,
): RetryEnvelope => ({
  domain,
  policy: overrides.policy ?? "exponential",
  initialDelayMs: overrides.initialDelayMs ?? 500,
  multiplier: overrides.multiplier ?? 2,
  maxDelayMs: overrides.maxDelayMs ?? 10_000,
  maxAttempts: overrides.maxAttempts ?? 5,
  jitterStrategy: overrides.jitterStrategy ?? "deterministic-full",
  coolDownMs: overrides.coolDownMs ?? 30_000,
  failureBudgetMs: overrides.failureBudgetMs ?? 60_000,
});

export const DEFAULT_RETRY_ENVELOPES: Record<string, RetryEnvelope> = {
  auth: createEnvelope("auth", {
    initialDelayMs: 1_000,
    multiplier: 2,
    maxDelayMs: 12_000,
    maxAttempts: 5,
    coolDownMs: 45_000,
    failureBudgetMs: 75_000,
  }),
  session: createEnvelope("session", {
    policy: "hybrid",
    initialDelayMs: 500,
    multiplier: 1.8,
    maxDelayMs: 8_000,
    maxAttempts: 4,
    coolDownMs: 40_000,
    failureBudgetMs: 70_000,
  }),
  transport: createEnvelope("transport", {
    policy: "exponential",
    initialDelayMs: 400,
    multiplier: 2.2,
    maxDelayMs: 9_000,
    maxAttempts: 6,
    coolDownMs: 35_000,
    failureBudgetMs: 90_000,
  }),
  audio: createEnvelope("audio", {
    policy: "linear",
    initialDelayMs: 250,
    multiplier: 750,
    maxDelayMs: 4_000,
    maxAttempts: 4,
    coolDownMs: 20_000,
    failureBudgetMs: 45_000,
  }),
  ui: createEnvelope("ui", {
    policy: "immediate",
    initialDelayMs: 0,
    multiplier: 1,
    maxDelayMs: 1_000,
    maxAttempts: 2,
    coolDownMs: 15_000,
    failureBudgetMs: 10_000,
  }),
  copilot: createEnvelope("copilot", {
    policy: "exponential",
    initialDelayMs: 800,
    multiplier: 1.9,
    maxDelayMs: 7_500,
    maxAttempts: 5,
    coolDownMs: 50_000,
    failureBudgetMs: 80_000,
  }),
  infrastructure: createEnvelope("infrastructure", {
    policy: "exponential",
    initialDelayMs: 1_500,
    multiplier: 2.5,
    maxDelayMs: 15_000,
    maxAttempts: 3,
    coolDownMs: 60_000,
    failureBudgetMs: 100_000,
  }),
};

export const isKnownRetryDomain = (
  domain: string,
): domain is keyof typeof DEFAULT_RETRY_ENVELOPES =>
  (VOICE_PILOT_FAULT_DOMAINS as readonly string[]).includes(domain);

export const cloneEnvelope = (envelope: RetryEnvelope): RetryEnvelope => ({
  ...envelope,
});

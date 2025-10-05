import type { VoicePilotFaultDomain } from "./error/error-taxonomy";

export type RetryPolicy = "none" | "immediate" | "exponential" | "linear" | "hybrid";

export type RetryJitterStrategy =
  | "none"
  | "deterministic-full"
  | "deterministic-equal";

export interface RetryEnvelope {
  domain: VoicePilotFaultDomain;
  policy: RetryPolicy;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitterStrategy: RetryJitterStrategy;
  coolDownMs: number;
  failureBudgetMs: number;
}

export type RetryDomainOverride = Partial<Omit<RetryEnvelope, "domain" | "failureBudgetMs">> & {
  failureBudgetMs?: number;
};

export interface RetryConfig {
  overrides: Partial<Record<VoicePilotFaultDomain, RetryDomainOverride>>;
}

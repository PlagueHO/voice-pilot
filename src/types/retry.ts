import type { AgentVoiceFaultDomain } from "./error/error-taxonomy";

/**
 * Supported retry policy shapes available to service orchestrators.
 */
export type RetryPolicy =
  | "none"
  | "immediate"
  | "exponential"
  | "linear"
  | "hybrid";

/**
 * Strategies for injecting jitter into retry delays to reduce thundering herds.
 */
export type RetryJitterStrategy =
  | "none"
  | "deterministic-full"
  | "deterministic-equal";

/**
 * Canonical retry envelope describing backoff behavior for a fault domain.
 */
export interface RetryEnvelope {
  domain: AgentVoiceFaultDomain;
  policy: RetryPolicy;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  maxAttempts: number;
  jitterStrategy: RetryJitterStrategy;
  coolDownMs: number;
  failureBudgetMs: number;
}

/**
 * Overrides applied to the default retry envelope for a specific fault domain.
 */
export type RetryDomainOverride = Partial<
  Omit<RetryEnvelope, "domain" | "failureBudgetMs">
> & {
  failureBudgetMs?: number;
};

/**
 * Aggregate retry configuration keyed by Agent Voice fault domains.
 */
export interface RetryConfig {
  overrides: Partial<Record<AgentVoiceFaultDomain, RetryDomainOverride>>;
}

import type * as vscode from "vscode";
import { ConfigurationManager } from "../../config/configuration-manager";
import type { AgentVoiceFaultDomain } from "../../types/error/error-taxonomy";
import type { RetryDomainOverride, RetryEnvelope } from "../../types/retry";
import { Logger } from "../logger";
import {
    DEFAULT_RETRY_ENVELOPES,
    RETRY_GUARDRAILS,
    cloneEnvelope,
    isKnownRetryDomain,
} from "./retry-envelopes";
import type { RetryConfigurationProvider, RetryConfigurationValidation } from "./retry-types";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const MIN_FAILURE_BUDGET_MARGIN_MS = 50;

export class RetryConfigurationProviderImpl
  implements RetryConfigurationProvider
{
  private initialized = false;
  private cache = new Map<AgentVoiceFaultDomain, RetryEnvelope>();
  private overrides: Partial<Record<AgentVoiceFaultDomain, RetryDomainOverride>> = {};
  private disposable: vscode.Disposable | undefined;

  constructor(
    private readonly configurationManager: ConfigurationManager,
    private readonly logger: Logger,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.refresh();
    this.disposable = this.configurationManager.onConfigurationChanged(
      async (change) => {
        if (change.section === "retry") {
          this.refresh();
        }
      },
    );
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.disposable?.dispose();
    this.disposable = undefined;
    this.cache.clear();
    this.initialized = false;
  }

  getEnvelope(domain: AgentVoiceFaultDomain): RetryEnvelope {
    const cached = this.cache.get(domain);
    if (cached) {
      return cloneEnvelope(cached);
    }
    const fallbackDomain = isKnownRetryDomain(domain) ? domain : "session";
    const envelope = this.buildEnvelope(fallbackDomain as AgentVoiceFaultDomain);
    this.cache.set(domain, envelope);
    return cloneEnvelope(envelope);
  }

  getOverride(
    domain: AgentVoiceFaultDomain,
  ): RetryDomainOverride | undefined {
    return this.overrides[domain] ? { ...this.overrides[domain]! } : undefined;
  }

  validateEnvelope(envelope: RetryEnvelope): RetryConfigurationValidation {
    const errors: string[] = [];
    if (
      envelope.maxAttempts < RETRY_GUARDRAILS.minAttempts ||
      envelope.maxAttempts > RETRY_GUARDRAILS.maxAttempts
    ) {
      errors.push(
        `maxAttempts must be between ${RETRY_GUARDRAILS.minAttempts} and ${RETRY_GUARDRAILS.maxAttempts}`,
      );
    }
    if (
      envelope.initialDelayMs < RETRY_GUARDRAILS.minInitialDelayMs ||
      envelope.initialDelayMs > RETRY_GUARDRAILS.maxInitialDelayMs
    ) {
      errors.push(
        `initialDelayMs must be between ${RETRY_GUARDRAILS.minInitialDelayMs} and ${RETRY_GUARDRAILS.maxInitialDelayMs}`,
      );
    }
    if (
      envelope.multiplier < RETRY_GUARDRAILS.minMultiplier ||
      envelope.multiplier > RETRY_GUARDRAILS.maxMultiplier
    ) {
      errors.push(
        `multiplier must be between ${RETRY_GUARDRAILS.minMultiplier} and ${RETRY_GUARDRAILS.maxMultiplier}`,
      );
    }
    if (
      envelope.maxDelayMs < RETRY_GUARDRAILS.minMaxDelayMs ||
      envelope.maxDelayMs > RETRY_GUARDRAILS.maxMaxDelayMs
    ) {
      errors.push(
        `maxDelayMs must be between ${RETRY_GUARDRAILS.minMaxDelayMs} and ${RETRY_GUARDRAILS.maxMaxDelayMs}`,
      );
    }
    if (
      envelope.coolDownMs < RETRY_GUARDRAILS.minCoolDownMs ||
      envelope.coolDownMs > RETRY_GUARDRAILS.maxCoolDownMs
    ) {
      errors.push(
        `coolDownMs must be between ${RETRY_GUARDRAILS.minCoolDownMs} and ${RETRY_GUARDRAILS.maxCoolDownMs}`,
      );
    }
    if (
      envelope.failureBudgetMs < RETRY_GUARDRAILS.minFailureBudgetMs ||
      envelope.failureBudgetMs > RETRY_GUARDRAILS.maxFailureBudgetMs
    ) {
      errors.push(
        `failureBudgetMs must be between ${RETRY_GUARDRAILS.minFailureBudgetMs} and ${RETRY_GUARDRAILS.maxFailureBudgetMs}`,
      );
    }
    if (envelope.maxDelayMs < envelope.initialDelayMs) {
      errors.push("maxDelayMs cannot be less than initialDelayMs");
    }
    if (
      envelope.failureBudgetMs < envelope.initialDelayMs + MIN_FAILURE_BUDGET_MARGIN_MS
    ) {
      errors.push(
        "failureBudgetMs must accommodate at least one retry delay plus margin",
      );
    }
    return { isValid: errors.length === 0, errors };
  }

  private refresh(): void {
    try {
      const retryConfig = this.configurationManager.getRetryConfig();
      this.overrides = { ...retryConfig.overrides };
      this.cache.clear();
      for (const domain of Object.keys(DEFAULT_RETRY_ENVELOPES)) {
        const typedDomain = domain as AgentVoiceFaultDomain;
        this.cache.set(typedDomain, this.buildEnvelope(typedDomain));
      }
    } catch (error: any) {
      this.logger.error("Failed to refresh retry configuration", {
        error: error?.message ?? error,
      });
    }
  }

  private buildEnvelope(domain: AgentVoiceFaultDomain): RetryEnvelope {
    const base = cloneEnvelope(DEFAULT_RETRY_ENVELOPES[domain] ?? DEFAULT_RETRY_ENVELOPES.session);
    const override = this.overrides[domain];
    if (!override) {
      return base;
    }

    if (override.policy) {
      base.policy = override.policy;
    }
    if (override.initialDelayMs !== undefined) {
      base.initialDelayMs = clamp(
        override.initialDelayMs,
        RETRY_GUARDRAILS.minInitialDelayMs,
        RETRY_GUARDRAILS.maxInitialDelayMs,
      );
    }
    if (override.multiplier !== undefined) {
      base.multiplier = clamp(
        override.multiplier,
        RETRY_GUARDRAILS.minMultiplier,
        RETRY_GUARDRAILS.maxMultiplier,
      );
    }
    if (override.maxDelayMs !== undefined) {
      base.maxDelayMs = clamp(
        override.maxDelayMs,
        RETRY_GUARDRAILS.minMaxDelayMs,
        RETRY_GUARDRAILS.maxMaxDelayMs,
      );
    }
    if (override.maxAttempts !== undefined) {
      base.maxAttempts = clamp(
        override.maxAttempts,
        RETRY_GUARDRAILS.minAttempts,
        RETRY_GUARDRAILS.maxAttempts,
      );
    }
    if (override.jitterStrategy) {
      base.jitterStrategy = override.jitterStrategy;
    }
    if (override.coolDownMs !== undefined) {
      base.coolDownMs = clamp(
        override.coolDownMs,
        RETRY_GUARDRAILS.minCoolDownMs,
        RETRY_GUARDRAILS.maxCoolDownMs,
      );
    }
    if (override.failureBudgetMs !== undefined) {
      base.failureBudgetMs = clamp(
        override.failureBudgetMs,
        RETRY_GUARDRAILS.minFailureBudgetMs,
        RETRY_GUARDRAILS.maxFailureBudgetMs,
      );
    }

    if (base.maxDelayMs < base.initialDelayMs) {
      base.maxDelayMs = base.initialDelayMs;
    }
    if (
      base.failureBudgetMs <
      Math.max(base.initialDelayMs, base.maxDelayMs) + MIN_FAILURE_BUDGET_MARGIN_MS
    ) {
      base.failureBudgetMs =
        Math.max(base.initialDelayMs, base.maxDelayMs) + MIN_FAILURE_BUDGET_MARGIN_MS;
    }

    return base;
  }
}

import type {
    AgentVoiceFaultDomain,
    AgentVoiceSeverity,
} from "../../types/error/error-taxonomy";
import { Logger } from "../logger";
import type { RetryMetricsSink, RetryOutcome } from "./retry-types";

interface SanitizedMetadata {
  attempt?: number;
  delayMs?: number;
  failureBudgetMs?: number;
  elapsedMs?: number;
  [key: string]: unknown;
}

export class RetryMetricsLoggerSink implements RetryMetricsSink {
  constructor(private readonly logger: Logger) {}

  async incrementAttempt(
    domain: AgentVoiceFaultDomain,
    severity: AgentVoiceSeverity,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const sanitized = this.sanitize(metadata);
    this.logger.debug("Retry attempt", {
      domain,
      severity,
      ...sanitized,
    });
  }

  async recordOutcome(
    domain: AgentVoiceFaultDomain,
    outcome: RetryOutcome,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const sanitized = this.sanitize(metadata);
    this.logger.info("Retry outcome", {
      domain,
      success: outcome.success,
      attempts: outcome.attempts,
      totalDurationMs: outcome.totalDurationMs,
      circuitBreakerOpened: outcome.circuitBreakerOpened ?? false,
      ...sanitized,
    });
    if (!outcome.success && outcome.lastError) {
      this.logger.warn("Retry operation failed", {
        domain,
        errorCode: outcome.lastError.code,
        faultDomain: outcome.lastError.faultDomain,
        severity: outcome.lastError.severity,
      });
    }
  }

  private sanitize(metadata?: Record<string, unknown>): SanitizedMetadata | undefined {
    if (!metadata) {
      return undefined;
    }
    const allowedKeys = ["attempt", "delayMs", "failureBudgetMs", "elapsedMs"];
    const result: SanitizedMetadata = {};
    for (const key of allowedKeys) {
      if (metadata[key] !== undefined) {
        result[key] = metadata[key];
      }
    }
    return result;
  }
}

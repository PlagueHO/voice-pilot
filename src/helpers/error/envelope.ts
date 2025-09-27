import { randomUUID } from 'crypto';
import {
  DEFAULT_SEVERITY_FOR_DOMAIN,
  DEFAULT_USER_IMPACT_FOR_DOMAIN,
  normalizeSeverity,
  normalizeUserImpact
} from '../../types/error/error-taxonomy';
import type {
  RecoveryExecutionOptions,
  RecoveryExecutor,
  RecoveryPlan,
  RetryPlan,
  VoicePilotError
} from '../../types/error/voice-pilot-error';

/**
 * Describes the information required to construct a normalized {@link VoicePilotError}.
 * @remarks
 * Prefer capturing the earliest relevant context (fault domain, user impact, correlation) so downstream
 * recovery strategies and telemetry pipelines can make well-informed decisions.
 */
export interface WrapErrorOptions {
  faultDomain: RecoveryExecutionOptions['faultDomain'];
  code: string;
  message: string;
  remediation: string;
  severity?: RecoveryExecutionOptions['severity'];
  userImpact?: RecoveryExecutionOptions['userImpact'];
  metadata?: Record<string, unknown>;
  cause?: Error;
  retryPlan?: RetryPlan;
  recoveryPlan?: RecoveryPlan;
  telemetryContext?: RecoveryExecutionOptions['telemetryContext'];
  correlationId?: string;
  timestamp?: Date;
}

/**
 * Creates a {@link VoicePilotError} with normalized severity, impact, and telemetry context.
 * @param options - Error envelope data describing the failure and recommended recovery paths.
 * @returns A structured {@link VoicePilotError} instance suitable for logging, telemetry, and recovery orchestration.
 */
export function createVoicePilotError(options: WrapErrorOptions): VoicePilotError {
  const severity = options.severity ?? DEFAULT_SEVERITY_FOR_DOMAIN[options.faultDomain];
  const userImpact = options.userImpact ?? DEFAULT_USER_IMPACT_FOR_DOMAIN[options.faultDomain];

  const telemetry = options.telemetryContext
    ? {
        ...options.telemetryContext,
        correlationId: options.telemetryContext.correlationId || options.correlationId || randomUUID()
      }
    : options.correlationId
    ? {
        correlationId: options.correlationId
      }
    : undefined;

  return {
    id: randomUUID(),
    faultDomain: options.faultDomain,
    severity: normalizeSeverity(severity),
    userImpact: normalizeUserImpact(userImpact),
    code: options.code,
    message: options.message,
    remediation: options.remediation,
    cause: options.cause,
    metadata: options.metadata,
    timestamp: options.timestamp ?? new Date(),
    retryPlan: options.retryPlan,
    recoveryPlan: options.recoveryPlan,
    telemetryContext: telemetry
  };
}

/**
 * Extends {@link WrapErrorOptions} to include an unknown error payload that should become the root cause.
 */
export interface WrapUnknownErrorOptions extends WrapErrorOptions {
  error: unknown;
}

/**
 * Normalizes an unknown error into a {@link VoicePilotError}, ensuring the original error is preserved as the cause.
 * @param options - Error details plus the raw error value thrown by the failing operation.
 */
export function wrapError(options: WrapUnknownErrorOptions): VoicePilotError {
  const cause = options.error instanceof Error
    ? options.error
    : new Error(typeof options.error === 'string' ? options.error : JSON.stringify(options.error));
  return createVoicePilotError({
    ...options,
    cause
  });
}

/**
 * Options used when executing an operation through a {@link RecoveryExecutor}.
 */
export interface WithRecoveryOptions extends RecoveryExecutionOptions {
  executor: RecoveryExecutor;
}

/**
 * Executes the provided async operation within the configured recovery executor context.
 * @typeParam T - Result type produced by the wrapped operation.
 * @param operation - Function that performs the work and may throw.
 * @param options - Recovery execution context plus the executor that implements the recovery strategy.
 * @returns The value produced by the operation if it completes successfully.
 */
export async function withRecovery<T>(operation: () => Promise<T>, options: WithRecoveryOptions): Promise<T> {
  const { executor, ...context } = options;
  return executor.execute(operation, context);
}

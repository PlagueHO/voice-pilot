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

export interface WrapUnknownErrorOptions extends WrapErrorOptions {
  error: unknown;
}

export function wrapError(options: WrapUnknownErrorOptions): VoicePilotError {
  const cause = options.error instanceof Error
    ? options.error
    : new Error(typeof options.error === 'string' ? options.error : JSON.stringify(options.error));
  return createVoicePilotError({
    ...options,
    cause
  });
}

export interface WithRecoveryOptions extends RecoveryExecutionOptions {
  executor: RecoveryExecutor;
}

export async function withRecovery<T>(operation: () => Promise<T>, options: WithRecoveryOptions): Promise<T> {
  const { executor, ...context } = options;
  return executor.execute(operation, context);
}

import type { VoicePilotError } from '../../types/error/voice-pilot-error';

/**
 * Set of case-insensitive keys that must be replaced to avoid leaking credentials or tokens.
 */
const REDACTION_KEYS = new Set([
	'token',
	'authorization',
	'apiKey',
	'api-key',
	'secret',
	'client_secret',
	'access_token',
	'refresh_token',
	'password'
]);

const REDACTION_PLACEHOLDER = '***REDACTED***';

type JsonMap = Record<string, unknown>;
type JsonLike = JsonMap | unknown[];

function shouldRedactKey(key: string): boolean {
	if (!key) {
		return false;
	}
	return REDACTION_KEYS.has(key.toLowerCase());
}

function redactPrimitive(value: string | number | boolean | null | undefined): string | number | boolean | null | undefined {
	if (typeof value === 'string' && value.length > 256) {
		return `${value.slice(0, 128)}…`;
	}
	return value;
}

function redactUnknown(value: unknown): unknown {
	if (value === undefined || value === null) {
		return value;
	}
	if (typeof value === 'function') {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map(item => redactUnknown(item)) as unknown[];
	}
	if (typeof value === 'object') {
		const result: JsonMap = {};
		for (const [key, entry] of Object.entries(value as JsonMap)) {
			if (shouldRedactKey(key)) {
				result[key] = REDACTION_PLACEHOLDER;
				continue;
			}
			const redacted = redactUnknown(entry);
			if (redacted !== undefined) {
				result[key] = redacted;
			}
		}
		return result;
	}
	return redactPrimitive(value as string | number | boolean | null | undefined);
}

function ensureJsonLike(value: unknown): JsonLike {
	const redacted = redactUnknown(value);
	if (Array.isArray(redacted)) {
		return redacted;
	}
	return (redacted ?? {}) as JsonMap;
}

/**
 * Produces a sanitized copy of a {@link VoicePilotError} by removing or redacting sensitive metadata
 * before it is persisted or emitted to telemetry.
 *
 * @param error - The error instance that may contain sensitive data.
 * @returns A shallow clone of the error with redacted metadata and telemetry context.
 */
export function redactError(error: VoicePilotError): VoicePilotError {
	return {
		...error,
		cause: undefined,
		metadata: error.metadata ? (ensureJsonLike(error.metadata) as JsonMap) : undefined,
		telemetryContext: error.telemetryContext
			? {
					...error.telemetryContext,
					connectionId: error.telemetryContext.connectionId ? REDACTION_PLACEHOLDER : undefined,
					sessionId: error.telemetryContext.sessionId,
					requestId: error.telemetryContext.requestId
				}
			: undefined
	};
}

/**
 * Converts a {@link VoicePilotError} into a loggable object with ISO string timestamps and redacted fields.
 *
 * @param error - The sanitized or raw error that should be logged.
 * @returns A JSON-compatible structure safe for structured logging sinks.
 */
export function sanitizeForLog(error: VoicePilotError): Record<string, unknown> {
	const redacted = redactError(error);
	const { cause, ...rest } = redacted;
	return {
		...rest,
		timestamp: rest.timestamp.toISOString(),
		retryPlan: rest.retryPlan
			? {
					...rest.retryPlan,
					nextAttemptAt: rest.retryPlan.nextAttemptAt?.toISOString(),
					circuitBreaker: rest.retryPlan.circuitBreaker
						? {
								...rest.retryPlan.circuitBreaker,
								openedAt: rest.retryPlan.circuitBreaker.openedAt?.toISOString(),
								lastAttemptAt: rest.retryPlan.circuitBreaker.lastAttemptAt?.toISOString()
							}
						: undefined
				}
			: undefined
	};
}

/**
 * Normalizes arbitrary values into serializable structures by redacting primitives and stripping
 * unsafe object properties for resilient telemetry emission.
 *
 * @param input - Any value that might originate from user input, thrown errors, or service responses.
 * @returns A JSON-safe representation with long strings truncated and functions removed.
 */
export function sanitizeUnknown(input: unknown): unknown {
	if (input instanceof Error) {
		return {
			name: input.name,
			message: input.message,
			stack: input.stack
		};
	}
	if (!input || typeof input !== 'object') {
		return redactPrimitive(input as string | number | boolean | null | undefined);
	}
	return ensureJsonLike(input);
}

import type { VoicePilotError } from '../../types/error/voice-pilot-error';

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

const SECRET_KEY_PATTERN = /(api[-_]?key|token|secret|authorization|credential)/i;
const SECRET_VALUE_PATTERN = /([A-Za-z0-9+\/=]{12,})/g;

const redactReplacement = "[REDACTED]";

export function sanitizeLogMessage(message: string): string {
  if (!message) {
    return message;
  }
  // Replace key=value patterns first
  const keyValueSanitized = message.replace(
    /(api[-_]?key|token|secret|authorization|credential)(\s*[=:]\s*)([^\s"']+)/gi,
    (_, key: string, delimiter: string) => `${key}${delimiter}${redactReplacement}`,
  );

  // Replace quoted string values associated with secret keys
  const quotedSanitized = keyValueSanitized.replace(
    /(api[-_]?key|token|secret|authorization|credential)(\s*[=:]\s*["'])([^"']+)(["'])/gi,
    (_, key: string, prefix: string, _value: string, suffix: string) =>
      `${key}${prefix}${redactReplacement}${suffix}`,
  );

  // Finally redact standalone high entropy tokens
  return quotedSanitized.replace(SECRET_VALUE_PATTERN, (match: string) => {
    if (match.length >= 24) {
      return redactReplacement;
    }
    return match;
  });
}

export function sanitizeStructured<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeLogMessage(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructured(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        sanitized[key] = redactReplacement;
      } else {
        sanitized[key] = sanitizeStructured(entry);
      }
    }
    return sanitized as T;
  }
  return value;
}

export function scrubSecretsFromError(error: unknown): unknown {
  if (!error) {
    return error;
  }
  if (error instanceof Error) {
    const sanitized = new Error(sanitizeLogMessage(error.message));
    sanitized.name = error.name;
    sanitized.stack = error.stack
      ? sanitizeLogMessage(error.stack)
      : error.stack;
    return sanitized;
  }
  return sanitizeStructured(error);
}

export interface SanitizedLogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
}

export function sanitizeLogEntry(entry: {
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
}): SanitizedLogEntry {
  return {
    timestamp: entry.timestamp,
    level: entry.level,
    message: sanitizeLogMessage(entry.message),
    data: sanitizeStructured(entry.data),
  };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeLogMessage = sanitizeLogMessage;
exports.sanitizeStructured = sanitizeStructured;
exports.scrubSecretsFromError = scrubSecretsFromError;
exports.sanitizeLogEntry = sanitizeLogEntry;
const SECRET_KEY_PATTERN = /(api[-_]?key|token|secret|authorization|credential)/i;
const SECRET_VALUE_PATTERN = /([A-Za-z0-9+\/=]{12,})/g;
const redactReplacement = "[REDACTED]";
function sanitizeLogMessage(message) {
    if (!message) {
        return message;
    }
    // Replace key=value patterns first
    const keyValueSanitized = message.replace(/(api[-_]?key|token|secret|authorization|credential)(\s*[=:]\s*)([^\s"']+)/gi, (_, key, delimiter) => `${key}${delimiter}${redactReplacement}`);
    // Replace quoted string values associated with secret keys
    const quotedSanitized = keyValueSanitized.replace(/(api[-_]?key|token|secret|authorization|credential)(\s*[=:]\s*["'])([^"']+)(["'])/gi, (_, key, prefix, _value, suffix) => `${key}${prefix}${redactReplacement}${suffix}`);
    // Finally redact standalone high entropy tokens
    return quotedSanitized.replace(SECRET_VALUE_PATTERN, (match) => {
        if (match.length >= 24) {
            return redactReplacement;
        }
        return match;
    });
}
function sanitizeStructured(value) {
    if (typeof value === "string") {
        return sanitizeLogMessage(value);
    }
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeStructured(item));
    }
    if (value && typeof value === "object") {
        const sanitized = {};
        for (const [key, entry] of Object.entries(value)) {
            if (SECRET_KEY_PATTERN.test(key)) {
                sanitized[key] = redactReplacement;
            }
            else {
                sanitized[key] = sanitizeStructured(entry);
            }
        }
        return sanitized;
    }
    return value;
}
function scrubSecretsFromError(error) {
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
function sanitizeLogEntry(entry) {
    return {
        timestamp: entry.timestamp,
        level: entry.level,
        message: sanitizeLogMessage(entry.message),
        data: sanitizeStructured(entry.data),
    };
}
//# sourceMappingURL=sanitizers.js.map
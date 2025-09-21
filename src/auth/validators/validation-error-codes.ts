/**
 * Canonical validation error codes used across credential validation.
 */
export const ValidationErrorCodes = {
  // Format errors
  INVALID_KEY_FORMAT: 'INVALID_KEY_FORMAT',
  INVALID_KEY_CHARACTERS: 'INVALID_KEY_CHARACTERS',
  INVALID_KEY_LENGTH: 'INVALID_KEY_LENGTH',

  // Authentication errors
  KEY_AUTHENTICATION_FAILED: 'KEY_AUTHENTICATION_FAILED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',

  // Network errors
  VALIDATION_TIMEOUT: 'VALIDATION_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  ENDPOINT_UNAVAILABLE: 'ENDPOINT_UNAVAILABLE'
} as const;

export type ValidationErrorCode = typeof ValidationErrorCodes[keyof typeof ValidationErrorCodes];

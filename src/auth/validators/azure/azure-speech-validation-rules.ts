import { CredentialValidationError } from '../../../types/credentials';
import { ValidationErrorCodes } from '../validation-error-codes';

/**
 * Format validation for Azure Speech API keys.
 */
export class AzureSpeechValidationRules {
  static readonly MIN_LENGTH = 32;
  static readonly HEX_PATTERN = /^[a-f0-9]+$/i;

  static validateFormat(key: string): CredentialValidationError[] {
    const errors: CredentialValidationError[] = [];

    if (!key || key.trim().length === 0) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_FORMAT,
        message: 'Azure Speech key cannot be empty',
        remediation: 'Enter a valid Azure Speech API key from Azure Portal'
      });
      return errors;
    }

    if (key.length < this.MIN_LENGTH) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_LENGTH,
        message: `Azure Speech key must be at least ${this.MIN_LENGTH} characters`,
        remediation: 'Copy the complete API key from Azure Portal'
      });
    }

    if (!this.HEX_PATTERN.test(key)) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_CHARACTERS,
        message: 'Azure Speech key contains invalid characters',
        remediation: 'Ensure key is copied correctly without extra spaces or special characters'
      });
    }

    return errors;
  }
}

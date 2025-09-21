import { CredentialValidationError } from '../../../types/credentials';
import { ValidationErrorCodes } from '../validationErrorCodes';

/**
 * Format validation for Azure OpenAI API keys.
 */
export class AzureOpenAIValidationRules {
  static readonly MIN_LENGTH = 32;
  static readonly HEX_PATTERN = /^[a-f0-9]+$/i;

  static validateFormat(key: string): CredentialValidationError[] {
    const errors: CredentialValidationError[] = [];

    if (!key || key.trim().length === 0) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_FORMAT,
        message: 'Azure OpenAI key cannot be empty',
        remediation: 'Enter a valid Azure OpenAI API key from Azure Portal'
      });
      return errors;
    }

    if (key.length < this.MIN_LENGTH) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_LENGTH,
        message: `Azure OpenAI key must be at least ${this.MIN_LENGTH} characters`,
        remediation: 'Copy the complete API key from Azure Portal'
      });
    }

    if (!this.HEX_PATTERN.test(key)) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_CHARACTERS,
        message: 'Azure OpenAI key contains invalid characters',
        remediation: 'Ensure key is copied correctly without extra spaces or special characters'
      });
    }

    return errors;
  }
}

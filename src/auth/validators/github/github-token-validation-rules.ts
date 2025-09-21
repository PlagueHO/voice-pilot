import { CredentialValidationError } from '../../../types/credentials';
import { ValidationErrorCodes } from '../validation-error-codes';

/**
 * Format validation for GitHub Personal Access Tokens (classic and fine-grained).
 */
export class GitHubTokenValidationRules {
  static readonly MIN_LENGTH = 40;
  static readonly CLASSIC_PATTERN = /^ghp_[A-Za-z0-9_]{36}$/;
  static readonly FINE_GRAINED_PATTERN = /^github_pat_[A-Za-z0-9_]{82}$/;

  static validateFormat(token: string): CredentialValidationError[] {
    const errors: CredentialValidationError[] = [];

    if (!token || token.trim().length === 0) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_FORMAT,
        message: 'GitHub token cannot be empty',
        remediation: 'Enter a valid GitHub Personal Access Token'
      });
      return errors;
    }

    if (token.length < this.MIN_LENGTH) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_LENGTH,
        message: `GitHub token must be at least ${this.MIN_LENGTH} characters`,
        remediation: 'Copy the complete token from GitHub settings'
      });
    }

    const isClassicToken = this.CLASSIC_PATTERN.test(token);
    const isFineGrainedToken = this.FINE_GRAINED_PATTERN.test(token);

    if (!isClassicToken && !isFineGrainedToken) {
      errors.push({
        code: ValidationErrorCodes.INVALID_KEY_CHARACTERS,
        message: 'GitHub token format is invalid',
        remediation: 'Token should start with "ghp_" (classic) or "github_pat_" (fine-grained)'
      });
    }

    return errors;
  }

  static getTokenType(token: string): 'classic' | 'fine-grained' | 'unknown' {
    if (this.CLASSIC_PATTERN.test(token)) {
      return 'classic';
    }
    if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

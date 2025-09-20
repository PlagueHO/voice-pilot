import { CredentialValidationError } from '../../types/credentials';

/**
 * Validation error codes for consistent error handling
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

/**
 * Validation rules for Azure OpenAI API keys
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

/**
 * Validation rules for Azure Speech API keys
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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

/**
 * Validation rules for Azure OpenAI API keys
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

/**
 * Validation rules for Azure Speech API keys
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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

/**
 * Validation rules for Azure OpenAI API keys
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

/**
 * Validation rules for Azure Speech API keys
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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

/**
 * Validation rules for Azure OpenAI API keys
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

/**
 * Validation rules for Azure Speech API keys
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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

/**
 * Validation rules for Azure OpenAI API keys
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

/**
 * Validation rules for Azure Speech API keys
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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

/**
 * Validation rules for Azure OpenAI API keys
 */
export class AzureOpenAIValidationRules {
  static readonly MIN_LENGTH = 32;
  static readonly HEX_PATTERN = /^[a-f0-9]+$/i;

  static validateFormat(key: string): ValidationError[] {
    const errors: ValidationError[] = [];

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

/**
 * Validation rules for Azure Speech API keys
 */
export class AzureSpeechValidationRules {
  static readonly MIN_LENGTH = 32;
  static readonly HEX_PATTERN = /^[a-f0-9]+$/i;

  static validateFormat(key: string): ValidationError[] {
    const errors: ValidationError[] = [];

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

/**
 * Validation rules for GitHub Personal Access Tokens
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
    } else if (this.FINE_GRAINED_PATTERN.test(token)) {
      return 'fine-grained';
    }
    return 'unknown';
  }
}

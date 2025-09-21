import { Logger } from '../../core/logger';
import { CredentialValidationResult, CredentialValidator } from '../../types/credentials';
import { VALIDATION_ENDPOINTS, VALIDATION_TIMEOUTS } from '../constants';
import {
    AzureOpenAIValidationRules,
    GitHubTokenValidationRules,
    ValidationErrorCodes
} from './ValidationRules';

/**
 * Implementation of credential validation with format and network checks
 */
export class CredentialValidatorImpl implements CredentialValidator {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async validateAzureOpenAIKey(key: string): Promise<CredentialValidationResult> {
    this.logger.debug('Validating Azure OpenAI key format');

    // Format validation
    const formatErrors = AzureOpenAIValidationRules.validateFormat(key);
    if (formatErrors.length > 0) {
      return { isValid: false, errors: formatErrors };
    }

    // Network validation (optional, with timeout)
    try {
      const isValid = await this.testAzureOpenAIConnection(key);
      if (!isValid) {
        return {
          isValid: false,
          errors: [{
            code: ValidationErrorCodes.KEY_AUTHENTICATION_FAILED,
            message: 'Azure OpenAI key authentication failed',
            remediation: 'Verify key is active and has necessary permissions in Azure Portal'
          }]
        };
      }

      this.logger.debug('Azure OpenAI key validation successful');
      return {
        isValid: true,
        errors: [],
        metadata: {
          keyFormat: 'azure-openai-hex',
          permissions: ['openai.deployments.read']
        }
      };
    } catch (error: any) {
      // Network errors don't invalidate the key format
      this.logger.warn('Could not validate Azure OpenAI key due to network error', { error: error.message });

      if (error.name === 'AbortError') {
        return {
          isValid: true, // Format is valid, network timeout doesn't invalidate
          errors: [],
          metadata: {
            keyFormat: 'azure-openai-hex',
            permissions: ['validation-timeout']
          }
        };
      }

      // Return format validation success with network warning
      return {
        isValid: true,
        errors: [],
        metadata: {
          keyFormat: 'azure-openai-hex',
          permissions: ['network-validation-failed']
        }
      };
    }
  }

  async validateGitHubToken(token: string): Promise<CredentialValidationResult> {
    this.logger.debug('Validating GitHub token format');

    // Format validation
    const formatErrors = GitHubTokenValidationRules.validateFormat(token);
    if (formatErrors.length > 0) {
      return { isValid: false, errors: formatErrors };
    }

    // Network validation (optional, with timeout)
    try {
      const { isValid, permissions, expirationDate } = await this.testGitHubConnection(token);
      if (!isValid) {
        return {
          isValid: false,
          errors: [{
            code: ValidationErrorCodes.KEY_AUTHENTICATION_FAILED,
            message: 'GitHub token authentication failed',
            remediation: 'Verify token is active and has not expired in GitHub settings'
          }]
        };
      }

      this.logger.debug('GitHub token validation successful');
      return {
        isValid: true,
        errors: [],
        metadata: {
          keyFormat: GitHubTokenValidationRules.getTokenType(token),
          permissions,
          expirationDate
        }
      };
    } catch (error: any) {
      // Network errors don't invalidate the token format
      this.logger.warn('Could not validate GitHub token due to network error', { error: error.message });

      return {
        isValid: true,
        errors: [],
        metadata: {
          keyFormat: GitHubTokenValidationRules.getTokenType(token),
          permissions: ['network-validation-failed']
        }
      };
    }
  }

  private async testAzureOpenAIConnection(key: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.NETWORK_VALIDATION_MS);

    try {
      const response = await fetch(VALIDATION_ENDPOINTS.AZURE_OPENAI, {
        headers: {
          'api-key': key,
          'User-Agent': 'VoicePilot/1.0'
        },
        signal: controller.signal
      });
      return response.ok;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Validation timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async testAzureSpeechConnection(key: string): Promise<boolean> {
    // Azure Speech validation removed: use Azure OpenAI Realtime validation flows instead
    return false;
  }

  private async testGitHubConnection(token: string): Promise<{ isValid: boolean; permissions?: string[]; expirationDate?: Date }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUTS.NETWORK_VALIDATION_MS);

    try {
      const response = await fetch(VALIDATION_ENDPOINTS.GITHUB_API, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'VoicePilot/1.0',
          'Accept': 'application/vnd.github.v3+json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        return { isValid: false };
      }

      // Extract token permissions from response headers
      const scopes = response.headers.get('X-OAuth-Scopes')?.split(', ') || [];

      // Check for token expiration (if available)
      const rateLimit = response.headers.get('X-RateLimit-Reset');
      let expirationDate: Date | undefined;
      if (rateLimit) {
        expirationDate = new Date(parseInt(rateLimit) * 1000);
      }

      return {
        isValid: true,
        permissions: scopes,
        expirationDate
      };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Validation timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

import { ServiceInitializable } from '../core/ServiceInitializable';

/**
 * Enumeration of supported credential types
 */
export enum CredentialType {
  AzureOpenAI = 'azure-openai',
  GitHub = 'github'
}

/**
 * Information about a stored credential
 */
export interface CredentialInfo {
  type: CredentialType;
  keyName: string;
  isPresent: boolean;
  lastUpdated?: Date;
  isValid?: boolean;
}

/**
 * Result of credential storage health check
 */
export interface HealthCheckResult {
  secretStorageAvailable: boolean;
  credentialsAccessible: boolean;
  errors: string[];
}

/**
 * Credential validation error details
 */
export interface CredentialValidationError {
  code: string;
  message: string;
  remediation: string;
}

/**
 * Result of credential validation
 */
export interface CredentialValidationResult {
  isValid: boolean;
  errors: CredentialValidationError[];
  metadata?: {
    keyFormat?: string;
    permissions?: string[];
    expirationDate?: Date;
  };
}

/**
 * Main credential manager interface for secure storage and retrieval
 */
export interface CredentialManager extends ServiceInitializable {
  // Azure OpenAI credentials
  storeAzureOpenAIKey(key: string): Promise<void>;
  getAzureOpenAIKey(): Promise<string | undefined>;
  clearAzureOpenAIKey(): Promise<void>;

  // Azure Speech credentials
  // Azure Speech removed: use Azure OpenAI Realtime instead

  // GitHub credentials
  storeGitHubToken(token: string): Promise<void>;
  getGitHubToken(): Promise<string | undefined>;
  clearGitHubToken(): Promise<void>;

  // Lifecycle management
  validateCredential(type: CredentialType, value: string): Promise<CredentialValidationResult>;
  listStoredCredentials(): Promise<CredentialInfo[]>;
  clearAllCredentials(): Promise<void>;

  // Health checks
  testCredentialAccess(): Promise<HealthCheckResult>;

  // Migration support
  migrateCredentials(): Promise<void>;
}

/**
 * Interface for credential validation
 */
export interface CredentialValidator {
  validateAzureOpenAIKey(key: string): Promise<CredentialValidationResult>;
  validateGitHubToken(token: string): Promise<CredentialValidationResult>;
}

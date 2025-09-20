---
title: Secret Storage & Credential Handling
version: 1.0
date_created: 2025-09-20
last_updated: 2025-09-20
owner: VoicePilot Project
tags: [security, secrets, credentials, storage, vscode]
---

This specification defines secure storage and credential handling mechanisms for the VoicePilot VS Code extension. It establishes security boundaries for sensitive data such as Azure API keys, GitHub tokens, and other authentication credentials, ensuring they are never exposed in plaintext configuration or logging while providing secure access patterns for extension services.

## 1. Purpose & Scope

This specification defines the security requirements and implementation patterns for credential handling in VoicePilot, covering:

- Secure storage of API keys and authentication tokens
- Access control and retrieval patterns for sensitive data
- Integration with VS Code's Secret Storage API
- Credential lifecycle management (storage, rotation, deletion)
- Security boundaries between extension components
- Fallback and error handling for credential operations

**Intended Audience**: Extension developers, security reviewers, and service integrators.

**Assumptions**:

- VS Code Secret Storage API availability and functionality
- Understanding of credential security best practices
- Knowledge of VS Code extension security model
- Familiarity with Azure and GitHub authentication patterns

## 2. Definitions

- **Secret Storage**: VS Code's secure credential storage mechanism using OS keychain/credential manager
- **API Key**: Long-lived authentication credential for Azure services
- **Personal Access Token (PAT)**: GitHub authentication token with scoped permissions
- **Ephemeral Key**: Short-lived session token derived from permanent credentials
- **Credential Manager**: Service responsible for secure credential operations
- **Security Boundary**: Clear separation between secure and non-secure contexts
- **Keychain**: OS-level secure storage (Windows Credential Manager, macOS Keychain, Linux libsecret)
- **Secret Key**: Unique identifier used to store and retrieve credentials from secret storage

## 3. Requirements, Constraints & Guidelines

### Security Requirements

- **SEC-001**: API keys and tokens SHALL NEVER be stored in VS Code configuration settings
- **SEC-002**: Credentials SHALL be stored exclusively in VS Code Secret Storage (OS keychain)
- **SEC-003**: Secret storage operations SHALL implement comprehensive error handling
- **SEC-004**: Credential access SHALL be limited to authorized extension components
- **SEC-005**: Sensitive data SHALL NOT appear in logs, error messages, or debug output
- **SEC-006**: Credentials SHALL be cleared from memory immediately after use
- **SEC-007**: Secret storage keys SHALL use namespaced, descriptive identifiers

### Storage Requirements

- **STO-001**: Credential Manager SHALL provide typed interfaces for each credential type
- **STO-002**: Secret storage SHALL support create, read, update, and delete operations
- **STO-003**: Credential storage SHALL be atomic (complete success or complete failure)
- **STO-004**: Storage operations SHALL include validation of credential format
- **STO-005**: Credentials SHALL be stored with metadata for lifecycle management

### Access Control Requirements

- **ACC-001**: Only authorized services SHALL access credential storage
- **ACC-002**: Credential retrieval SHALL validate requesting service identity
- **ACC-003**: Access patterns SHALL be logged for security auditing (without exposing values)
- **ACC-004**: Credential Manager SHALL implement dependency injection for controlled access

### Error Handling Requirements

- **ERR-001**: Missing credentials SHALL provide clear user guidance without exposing secrets
- **ERR-002**: Storage failures SHALL fall back gracefully without credential exposure
- **ERR-003**: Invalid credentials SHALL be detected and user notified securely
- **ERR-004**: Error messages SHALL NOT contain partial or masked credential values

### Performance Constraints

- **CON-001**: Credential retrieval MUST complete within 2 seconds
- **CON-002**: Storage operations MUST NOT block extension activation
- **CON-003**: Credential caching MUST implement secure memory handling
- **CON-004**: Bulk operations MUST handle individual failures gracefully

### Lifecycle Guidelines

- **GUD-001**: Implement credential validation before storage
- **GUD-002**: Provide secure credential update mechanisms
- **GUD-003**: Support credential migration for schema updates
- **GUD-004**: Clear expired or invalid credentials automatically

### Implementation Patterns

- **PAT-001**: Use VS Code Extension Context for Secret Storage access
- **PAT-002**: Implement async/await patterns for all credential operations
- **PAT-003**: Use TypeScript interfaces for credential type safety
- **PAT-004**: Implement credential factory pattern for different authentication types

## 4. Interfaces & Data Contracts

### Credential Manager Interface

```typescript
interface CredentialManager extends ServiceInitializable {
  // Azure OpenAI credentials
  storeAzureOpenAIKey(key: string): Promise<void>;
  getAzureOpenAIKey(): Promise<string | undefined>;
  clearAzureOpenAIKey(): Promise<void>;

  // Azure Speech credentials
  storeAzureSpeechKey(key: string): Promise<void>;
  getAzureSpeechKey(): Promise<string | undefined>;
  clearAzureSpeechKey(): Promise<void>;

  // GitHub credentials
  storeGitHubToken(token: string): Promise<void>;
  getGitHubToken(): Promise<string | undefined>;
  clearGitHubToken(): Promise<void>;

  // Lifecycle management
  validateCredential(type: CredentialType, value: string): Promise<ValidationResult>;
  listStoredCredentials(): Promise<CredentialInfo[]>;
  clearAllCredentials(): Promise<void>;

  // Health checks
  testCredentialAccess(): Promise<HealthCheckResult>;
}

interface CredentialInfo {
  type: CredentialType;
  keyName: string;
  isPresent: boolean;
  lastUpdated?: Date;
  isValid?: boolean;
}

interface HealthCheckResult {
  secretStorageAvailable: boolean;
  credentialsAccessible: boolean;
  errors: string[];
}

enum CredentialType {
  AzureOpenAI = 'azure-openai',
  AzureSpeech = 'azure-speech',
  GitHub = 'github'
}
```

### Secret Storage Key Schema

```typescript
interface SecretKeySchema {
  // Azure service keys
  AZURE_OPENAI_API_KEY: 'voicepilot.azure-openai.apikey';
  AZURE_SPEECH_API_KEY: 'voicepilot.azure-speech.apikey';

  // GitHub authentication
  GITHUB_PERSONAL_TOKEN: 'voicepilot.github.token';

  // Future extensibility
  [key: string]: string;
}

// Const implementation for type safety
const SECRET_KEYS: SecretKeySchema = {
  AZURE_OPENAI_API_KEY: 'voicepilot.azure-openai.apikey',
  AZURE_SPEECH_API_KEY: 'voicepilot.azure-speech.apikey',
  GITHUB_PERSONAL_TOKEN: 'voicepilot.github.token'
} as const;
```

### Credential Validation Interface

```typescript
interface CredentialValidator {
  validateAzureOpenAIKey(key: string): Promise<ValidationResult>;
  validateAzureSpeechKey(key: string): Promise<ValidationResult>;
  validateGitHubToken(token: string): Promise<ValidationResult>;
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  metadata?: {
    keyFormat?: string;
    permissions?: string[];
    expirationDate?: Date;
  };
}

interface ValidationError {
  code: string;
  message: string;
  remediation: string;
}
```

### Integration with Configuration Manager

```typescript
// Extension to existing configuration interfaces
interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region: 'eastus2' | 'swedencentral';
  // apiKey removed - now retrieved via CredentialManager
}

interface AzureSpeechConfig {
  region: string;
  voice: string;
  // apiKey removed - now retrieved via CredentialManager
}

interface GitHubConfig {
  repository: string;
  authMode: 'auto' | 'token' | 'oauth';
  // token retrieved via CredentialManager when authMode = 'token'
}
```

## 5. Acceptance Criteria

- **AC-001**: Given valid Azure OpenAI API key, When stored via Credential Manager, Then key is retrievable and not visible in settings
- **AC-002**: Given invalid API key format, When validation occurs, Then clear error message guides user to correct format
- **AC-003**: Given missing credential, When service requests access, Then user is prompted to configure credential securely
- **AC-004**: Given credential update, When new value is stored, Then old value is overwritten and not recoverable
- **AC-005**: Given Secret Storage unavailable, When credential access fails, Then graceful fallback with user guidance occurs
- **AC-006**: Given multiple credentials, When bulk operations execute, Then individual failures don't affect other credentials
- **AC-007**: Given credential validation, When network check occurs, Then validation completes within timeout without blocking
- **AC-008**: Given credential deletion, When clearAllCredentials() executes, Then all VoicePilot credentials are removed from OS keychain

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for credential operations, Integration tests with mocked Secret Storage, End-to-End tests with real OS keychain
- **Frameworks**: VS Code Extension Test Runner with Secret Storage mocking, Jest for credential validation logic
- **Test Data Management**: Test credentials that are safely disposable, isolated test keychain contexts
- **CI/CD Integration**: Automated security tests in GitHub Actions, credential handling validation
- **Coverage Requirements**: 100% code coverage for credential storage/retrieval paths, security boundary validation
- **Performance Testing**: Credential operation latency measurement, concurrent access testing
- **Security Testing**: Penetration testing for credential exposure, memory leak detection for sensitive data

## 7. Rationale & Context

The credential handling design prioritizes:

1. **Security**: Absolute prevention of credential exposure through proper storage boundaries
2. **User Experience**: Clear guidance for credential setup without exposing sensitive values
3. **Reliability**: Robust error handling and fallback mechanisms for credential operations
4. **Compliance**: Following VS Code security best practices and industry standards
5. **Maintainability**: Type-safe interfaces and clear separation of concerns

The separation between configuration (non-sensitive) and credentials (sensitive) ensures that settings can be shared safely while protecting authentication data.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Secret Storage API - Required for secure credential persistence in OS keychain
- **PLT-002**: VS Code Extension Context - Required for access to Secret Storage instance
- **PLT-003**: VS Code Authentication API - Optional for OAuth flows and credential provider integration

### Operating System Dependencies

- **OS-001**: Windows Credential Manager - Windows credential storage backend
- **OS-002**: macOS Keychain Services - macOS credential storage backend
- **OS-003**: Linux libsecret/gnome-keyring - Linux credential storage backend
- **OS-004**: User Authentication - OS-level user authentication for keychain access

### Service Integration Dependencies

- **SVC-001**: Azure OpenAI API - Credential validation against live Azure endpoints
- **SVC-002**: Azure Speech API - Credential validation for Speech service access
- **SVC-003**: GitHub API - Token validation and permission verification
- **SVC-004**: Network Connectivity - Required for credential validation against remote services

### Extension Internal Dependencies

- **INT-001**: Configuration Manager - Integration for credential-dependent configuration
- **INT-002**: Service Initializable Pattern - Consistent lifecycle management across services
- **INT-003**: Logger - Secure logging without credential exposure
- **INT-004**: Error Handler - Standardized error handling for credential operations

### Security Dependencies

- **SEC-001**: OS Keychain Security - Relies on OS-level encryption and access control
- **SEC-002**: VS Code Process Security - Extension isolation and memory protection
- **SEC-003**: Network Security - HTTPS/TLS for credential validation requests

## 9. Examples & Edge Cases

### Basic Credential Storage and Retrieval

```typescript
class CredentialManager implements ServiceInitializable {
  private context!: vscode.ExtensionContext;
  private logger!: Logger;
  private validator!: CredentialValidator;

  async initialize(): Promise<void> {
    // Test secret storage accessibility
    const healthCheck = await this.testCredentialAccess();
    if (!healthCheck.secretStorageAvailable) {
      throw new Error('Secret storage unavailable: ' + healthCheck.errors.join(', '));
    }
  }

  async storeAzureOpenAIKey(key: string): Promise<void> {
    // Validate key format before storage
    const validation = await this.validator.validateAzureOpenAIKey(key);
    if (!validation.isValid) {
      throw new Error(`Invalid Azure OpenAI key: ${validation.errors[0].message}`);
    }

    try {
      await this.context.secrets.store(SECRET_KEYS.AZURE_OPENAI_API_KEY, key);
      this.logger.info('Azure OpenAI key stored successfully');
    } catch (error) {
      this.logger.error('Failed to store Azure OpenAI key', { error: error.message });
      throw new Error('Failed to store credential securely');
    }
  }

  async getAzureOpenAIKey(): Promise<string | undefined> {
    try {
      const key = await this.context.secrets.get(SECRET_KEYS.AZURE_OPENAI_API_KEY);
      if (key) {
        this.logger.debug('Azure OpenAI key retrieved');
      }
      return key;
    } catch (error) {
      this.logger.error('Failed to retrieve Azure OpenAI key', { error: error.message });
      return undefined;
    }
  }
}
```

### Credential Validation Example

```typescript
class CredentialValidator {
  async validateAzureOpenAIKey(key: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];

    // Format validation
    if (!key || key.length < 32) {
      errors.push({
        code: 'INVALID_KEY_FORMAT',
        message: 'Azure OpenAI key must be at least 32 characters',
        remediation: 'Copy the complete API key from Azure Portal'
      });
    }

    if (!key.match(/^[a-f0-9]+$/i)) {
      errors.push({
        code: 'INVALID_KEY_CHARACTERS',
        message: 'Azure OpenAI key contains invalid characters',
        remediation: 'Ensure key is copied correctly without extra spaces'
      });
    }

    // Network validation (optional, with timeout)
    if (errors.length === 0) {
      try {
        const isValid = await this.testAzureConnection(key);
        if (!isValid) {
          errors.push({
            code: 'KEY_AUTHENTICATION_FAILED',
            message: 'Azure OpenAI key authentication failed',
            remediation: 'Verify key is active and has necessary permissions'
          });
        }
      } catch (error) {
        // Network errors don't invalidate the key format
        this.logger.warn('Could not validate Azure key due to network error', error);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async testAzureConnection(key: string): Promise<boolean> {
    // Implementation with timeout and proper error handling
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch('https://api.openai.azure.com/openai/deployments', {
        headers: { 'api-key': key },
        signal: controller.signal
      });
      return response.ok;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Validation timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

### Edge Case: Secret Storage Unavailable

```typescript
async testCredentialAccess(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    secretStorageAvailable: false,
    credentialsAccessible: false,
    errors: []
  };

  try {
    // Test basic secret storage functionality
    const testKey = 'voicepilot.test.access';
    const testValue = 'test-value';

    await this.context.secrets.store(testKey, testValue);
    const retrieved = await this.context.secrets.get(testKey);
    await this.context.secrets.delete(testKey);

    if (retrieved === testValue) {
      result.secretStorageAvailable = true;
      result.credentialsAccessible = true;
    } else {
      result.errors.push('Secret storage test failed: value mismatch');
    }
  } catch (error) {
    result.errors.push(`Secret storage error: ${error.message}`);

    // Provide user guidance based on error type
    if (error.message.includes('keychain')) {
      result.errors.push('macOS Keychain access denied. Check system preferences.');
    } else if (error.message.includes('credential manager')) {
      result.errors.push('Windows Credential Manager unavailable. Check system services.');
    } else if (error.message.includes('libsecret')) {
      result.errors.push('Linux credential storage unavailable. Install gnome-keyring or equivalent.');
    }
  }

  return result;
}
```

### Edge Case: Credential Migration

```typescript
async migrateCredentials(): Promise<void> {
  // Handle migration from old credential format to new format
  const legacyKeys = [
    'voicepilot.azure.key',  // old format
    'voicepilot.github.pat'  // old format
  ];

  for (const legacyKey of legacyKeys) {
    try {
      const value = await this.context.secrets.get(legacyKey);
      if (value) {
        // Migrate to new key format
        if (legacyKey.includes('azure')) {
          await this.storeAzureOpenAIKey(value);
        } else if (legacyKey.includes('github')) {
          await this.storeGitHubToken(value);
        }

        // Remove legacy key
        await this.context.secrets.delete(legacyKey);
        this.logger.info('Migrated credential', { from: legacyKey });
      }
    } catch (error) {
      this.logger.warn('Failed to migrate credential', { key: legacyKey, error: error.message });
    }
  }
}
```

### Error Handling with User Guidance

```typescript
async handleCredentialError(error: Error, credentialType: CredentialType): Promise<void> {
  let userMessage: string;
  let actionButton: string | undefined;

  switch (credentialType) {
    case CredentialType.AzureOpenAI:
      userMessage = 'Azure OpenAI credentials are required but not configured.';
      actionButton = 'Configure Azure Credentials';
      break;
    case CredentialType.GitHub:
      userMessage = 'GitHub access token is required for repository operations.';
      actionButton = 'Configure GitHub Token';
      break;
    default:
      userMessage = 'Required credentials are missing or invalid.';
      actionButton = 'Open Settings';
  }

  const action = await vscode.window.showErrorMessage(userMessage, actionButton, 'Help');

  if (action === actionButton) {
    // Open appropriate configuration UI
    vscode.commands.executeCommand('voicepilot.openCredentialSettings', credentialType);
  } else if (action === 'Help') {
    // Open documentation
    vscode.env.openExternal(vscode.Uri.parse('https://github.com/PlagueHO/voice-pilot/docs/setup'));
  }
}
```

## 10. Validation Criteria

- Secret storage operations function correctly across Windows, macOS, and Linux
- Credentials are never visible in VS Code settings or configuration files
- Error messages provide helpful guidance without exposing sensitive information
- Credential validation detects invalid formats and provides remediation steps
- Performance requirements met for credential operations (< 2 seconds)
- Memory handling ensures credentials are cleared after use
- Migration support works for credential schema updates
- Health checks accurately detect Secret Storage availability issues

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-002: Configuration & Settings Management](sp-002-spec-design-configuration-management.md)
- [SP-004: Ephemeral Key Service (Azure Realtime)](sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-034: Key Vault Integration & Secret Sync](sp-034-spec-design-key-vault-integration.md)
- [SP-056: Security Threat Model & Mitigations](sp-056-spec-security-threat-model.md)
- [VS Code Secret Storage API Documentation](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [VS Code Extension Security Guidelines](https://code.visualstudio.com/api/extension-guides/security)

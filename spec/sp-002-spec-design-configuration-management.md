---
title: Configuration & Settings Management
version: 1.0
date_created: 2025-09-20
last_updated: 2025-09-20
owner: VoicePilot Project
tags: [design, configuration, settings, validation]
---

This specification defines the configuration and settings management system for the VoicePilot VS Code extension. It establishes the schema, validation, change handling, and persistence mechanisms for all extension settings, ensuring proper integration with VS Code's configuration system while maintaining security and performance requirements.

## 1. Purpose & Scope

This specification defines the configuration management requirements for VoicePilot, including:

- Extension settings schema and namespace organization
- Configuration validation and error handling
- Change notification and reactive update mechanisms
- Integration with VS Code workspace and user settings
- Secure credential storage patterns
- Default value management and environment-specific overrides

**Intended Audience**: Extension developers, configuration administrators, and system integrators.

**Assumptions**:

- VS Code Configuration API knowledge
- Understanding of VS Code workspace vs user settings precedence
- Familiarity with JSON schema validation concepts

## 2. Definitions

- **Configuration**: All user-configurable settings for the extension
- **Settings Schema**: JSON schema defining valid configuration structure
- **Workspace Settings**: Project-specific configuration stored in `.vscode/settings.json`
- **User Settings**: Global VS Code user preferences
- **Secret Storage**: VS Code's secure credential storage mechanism
- **Configuration Section**: Namespaced group of related settings (e.g., `voicepilot.azureOpenAI`)
- **Change Handler**: Function that responds to configuration updates
- **Validation Rule**: Constraint that ensures configuration value correctness

## 3. Requirements, Constraints & Guidelines

### Configuration Schema Requirements

- **REQ-001**: Extension SHALL use `voicepilot.*` namespace for all settings
- **REQ-002**: Configuration SHALL be organized into logical sections (azureOpenAI, audio, github)
- **REQ-003**: All settings SHALL have defined JSON schema with type validation
- **REQ-004**: Settings SHALL include descriptive titles and detailed descriptions
- **REQ-005**: Required settings SHALL have appropriate default values or validation errors
- **REQ-006**: Enum settings SHALL provide clear option descriptions

### Security Requirements

- **SEC-001**: API keys and secrets SHALL NOT be stored in VS Code settings
- **SEC-002**: Sensitive configuration SHALL use VS Code secret storage exclusively
- **SEC-003**: Configuration validation SHALL not log sensitive values
- **SEC-004**: Default configurations SHALL not contain credentials or endpoints

### Validation Requirements

- **VAL-001**: Configuration Manager SHALL validate all settings on load
- **VAL-002**: Invalid configuration SHALL provide clear error messages with remediation steps
- **VAL-003**: URL endpoints SHALL be validated for format and reachability
- **VAL-004**: Audio device settings SHALL validate against available system devices
- **VAL-005**: Azure region settings SHALL be validated against supported regions

### Change Handling Requirements

- **CHG-001**: Configuration changes SHALL trigger appropriate service reinitialization
- **CHG-002**: Hot-reload SHALL be supported for non-critical settings
- **CHG-003**: Critical setting changes SHALL require session restart with user notification
- **CHG-004**: Change handlers SHALL implement error recovery and rollback

### Performance Constraints

- **CON-001**: Configuration loading MUST complete within 1 second
- **CON-002**: Configuration validation MUST not block extension activation
- **CON-003**: Change notifications MUST not cause UI freezing
- **CON-004**: Settings access MUST be cached for repeated reads

### Architecture Guidelines

- **GUD-001**: Use reactive configuration pattern with change observers
- **GUD-002**: Implement lazy validation for expensive checks (network connectivity)
- **GUD-003**: Provide configuration migration support for version upgrades
- **GUD-004**: Separate configuration access from validation logic

### Implementation Patterns

- **PAT-001**: Use typed configuration interfaces for compile-time safety
- **PAT-002**: Implement configuration sections as separate classes
- **PAT-003**: Use VS Code's onDidChangeConfiguration API for reactivity
- **PAT-004**: Cache frequently accessed configuration values

## 4. Interfaces & Data Contracts

### Configuration Schema (package.json contribution)

```json
{
  "contributes": {
    "configuration": {
      "title": "VoicePilot",
      "properties": {
        "voicepilot.azureOpenAI.endpoint": {
          "type": "string",
          "default": "",
          "description": "Azure OpenAI resource endpoint URL",
          "format": "uri",
          "pattern": "^https://.*\\.openai\\.azure\\.com/?$"
        },
        "voicepilot.azureOpenAI.deploymentName": {
          "type": "string",
          "default": "gpt-4o-realtime-preview",
          "description": "Azure OpenAI Realtime model deployment name"
        },
        "voicepilot.azureOpenAI.region": {
          "type": "string",
          "default": "eastus2",
          "enum": ["eastus2", "swedencentral"],
          "description": "Azure region for OpenAI service"
        },
        "voicepilot.azureOpenAI.endpoint": {
          "type": "string",
          "default": "",
          "description": "Azure OpenAI resource endpoint URL",
          "format": "uri",
          "pattern": "^https://.*\\.openai\\.azure\\.com/?$"
        },
        "voicepilot.azureOpenAI.deploymentName": {
          "type": "string",
          "default": "gpt-4o-realtime-preview",
          "description": "Azure OpenAI Realtime model deployment name"
        },
        "voicepilot.audio.inputDevice": {
          "type": "string",
          "default": "default",
          "description": "Preferred microphone device ID"
        },
        "voicepilot.audio.outputDevice": {
          "type": "string",
          "default": "default",
          "description": "Preferred speaker device ID"
        },
        "voicepilot.audio.noiseReduction": {
          "type": "boolean",
          "default": true,
          "description": "Enable noise reduction for microphone input"
        },
        "voicepilot.audio.echoCancellation": {
          "type": "boolean",
          "default": true,
          "description": "Enable echo cancellation"
        },
        "voicepilot.audio.sampleRate": {
          "type": "number",
          "default": 24000,
          "enum": [16000, 24000, 48000],
          "description": "Audio sample rate in Hz"
        },
        "voicepilot.commands.wakeWord": {
          "type": "string",
          "default": "voicepilot",
          "description": "Wake word for voice activation"
        },
        "voicepilot.commands.sensitivity": {
          "type": "number",
          "default": 0.7,
          "minimum": 0.1,
          "maximum": 1.0,
          "description": "Voice detection sensitivity (0.1-1.0)"
        },
        "voicepilot.commands.timeout": {
          "type": "number",
          "default": 30,
          "minimum": 5,
          "maximum": 300,
          "description": "Command timeout in seconds"
        },
        "voicepilot.github.repository": {
          "type": "string",
          "default": "",
          "description": "GitHub repository in owner/repo format"
        },
        "voicepilot.github.authMode": {
          "type": "string",
          "default": "auto",
          "enum": ["auto", "token", "oauth"],
          "description": "GitHub authentication method"
        }
      }
    }
  }
}
```

### Configuration Manager Interface

```typescript
interface ConfigurationManager extends ServiceInitializable {
  // Configuration access
  getAzureOpenAIConfig(): AzureOpenAIConfig;
  getAudioConfig(): AudioConfig;
  getCommandsConfig(): CommandsConfig;
  getGitHubConfig(): GitHubConfig;

  // Validation
  validateConfiguration(): Promise<ValidationResult>;
  validateSection<T>(section: string, config: T): ValidationResult;

  // Change handling
  onConfigurationChanged(handler: ConfigurationChangeHandler): vscode.Disposable;

  // Diagnostics
  getDiagnostics(): ConfigurationDiagnostic[];
}

interface ConfigurationChangeHandler {
  (change: ConfigurationChange): Promise<void>;
}

interface ConfigurationChange {
  section: string;
  key: string;
  oldValue: any;
  newValue: any;
  affectedServices: string[];
}

interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  path: string;
  message: string;
  code: string;
  severity: 'error' | 'warning';
  remediation?: string;
}
```

### Configuration Section Interfaces

```typescript
interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region: 'eastus2' | 'swedencentral';
  apiKey?: string; // From secret storage
}

interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region?: string;
  apiKey?: string; // From secret storage
}

interface AudioConfig {
  inputDevice: string;
  outputDevice: string;
  noiseReduction: boolean;
  echoCancellation: boolean;
  sampleRate: 16000 | 24000 | 48000;
}

interface CommandsConfig {
  wakeWord: string;
  sensitivity: number;
  timeout: number;
}

interface GitHubConfig {
  repository: string;
  authMode: 'auto' | 'token' | 'oauth';
}
```

## 5. Acceptance Criteria

- **AC-001**: Given VS Code starts, When extension activates, Then configuration loads and validates within 1 second
- **AC-002**: Given invalid Azure endpoint, When validation runs, Then clear error message with remediation appears
- **AC-003**: Given user changes audio device, When configuration updates, Then audio services reinitialize without session restart
- **AC-004**: Given user changes Azure endpoint, When configuration updates, Then user is prompted to restart conversation session
- **AC-005**: Given configuration has validation errors, When accessed, Then defaults are used and errors are logged
- **AC-006**: Given workspace settings override user settings, When configuration loads, Then workspace values take precedence
- **AC-007**: Given API key is missing, When Azure services initialize, Then helpful error guides user to settings
- **AC-008**: Given configuration changes, When services are affected, Then only relevant services reinitialize

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for validation logic, Integration tests for VS Code configuration API, End-to-End tests for configuration workflows
- **Frameworks**: VS Code Extension Test Runner with mocked configuration API, Jest for unit testing validation logic
- **Test Data Management**: Mock VS Code workspace with various configuration scenarios, test configurations for each validation rule
- **CI/CD Integration**: Automated configuration validation tests in GitHub Actions
- **Coverage Requirements**: 95% code coverage for configuration validation, 100% coverage for configuration change handlers
- **Performance Testing**: Configuration loading benchmarks, change notification latency measurement

## 7. Rationale & Context

The configuration design prioritizes:

1. **User Experience**: Clear settings organization with helpful descriptions and validation errors
2. **Security**: Strict separation of configuration data from credentials using VS Code secret storage
3. **Performance**: Cached access patterns and lazy validation for expensive operations
4. **Maintainability**: Typed interfaces and reactive patterns for reliable configuration management
5. **Extensibility**: Section-based organization supports future configuration additions

The reactive configuration pattern ensures services automatically adapt to setting changes without requiring manual coordination.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Configuration API - Required for settings persistence and change notifications
- **PLT-002**: VS Code Secret Storage API - Required for secure credential management
- **PLT-003**: VS Code Workspace API - Required for workspace-specific configuration access

### Extension Host Dependencies

- **EXT-001**: Extension Context - Required for configuration scoping and secret storage access
- **EXT-002**: Configuration Change Events - Required for reactive configuration updates

### Service Integration Dependencies

- **SVC-001**: Azure OpenAI Service - Configuration for endpoints, deployment names, and regions
- **SVC-002**: Azure Speech Service - Configuration for regions, voices, and API access
- **SVC-003**: Audio System Services - Configuration for device selection and processing parameters
- **SVC-004**: GitHub API Integration - Configuration for repository access and authentication

### Validation Dependencies

- **VAL-001**: Network Connectivity - Required for endpoint reachability validation
- **VAL-002**: Audio Device Enumeration - Required for device availability validation
- **VAL-003**: Azure Region Validation - Required for service availability checks

### Security Dependencies

- **SEC-001**: VS Code Secret Storage - Secure credential persistence and retrieval
- **SEC-002**: Configuration Schema Validation - JSON schema enforcement for type safety

## 9. Examples & Edge Cases

### Basic Configuration Access

```typescript
class ConfigurationManager implements ServiceInitializable {
  private configCache = new Map<string, any>();
  private changeHandlers: ConfigurationChangeHandler[] = [];

  async initialize(): Promise<void> {
    // Load and validate configuration
    const result = await this.validateConfiguration();
    if (!result.isValid) {
      this.logger.warn('Configuration validation failed', result.errors);
    }

    // Setup change listener
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('voicepilot')) {
        this.handleConfigurationChange(e);
      }
    });
  }

  getAzureOpenAIConfig(): AzureOpenAIConfig {
    const config = vscode.workspace.getConfiguration('voicepilot.azureOpenAI');
    return {
      endpoint: config.get('endpoint', ''),
      deploymentName: config.get('deploymentName', 'gpt-4o-realtime-preview'),
      region: config.get('region', 'eastus2') as 'eastus2' | 'swedencentral'
    };
  }
}
```

### Configuration Validation Example

```typescript
async validateConfiguration(): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Validate Azure OpenAI configuration
  const azureConfig = this.getAzureOpenAIConfig();
  if (!azureConfig.endpoint) {
    errors.push({
      path: 'voicepilot.azureOpenAI.endpoint',
      message: 'Azure OpenAI endpoint is required',
      code: 'MISSING_ENDPOINT',
      severity: 'error',
      remediation: 'Set your Azure OpenAI resource endpoint in settings'
    });
  } else if (!this.isValidAzureEndpoint(azureConfig.endpoint)) {
    errors.push({
      path: 'voicepilot.azureOpenAI.endpoint',
      message: 'Invalid Azure OpenAI endpoint format',
      code: 'INVALID_ENDPOINT_FORMAT',
      severity: 'error',
      remediation: 'Endpoint must be in format: https://your-resource.openai.azure.com'
    });
  }

  return { isValid: errors.length === 0, errors, warnings };
}
```

### Edge Case: Configuration Change During Active Session

```typescript
private async handleConfigurationChange(e: vscode.ConfigurationChangeEvent): Promise<void> {
  const affectedSections = this.getAffectedSections(e);

  for (const section of affectedSections) {
    switch (section) {
      case 'azureOpenAI':
        // Critical change - requires session restart
        if (this.sessionManager.hasActiveSession()) {
          const action = await vscode.window.showWarningMessage(
            'Azure OpenAI configuration changed. Session restart required.',
            'Restart Now', 'Continue'
          );
          if (action === 'Restart Now') {
            await this.sessionManager.restartSession();
          }
        }
        break;

      case 'audio':
        // Hot-reload audio settings
        await this.audioService.reloadConfiguration();
        break;
    }
  }
}
```

### Edge Case: Missing Secret Storage

```typescript
async getSecretValue(key: string): Promise<string | undefined> {
  try {
    return await this.context.secrets.get(key);
  } catch (error) {
    this.logger.error('Failed to access secret storage', { key, error });

    // Graceful degradation
    vscode.window.showErrorMessage(
      `Unable to access stored ${key}. Please reconfigure in settings.`,
      'Open Settings'
    ).then(action => {
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:voicepilot');
      }
    });

    return undefined;
  }
}
```

## 10. Validation Criteria

- Configuration schema validates correctly in VS Code settings editor
- All settings have appropriate defaults and clear descriptions
- Validation errors provide actionable remediation steps
- Configuration changes trigger appropriate service updates
- Performance requirements met for configuration loading and access
- Secret storage integration functions correctly
- Change notifications work without UI blocking
- Migration support works for configuration schema updates

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](spec-architecture-extension-lifecycle.md)
- [SP-003: Secret Storage & Credential Handling](spec-security-secret-storage.md)
- [SP-034: Key Vault Integration & Secret Sync](spec-design-key-vault-integration.md)
- [SP-042: Configuration Validation & Diagnostics](spec-tool-diagnostics-command.md)
- [SP-043: Settings Panel UI & Persistence](spec-design-settings-panel.md)
- [VS Code Configuration API Documentation](https://code.visualstudio.com/api/references/contribution-points#contributes.configuration)
- [VS Code Secret Storage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)

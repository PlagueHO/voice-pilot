import * as vscode from "vscode";
import { Logger } from "../core/logger";
import {
  CredentialInfo,
  CredentialManager,
  CredentialType,
  CredentialValidationResult,
  HealthCheckResult,
} from "../types/credentials";
import { LEGACY_KEYS, SECRET_KEYS } from "./constants";
import { CredentialValidatorImpl } from "./validators/credential-validator";

/**
 * Implementation of secure credential management using VS Code Secret Storage
 */
export class CredentialManagerImpl implements CredentialManager {
  private initialized = false;
  private context!: vscode.ExtensionContext;
  private logger!: Logger;
  private validator!: CredentialValidatorImpl;

  constructor(context?: vscode.ExtensionContext, logger?: Logger) {
    if (context) {
      this.context = context;
    }
    if (logger) {
      this.logger = logger;
      this.validator = new CredentialValidatorImpl(logger);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.context) {
      throw new Error(
        "Extension context is required for CredentialManager initialization",
      );
    }

    if (!this.logger) {
      this.logger = new Logger("CredentialManager");
      this.validator = new CredentialValidatorImpl(this.logger);
    }

    // Test secret storage accessibility
    const healthCheck = await this.testCredentialAccess();
    if (!healthCheck.secretStorageAvailable) {
      const errorMsg =
        "Secret storage unavailable: " + healthCheck.errors.join(", ");
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Perform credential migration if needed
    await this.migrateCredentials();

    this.initialized = true;
    this.logger.info("CredentialManager initialized successfully");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    // Clear any cached sensitive data from memory
    this.initialized = false;
    this.logger.info("CredentialManager disposed");
  }

  // Azure OpenAI credential operations
  async storeAzureOpenAIKey(key: string): Promise<void> {
    this.ensureInitialized();

    // Validate key format before storage
    const validation = await this.validator.validateAzureOpenAIKey(key);
    if (!validation.isValid) {
      const error = validation.errors[0];
      this.logger.error("Invalid Azure OpenAI key format", {
        code: error.code,
      });
      throw new Error(`Invalid Azure OpenAI key: ${error.message}`);
    }

    try {
      await this.context.secrets.store(SECRET_KEYS.AZURE_OPENAI_API_KEY, key);
      this.logger.info("Azure OpenAI key stored successfully");
    } catch (error: any) {
      this.logger.error("Failed to store Azure OpenAI key", {
        error: error.message,
      });
      throw new Error("Failed to store credential securely");
    }
  }

  async getAzureOpenAIKey(): Promise<string | undefined> {
    this.ensureInitialized();

    try {
      const key = await this.context.secrets.get(
        SECRET_KEYS.AZURE_OPENAI_API_KEY,
      );
      if (key) {
        this.logger.debug("Azure OpenAI key retrieved");
      }
      return key;
    } catch (error: any) {
      this.logger.error("Failed to retrieve Azure OpenAI key", {
        error: error.message,
      });
      return undefined;
    }
  }

  async clearAzureOpenAIKey(): Promise<void> {
    this.ensureInitialized();

    try {
      await this.context.secrets.delete(SECRET_KEYS.AZURE_OPENAI_API_KEY);
      this.logger.info("Azure OpenAI key cleared successfully");
    } catch (error: any) {
      this.logger.error("Failed to clear Azure OpenAI key", {
        error: error.message,
      });
      throw new Error("Failed to clear credential");
    }
  }

  // Azure Speech credential operations
  // Azure Speech credential operations removed: using Azure OpenAI Realtime
  // model and keyless authentication via @azure/identity instead.

  // GitHub credential operations
  async storeGitHubToken(token: string): Promise<void> {
    this.ensureInitialized();

    // Validate token format before storage
    const validation = await this.validator.validateGitHubToken(token);
    if (!validation.isValid) {
      const error = validation.errors[0];
      this.logger.error("Invalid GitHub token format", { code: error.code });
      throw new Error(`Invalid GitHub token: ${error.message}`);
    }

    try {
      await this.context.secrets.store(
        SECRET_KEYS.GITHUB_PERSONAL_TOKEN,
        token,
      );
      this.logger.info("GitHub token stored successfully");
    } catch (error: any) {
      this.logger.error("Failed to store GitHub token", {
        error: error.message,
      });
      throw new Error("Failed to store credential securely");
    }
  }

  async getGitHubToken(): Promise<string | undefined> {
    this.ensureInitialized();

    try {
      const token = await this.context.secrets.get(
        SECRET_KEYS.GITHUB_PERSONAL_TOKEN,
      );
      if (token) {
        this.logger.debug("GitHub token retrieved");
      }
      return token;
    } catch (error: any) {
      this.logger.error("Failed to retrieve GitHub token", {
        error: error.message,
      });
      return undefined;
    }
  }

  async clearGitHubToken(): Promise<void> {
    this.ensureInitialized();

    try {
      await this.context.secrets.delete(SECRET_KEYS.GITHUB_PERSONAL_TOKEN);
      this.logger.info("GitHub token cleared successfully");
    } catch (error: any) {
      this.logger.error("Failed to clear GitHub token", {
        error: error.message,
      });
      throw new Error("Failed to clear credential");
    }
  }

  // Lifecycle management
  async validateCredential(
    type: CredentialType,
    value: string,
  ): Promise<CredentialValidationResult> {
    this.ensureInitialized();

    switch (type) {
      case CredentialType.AzureOpenAI:
        return this.validator.validateAzureOpenAIKey(value);
      case CredentialType.GitHub:
        return this.validator.validateGitHubToken(value);
      default:
        throw new Error(`Unsupported credential type: ${type}`);
    }
  }

  async listStoredCredentials(): Promise<CredentialInfo[]> {
    this.ensureInitialized();

    const credentials: CredentialInfo[] = [];

    // Check each credential type
    const credentialChecks = [
      {
        type: CredentialType.AzureOpenAI,
        key: SECRET_KEYS.AZURE_OPENAI_API_KEY,
      },
      { type: CredentialType.GitHub, key: SECRET_KEYS.GITHUB_PERSONAL_TOKEN },
    ];

    for (const { type, key } of credentialChecks) {
      try {
        const value = await this.context.secrets.get(key);
        const isPresent = !!value;

        let isValid: boolean | undefined;
        if (isPresent && value) {
          const validation = await this.validateCredential(type, value);
          isValid = validation.isValid;
        }

        credentials.push({
          type,
          keyName: key,
          isPresent,
          isValid,
        });
      } catch (error: any) {
        this.logger.warn(`Failed to check credential ${type}`, {
          error: error.message,
        });
        credentials.push({
          type,
          keyName: key,
          isPresent: false,
          isValid: false,
        });
      }
    }

    return credentials;
  }

  async clearAllCredentials(): Promise<void> {
    this.ensureInitialized();

    const errors: string[] = [];

    // Clear all known credentials
    const clearOperations = [
      { name: "Azure OpenAI", operation: () => this.clearAzureOpenAIKey() },
      { name: "GitHub", operation: () => this.clearGitHubToken() },
    ];

    for (const { name, operation } of clearOperations) {
      try {
        await operation();
      } catch (error: any) {
        errors.push(`Failed to clear ${name}: ${error.message}`);
      }
    }

    if (errors.length > 0) {
      this.logger.error("Some credentials could not be cleared", { errors });
      throw new Error(`Failed to clear some credentials: ${errors.join(", ")}`);
    }

    this.logger.info("All credentials cleared successfully");
  }

  async testCredentialAccess(): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      secretStorageAvailable: false,
      credentialsAccessible: false,
      errors: [],
    };

    try {
      // Test basic secret storage functionality
      const testKey = "agentvoice.test.access";
      const testValue = "test-value";

      await this.context.secrets.store(testKey, testValue);
      const retrieved = await this.context.secrets.get(testKey);
      await this.context.secrets.delete(testKey);

      if (retrieved === testValue) {
        result.secretStorageAvailable = true;
        result.credentialsAccessible = true;
      } else {
        result.errors.push("Secret storage test failed: value mismatch");
      }
    } catch (error: any) {
      result.errors.push(`Secret storage error: ${error.message}`);

      // Provide user guidance based on error type
      if (error.message.includes("keychain")) {
        result.errors.push(
          "macOS Keychain access denied. Check system preferences.",
        );
      } else if (error.message.includes("credential manager")) {
        result.errors.push(
          "Windows Credential Manager unavailable. Check system services.",
        );
      } else if (error.message.includes("libsecret")) {
        result.errors.push(
          "Linux credential storage unavailable. Install gnome-keyring or equivalent.",
        );
      }
    }

    return result;
  }

  async migrateCredentials(): Promise<void> {
    this.logger.debug("Starting credential migration check");

    // Handle migration from old credential format to new format
    const legacyMigrations = [
      {
        legacyKey: LEGACY_KEYS.AZURE_OLD,
        migrationAction: (value: string) => this.storeAzureOpenAIKey(value),
        name: "Azure OpenAI",
      },
      {
        legacyKey: LEGACY_KEYS.GITHUB_OLD,
        migrationAction: (value: string) => this.storeGitHubToken(value),
        name: "GitHub",
      },
    ];

    for (const { legacyKey, migrationAction, name } of legacyMigrations) {
      try {
        const value = await this.context.secrets.get(legacyKey);
        if (value) {
          this.logger.info(`Migrating ${name} credential from legacy format`);

          // Migrate to new key format
          await migrationAction(value);

          // Remove legacy key
          await this.context.secrets.delete(legacyKey);
          this.logger.info(`Successfully migrated ${name} credential`, {
            from: legacyKey,
          });
        }
      } catch (error: any) {
        this.logger.warn(`Failed to migrate ${name} credential`, {
          key: legacyKey,
          error: error.message,
        });
      }
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "CredentialManager not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Handle credential errors with user-friendly guidance
   */
  async handleCredentialError(
    error: Error,
    credentialType: CredentialType,
  ): Promise<void> {
    let userMessage: string;
    let actionButton: string | undefined;

    switch (credentialType) {
      case CredentialType.AzureOpenAI:
        userMessage =
          "Azure OpenAI credentials are required but not configured.";
        actionButton = "Configure Azure Credentials";
        break;
      case CredentialType.GitHub:
        userMessage =
          "GitHub access token is required for repository operations.";
        actionButton = "Configure GitHub Token";
        break;
      default:
        userMessage = "Required credentials are missing or invalid.";
        actionButton = "Open Settings";
    }

    const action = await vscode.window.showErrorMessage(
      userMessage,
      actionButton,
      "Help",
    );

    if (action === actionButton) {
      // Open appropriate configuration UI
      vscode.commands.executeCommand(
        "agentvoice.openCredentialSettings",
        credentialType,
      );
    } else if (action === "Help") {
      // Open documentation
      vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/PlagueHO/agent-voice/docs/setup"),
      );
    }
  }
}

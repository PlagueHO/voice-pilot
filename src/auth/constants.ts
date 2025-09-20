/**
 * Secret storage key schema with namespaced identifiers
 */
export interface SecretKeySchema {
  // Azure service keys
  AZURE_OPENAI_API_KEY: 'voicepilot.azure-openai.apikey';
  AZURE_SPEECH_API_KEY: 'voicepilot.azure-speech.apikey';

  // GitHub authentication
  GITHUB_PERSONAL_TOKEN: 'voicepilot.github.token';

  // Future extensibility
  [key: string]: string;
}

/**
 * Const implementation for type safety and consistency
 */
export const SECRET_KEYS: SecretKeySchema = {
  AZURE_OPENAI_API_KEY: 'voicepilot.azure-openai.apikey',
  AZURE_SPEECH_API_KEY: 'voicepilot.azure-speech.apikey',
  GITHUB_PERSONAL_TOKEN: 'voicepilot.github.token'
} as const;

/**
 * Legacy credential keys for migration purposes
 */
export const LEGACY_KEYS = {
  AZURE_OLD: 'voicepilot.azure.key',
  GITHUB_OLD: 'voicepilot.github.pat'
} as const;

/**
 * Validation timeout constants
 */
export const VALIDATION_TIMEOUTS = {
  NETWORK_VALIDATION_MS: 5000,
  CREDENTIAL_RETRIEVAL_MS: 2000
} as const;

/**
 * Validation endpoints for credential testing
 */
export const VALIDATION_ENDPOINTS = {
  AZURE_OPENAI: 'https://api.openai.azure.com/openai/deployments',
  AZURE_SPEECH: 'https://eastus.tts.speech.microsoft.com/cognitiveservices/voices/list',
  GITHUB_API: 'https://api.github.com/user'
} as const;

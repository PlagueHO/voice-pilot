export interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region: 'eastus2' | 'swedencentral';
  apiVersion?: string; // Default: "2025-04-01-preview"
  apiKey?: string; // secret storage
}

export interface AudioConfig {
  inputDevice: string;
  outputDevice: string;
  noiseReduction: boolean;
  echoCancellation: boolean;
  sampleRate: 16000 | 24000 | 48000;
}

export interface CommandsConfig {
  wakeWord: string;
  sensitivity: number; // 0.1 - 1.0
  timeout: number; // seconds
}

export interface GitHubConfig {
  repository: string; // owner/repo
  authMode: 'auto' | 'token' | 'oauth';
}

export interface ValidationWarning { path: string; message: string; code: string; remediation?: string; }
export interface ValidationError { path: string; message: string; code: string; severity: 'error' | 'warning'; remediation?: string; }
export interface ValidationResult { isValid: boolean; errors: ValidationError[]; warnings: ValidationWarning[]; }

export interface ConfigurationChange {
  section: string;
  key: string;
  oldValue: any;
  newValue: any;
  affectedServices: string[]; // semantic identifiers consumed by controller/services
}
export interface ConfigurationChangeHandler { (change: ConfigurationChange): Promise<void>; }

export interface ConfigurationAccessors { getAzureOpenAI(): AzureOpenAIConfig; getAudio(): AudioConfig; getCommands(): CommandsConfig; getGitHub(): GitHubConfig; }

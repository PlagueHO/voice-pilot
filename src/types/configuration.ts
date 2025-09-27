import type { PrivacyPolicyConfig } from "./privacy";

export interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region: "eastus2" | "swedencentral";
  apiVersion?: string; // Default: "2025-04-01-preview"
  apiKey?: string; // secret storage
}

export interface AzureRealtimeConfig {
  model: string;
  apiVersion: string;
  transcriptionModel: string;
  inputAudioFormat: "pcm16" | "pcm24" | "pcm32";
  locale: string;
  profanityFilter: "none" | "medium" | "high";
  interimDebounceMs: number;
  maxTranscriptHistorySeconds: number;
}

export interface AudioConfig {
  inputDevice: string;
  outputDevice: string;
  noiseReduction: boolean;
  echoCancellation: boolean;
  sampleRate: 16000 | 24000 | 48000;
  turnDetection: TurnDetectionConfig;
  tts: TtsConfig;
}

export interface TtsConfig {
  transport: "webrtc" | "websocket";
  apiVersion: string;
  fallbackMode: "text-only" | "retry";
  maxInitialLatencyMs: number;
  voice: {
    name: string;
    locale: string;
    style?: string;
    gender?: "female" | "male" | "unspecified";
    providerVoiceId?: string;
    description?: string;
  };
}

export interface TurnDetectionConfig {
  type: "none" | "server_vad" | "semantic_vad";
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
  createResponse?: boolean;
  interruptResponse?: boolean;
  eagerness?: "low" | "auto" | "high";
}

export interface CommandsConfig {
  wakeWord: string;
  sensitivity: number; // 0.1 - 1.0
  timeout: number; // seconds
}

export interface GitHubConfig {
  repository: string; // owner/repo
  authMode: "auto" | "token" | "oauth";
}

export interface ConversationConfig {
  policyProfile: "default" | "assertive" | "hands-free" | "custom";
  interruptionBudgetMs: number;
  completionGraceMs: number;
  speechStopDebounceMs: number;
  allowBargeIn: boolean;
  fallbackMode: "manual" | "hybrid";
}

export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
  remediation?: string;
}
export interface ValidationError {
  path: string;
  message: string;
  code: string;
  severity: "error" | "warning";
  remediation?: string;
}
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ConfigurationChange {
  section: string;
  key: string;
  oldValue: any;
  newValue: any;
  affectedServices: string[]; // semantic identifiers consumed by controller/services
}
export interface ConfigurationChangeHandler {
  (change: ConfigurationChange): Promise<void>;
}

export interface ConfigurationAccessors {
  getAzureOpenAI(): AzureOpenAIConfig;
  getAzureRealtime(): AzureRealtimeConfig;
  getAudio(): AudioConfig;
  getCommands(): CommandsConfig;
  getGitHub(): GitHubConfig;
  getConversation(): ConversationConfig;
  getPrivacyPolicy(): PrivacyPolicyConfig;
}

export type { PrivacyPolicyConfig } from "./privacy";

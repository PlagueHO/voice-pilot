import type { AudioFeedbackConfig } from "./audio-feedback";
import type { PrivacyPolicyConfig } from "./privacy";

/**
 * Connection settings for Azure OpenAI text and planning workloads.
 * @remarks
 * Values originate from VS Code configuration and secrets storage; validation is handled by configuration services.
 */
export interface AzureOpenAIConfig {
  /** Base endpoint URL for the Azure OpenAI resource. */
  endpoint: string;
  /** Deployment name that maps to the targeted Azure OpenAI model. */
  deploymentName: string;
  /** Geographic region the Azure OpenAI resource is provisioned in. */
  region: "eastus2" | "swedencentral";
  /** Optional API version override; defaults to 2025-04-01-preview when omitted. */
  apiVersion?: string;
  /** Optional API key retrieved from secret storage for key-based auth flows. */
  apiKey?: string;
}

/**
 * Configuration contract for Azure OpenAI Realtime (audio) sessions.
 */
export interface AzureRealtimeConfig {
  /** Default model identifier used for realtime conversations. */
  model: string;
  /** API version applied when negotiating realtime sessions. */
  apiVersion: string;
  /** Secondary model used for transcription fallbacks or hybrid flows. */
  transcriptionModel: string;
  /** PCM audio format for microphone capture sent to Azure. */
  inputAudioFormat: "pcm16" | "pcm24" | "pcm32";
  /** BCP-47 locale for speech recognition and synthesis. */
  locale: string;
  /** Profanity filtering level applied to transcripts. */
  profanityFilter: "none" | "medium" | "high";
  /** Debounce window for interim transcript updates, in milliseconds. */
  interimDebounceMs: number;
  /** Maximum number of seconds to retain transcript history for context. */
  maxTranscriptHistorySeconds: number;
}

/**
 * Audio device and processing preferences mapped to the host environment.
 */
export interface AudioConfig {
  /** User-selected microphone device identifier. */
  inputDevice: string;
  /** Output device identifier used for synthesized playback. */
  outputDevice: string;
  /** Enables software noise suppression where available. */
  noiseReduction: boolean;
  /** Enables acoustic echo cancellation when supported by the stack. */
  echoCancellation: boolean;
  /** PCM sampling rate negotiated with the audio capture pipeline. */
  sampleRate: 16000 | 24000 | 48000;
  /** Optional shared AudioContext preferences for the capture/playback pipeline. */
  sharedContext?: {
    /** Automatically resume the shared AudioContext when voice sessions activate. */
    autoResume: boolean;
    /** Require an explicit user gesture before resuming the shared AudioContext. */
    requireGesture: boolean;
    /** Latency hint forwarded to the AudioContext constructor. */
    latencyHint?: AudioContextLatencyCategory | number;
  };
  /** AudioWorklet module URLs to preload into the shared AudioContext. */
  workletModules?: ReadonlyArray<string>;
  /** Voice activity detection tuning for turn awareness. */
  turnDetection: TurnDetectionConfig;
  /** Text-to-speech transport and persona configuration. */
  tts: TtsConfig;
}

/**
 * Text-to-speech transport, latency, and persona definition.
 */
export interface TtsConfig {
  /** Preferred transport for realtime TTS streaming. */
  transport: "webrtc" | "websocket";
  /** API version to request for TTS calls. */
  apiVersion: string;
  /** Strategy when audio is unavailable or delayed. */
  fallbackMode: "text-only" | "retry";
  /** Maximum tolerated latency for the first audio packet, in milliseconds. */
  maxInitialLatencyMs: number;
  /** Voice persona metadata applied to generated speech. */
  voice: {
    /** Voice display name. */
    name: string;
    /** Locale identifier that matches the speaking style. */
    locale: string;
    /** Optional speaking style, e.g., "conversational". */
    style?: string;
    /** Preferred gender presentation for the voice. */
    gender?: "female" | "male" | "unspecified";
    /** Provider-specific voice identifier, when distinct from {@link TtsConfig.voice.name}. */
    providerVoiceId?: string;
    /** Optional descriptive text for UI hints. */
    description?: string;
  };
}

/**
 * Tunable parameters that govern how voice turns are detected and managed.
 */
export interface TurnDetectionConfig {
  /** Detection strategy used to infer turn boundaries. */
  type: "none" | "server_vad" | "semantic_vad";
  /** Optional VAD threshold or confidence score requirement. */
  threshold?: number;
  /** Lead-in padding retained before a detected speech segment, in ms. */
  prefixPaddingMs?: number;
  /** Required silence tail for end-of-turn detection, in ms. */
  silenceDurationMs?: number;
  /** Enables automatic response creation once a turn is detected. */
  createResponse?: boolean;
  /** Enables interruption of active responses when new speech is detected. */
  interruptResponse?: boolean;
  /** Aggressiveness used by semantic VAD policies. */
  eagerness?: "low" | "auto" | "high";
}

/**
 * Wake word and spoken command recognition settings.
 */
export interface CommandsConfig {
  /** Keyword used to awaken the assistant from idle state. */
  wakeWord: string;
  /** Sensitivity scalar between 0.1 and 1.0 for wake word detection. */
  sensitivity: number;
  /** Timeout before command sessions expire, in seconds. */
  timeout: number;
}

/**
 * GitHub integration preferences used for Copilot collaboration flows.
 */
export interface GitHubConfig {
  /** Repository slug in the format owner/repo used for contextual actions. */
  repository: string;
  /** Authentication approach selected by the user. */
  authMode: "auto" | "token" | "oauth";
}

/**
 * Conversation management parameters such as interruption budgets and fallbacks.
 */
export interface ConversationConfig {
  /** Policy profile guiding conversation tone and interaction style. */
  policyProfile: "default" | "assertive" | "hands-free" | "custom";
  /** Budget for interruptions before responses are auto-yielded, in ms. */
  interruptionBudgetMs: number;
  /** Grace period before considering a completion finished, in ms. */
  completionGraceMs: number;
  /** Debounce window for stopping speech, in ms. */
  speechStopDebounceMs: number;
  /** Allows user to barge in over agent speech when true. */
  allowBargeIn: boolean;
  /** Fallback strategy when conversation hand-off is necessary. */
  fallbackMode: "manual" | "hybrid";
}

/**
 * Non-blocking validation message relayed to the user or logging systems.
 */
export interface ValidationWarning {
  /** Configuration path that triggered the warning. */
  path: string;
  /** Human-readable warning details. */
  message: string;
  /** Project-specific identifier describing the warning category. */
  code: string;
  /** Optional remediation guidance that can be surfaced to the user. */
  remediation?: string;
}

/**
 * Blocking validation failure surfaced to prevent unsafe or unusable configurations.
 */
export interface ValidationError {
  /** Configuration path that failed validation. */
  path: string;
  /** Human-readable error details. */
  message: string;
  /** Project-specific identifier describing the error category. */
  code: string;
  /** Severity assigned to the validation failure. */
  severity: "error" | "warning";
  /** Optional remediation guidance that can be surfaced to the user. */
  remediation?: string;
}

/**
 * Aggregate result returned by configuration validators.
 */
export interface ValidationResult {
  /** Indicates whether the configuration passed validation. */
  isValid: boolean;
  /** List of blocking errors encountered. */
  errors: ValidationError[];
  /** List of non-blocking warnings encountered. */
  warnings: ValidationWarning[];
}

/**
 * Change event raised when a configuration section is updated.
 */
export interface ConfigurationChange {
  /** Logical section that was updated (e.g., azureOpenAI). */
  section: string;
  /** Specific key within the section that changed. */
  key: string;
  /** Previous value before the change was applied. */
  oldValue: any;
  /** New value after the change event. */
  newValue: any;
  /** Semantic service identifiers that should react to the change. */
  affectedServices: string[];
}

/**
 * Handler signature invoked when configuration updates occur.
 */
export interface ConfigurationChangeHandler {
  (change: ConfigurationChange): Promise<void>;
}

/**
 * Accessor map that exposes typed configuration readers.
 */
export interface ConfigurationAccessors {
  /** Retrieve the Azure OpenAI configuration snapshot. */
  getAzureOpenAI(): AzureOpenAIConfig;
  /** Retrieve the Azure realtime configuration snapshot. */
  getAzureRealtime(): AzureRealtimeConfig;
  /** Retrieve audio device and processing preferences. */
  getAudio(): AudioConfig;
  /** Retrieve audio cue playback and accessibility preferences. */
  getAudioFeedback(): AudioFeedbackConfig;
  /** Retrieve wake word command settings. */
  getCommands(): CommandsConfig;
  /** Retrieve GitHub integration settings. */
  getGitHub(): GitHubConfig;
  /** Retrieve conversation management preferences. */
  getConversation(): ConversationConfig;
  /** Retrieve the privacy policy configuration snapshot. */
  getPrivacyPolicy(): PrivacyPolicyConfig;
}

export type { AudioFeedbackConfig } from "./audio-feedback";
export type { PrivacyPolicyConfig } from "./privacy";

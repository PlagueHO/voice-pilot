import { AudioConfig, AzureOpenAIConfig, AzureRealtimeConfig, CommandsConfig, ConversationConfig, GitHubConfig, ValidationError, ValidationWarning } from '../../types/configuration';

export interface RuleContext {
  azureOpenAI: AzureOpenAIConfig;
  azureRealtime: AzureRealtimeConfig;
  audio: AudioConfig;
  commands: CommandsConfig;
  github: GitHubConfig;
  conversation: ConversationConfig;
}
export type RuleResult = { errors: ValidationError[]; warnings: ValidationWarning[] };
export type ValidationRule = (ctx: RuleContext) => RuleResult | Promise<RuleResult>;

function err(path: string, message: string, code: string, remediation?: string): ValidationError {
  return { path, message, code, severity: 'error', remediation };
}

export const endpointRule: ValidationRule = ({ azureOpenAI }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (!azureOpenAI.endpoint) {
    errors.push(err('voicepilot.azureOpenAI.endpoint','Azure OpenAI endpoint is required','MISSING_ENDPOINT','Set your Azure OpenAI resource endpoint in settings. Format: https://<resource>.openai.azure.com'));
  } else if (!/^https:\/\/.*\.openai\.azure\.com\/?$/.test(azureOpenAI.endpoint)) {
    errors.push(err('voicepilot.azureOpenAI.endpoint','Invalid Azure OpenAI endpoint format','INVALID_ENDPOINT_FORMAT','Use https://<resource>.openai.azure.com'));
  }
  return { errors, warnings };
};

export const regionRule: ValidationRule = ({ azureOpenAI }) => {
  const allowed = ['eastus2','swedencentral'];
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (!allowed.includes(azureOpenAI.region)) {
    errors.push(err('voicepilot.azureOpenAI.region','Unsupported Azure OpenAI region','UNSUPPORTED_REGION',`Choose one of: ${allowed.join(', ')}`));
  }
  return { errors, warnings };
};

export const numericRangesRule: ValidationRule = ({ commands }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (commands.sensitivity < 0.1 || commands.sensitivity > 1.0) {
    errors.push(err('voicepilot.commands.sensitivity','Sensitivity must be between 0.1 and 1.0','OUT_OF_RANGE','Adjust value into valid range'));
  }
  if (commands.timeout < 5 || commands.timeout > 300) {
    errors.push(err('voicepilot.commands.timeout','Timeout must be between 5 and 300 seconds','OUT_OF_RANGE','Adjust value into valid range'));
  }
  return { errors, warnings };
};

export const repoFormatRule: ValidationRule = ({ github }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (github.repository && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github.repository)) {
    errors.push(err('voicepilot.github.repository','Repository must be in owner/repo format','INVALID_REPO','Example: microsoft/vscode'));
  }
  return { errors, warnings };
};

export const turnDetectionRule: ValidationRule = ({ audio }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  const td = audio.turnDetection;
  if (!td) {
    errors.push(err('voicepilot.audio.turnDetection','Turn detection configuration missing','TURN_DETECTION_MISSING','Reset settings to restore defaults.'));
    return { errors, warnings };
  }
  if (typeof td.threshold === 'number' && (td.threshold < 0 || td.threshold > 1)) {
    errors.push(err('voicepilot.audio.turnDetection.threshold','Turn detection threshold must be between 0.0 and 1.0','TURN_THRESHOLD_OUT_OF_RANGE','Choose a value between 0.0 and 1.0.'));
  }
  if (typeof td.prefixPaddingMs === 'number' && td.prefixPaddingMs < 0) {
    errors.push(err('voicepilot.audio.turnDetection.prefixPaddingMs','Prefix padding must be >= 0 ms','PREFIX_PADDING_NEGATIVE','Increase prefix padding to at least 0 ms.'));
  }
  if (typeof td.silenceDurationMs === 'number' && td.silenceDurationMs < 0) {
    errors.push(err('voicepilot.audio.turnDetection.silenceDurationMs','Silence duration must be >= 0 ms','SILENCE_DURATION_NEGATIVE','Increase silence duration to at least 0 ms.'));
  }
  if (typeof td.silenceDurationMs === 'number' && td.silenceDurationMs > 5000) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.silenceDurationMs', message: 'High silence duration may delay responses', code: 'SILENCE_DURATION_HIGH', remediation: 'Consider using a value under 5000 ms' });
  }
  if (typeof td.silenceDurationMs === 'number' && td.silenceDurationMs < 150) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.silenceDurationMs', message: 'Low silence duration can cause abrupt turn endings', code: 'SILENCE_DURATION_LOW', remediation: 'Set to at least 150 ms for natural pacing.' });
  }
  if (td.type !== 'semantic_vad' && td.eagerness && td.eagerness !== 'auto') {
    warnings.push({ path: 'voicepilot.audio.turnDetection.eagerness', message: 'Eagerness applies to semantic_vad only and will be ignored in current mode', code: 'EAGERNESS_IGNORED', remediation: 'Switch mode to semantic_vad to use eagerness.' });
  }
  if (td.type === 'none' && td.createResponse) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.createResponse', message: 'Manual turn detection ignores automatic response creation', code: 'MANUAL_MODE_AUTOCREATE', remediation: 'Disable createResponse or choose a server-managed turn detection type.' });
  }
  return { errors, warnings };
};

export const azureRealtimeRule: ValidationRule = ({ azureRealtime }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (azureRealtime.interimDebounceMs < 50 || azureRealtime.interimDebounceMs > 1000) {
    warnings.push({ path: 'voicepilot.azureRealtime.interimDebounceMs', message: 'Interim debounce should be between 50ms and 1000ms for responsive transcripts', code: 'DEBOUNCE_RANGE', remediation: 'Set a value between 50 and 1000 milliseconds.' });
  }
  if (azureRealtime.maxTranscriptHistorySeconds < 30) {
    warnings.push({ path: 'voicepilot.azureRealtime.maxTranscriptHistorySeconds', message: 'Transcript history below 30 seconds may impact reconnection recovery', code: 'TRANSCRIPT_HISTORY_LOW', remediation: 'Increase to at least 30 seconds (default 120).' });
  }
  if (azureRealtime.maxTranscriptHistorySeconds > 600) {
    warnings.push({ path: 'voicepilot.azureRealtime.maxTranscriptHistorySeconds', message: 'Large transcript history (>600s) can increase memory consumption', code: 'TRANSCRIPT_HISTORY_HIGH', remediation: 'Consider keeping the cache under 600 seconds.' });
  }
  return { errors, warnings };
};

export const conversationPolicyRule: ValidationRule = ({ conversation }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  if (conversation.interruptionBudgetMs <= 0 || conversation.interruptionBudgetMs > 750) {
    errors.push(err('voicepilot.conversation.interruptionBudgetMs','Interruption budget must be between 1 and 750 ms','INTERRUPTION_BUDGET_OUT_OF_RANGE','Adjust the budget to stay within the allowed range.'));
  }
  if (conversation.completionGraceMs < 0) {
    errors.push(err('voicepilot.conversation.completionGraceMs','Completion grace must be >= 0 ms','COMPLETION_GRACE_NEGATIVE','Increase completion grace to a non-negative value.'));
  }
  if (conversation.speechStopDebounceMs < 150) {
    errors.push(err('voicepilot.conversation.speechStopDebounceMs','Speech stop debounce must be at least 150 ms','DEBOUNCE_TOO_LOW','Increase the debounce window to avoid premature assistant replies.'));
  } else if (conversation.speechStopDebounceMs > 2000) {
    warnings.push({ path: 'voicepilot.conversation.speechStopDebounceMs', message: 'High debounce may delay assistant responses', code: 'DEBOUNCE_TOO_HIGH', remediation: 'Consider using a value under 2000 ms.' });
  }
  if (conversation.fallbackMode === 'manual') {
    warnings.push({ path: 'voicepilot.conversation.fallbackMode', message: 'Manual fallback requires manual recovery when Azure VAD degrades', code: 'FALLBACK_MANUAL', remediation: 'Use hybrid fallback for automatic recovery assistance.' });
  }
  return { errors, warnings };
};

// Placeholder stub rules for future expansion
export const audioDevicesRule: ValidationRule = () => ({ errors: [], warnings: [] });
export const networkReachabilityRule: ValidationRule = () => ({ errors: [], warnings: [] });

export const allRules: ValidationRule[] = [endpointRule, regionRule, numericRangesRule, repoFormatRule, turnDetectionRule, azureRealtimeRule, conversationPolicyRule, audioDevicesRule, networkReachabilityRule];

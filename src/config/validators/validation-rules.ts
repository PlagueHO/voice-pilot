import { AudioConfig, AzureOpenAIConfig, CommandsConfig, GitHubConfig, ValidationError, ValidationWarning } from '../../types/configuration';

export interface RuleContext {
  azureOpenAI: AzureOpenAIConfig; audio: AudioConfig; commands: CommandsConfig; github: GitHubConfig;
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
  if (td.threshold < 0 || td.threshold > 1) {
    errors.push(err('voicepilot.audio.turnDetection.threshold','Turn detection threshold must be between 0.0 and 1.0','TURN_THRESHOLD_OUT_OF_RANGE','Choose a value between 0.0 and 1.0.'));
  }
  if (td.prefixPaddingMs < 0) {
    errors.push(err('voicepilot.audio.turnDetection.prefixPaddingMs','Prefix padding must be >= 0 ms','PREFIX_PADDING_NEGATIVE','Increase prefix padding to at least 0 ms.'));
  }
  if (td.silenceDurationMs < 0) {
    errors.push(err('voicepilot.audio.turnDetection.silenceDurationMs','Silence duration must be >= 0 ms','SILENCE_DURATION_NEGATIVE','Increase silence duration to at least 0 ms.'));
  }
  if (td.silenceDurationMs > 5000) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.silenceDurationMs', message: 'High silence duration may delay responses', code: 'SILENCE_DURATION_HIGH', remediation: 'Consider using a value under 5000 ms' });
  }
  if (td.silenceDurationMs < 150) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.silenceDurationMs', message: 'Low silence duration can cause abrupt turn endings', code: 'SILENCE_DURATION_LOW', remediation: 'Set to at least 150 ms for natural pacing.' });
  }
  if (td.mode !== 'semantic_vad' && td.eagerness !== 'auto') {
    warnings.push({ path: 'voicepilot.audio.turnDetection.eagerness', message: 'Eagerness applies to semantic_vad only and will be ignored in current mode', code: 'EAGERNESS_IGNORED', remediation: 'Switch mode to semantic_vad to use eagerness.' });
  }
  if (td.mode === 'manual' && td.createResponse) {
    warnings.push({ path: 'voicepilot.audio.turnDetection.createResponse', message: 'Manual mode ignores automatic response creation', code: 'MANUAL_MODE_AUTOCREATE', remediation: 'Disable createResponse or switch to server-managed mode.' });
  }
  return { errors, warnings };
};

// Placeholder stub rules for future expansion
export const audioDevicesRule: ValidationRule = () => ({ errors: [], warnings: [] });
export const networkReachabilityRule: ValidationRule = () => ({ errors: [], warnings: [] });

export const allRules: ValidationRule[] = [endpointRule, regionRule, numericRangesRule, repoFormatRule, turnDetectionRule, audioDevicesRule, networkReachabilityRule];

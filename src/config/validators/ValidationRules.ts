import { AudioConfig, AzureOpenAIConfig, AzureSpeechConfig, CommandsConfig, GitHubConfig, ValidationError, ValidationWarning } from '../../types/configuration';

export interface RuleContext {
  azureOpenAI: AzureOpenAIConfig; azureSpeech: AzureSpeechConfig; audio: AudioConfig; commands: CommandsConfig; github: GitHubConfig;
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

// Placeholder stub rules for future expansion
export const audioDevicesRule: ValidationRule = () => ({ errors: [], warnings: [] });
export const networkReachabilityRule: ValidationRule = () => ({ errors: [], warnings: [] });

export const allRules: ValidationRule[] = [endpointRule, regionRule, numericRangesRule, repoFormatRule, audioDevicesRule, networkReachabilityRule];

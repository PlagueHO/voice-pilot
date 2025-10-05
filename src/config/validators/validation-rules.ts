import { RETRY_GUARDRAILS } from '../../core/retry/retry-envelopes';
import { AudioConfig, AudioFeedbackConfig, AzureOpenAIConfig, AzureRealtimeConfig, CommandsConfig, ConversationConfig, GitHubConfig, RetryConfig, ValidationError, ValidationWarning } from '../../types/configuration';
import type { PrivacyPolicyConfig } from '../../types/privacy';

export interface RuleContext {
  azureOpenAI: AzureOpenAIConfig;
  azureRealtime: AzureRealtimeConfig;
  audio: AudioConfig;
  audioFeedback: AudioFeedbackConfig;
  commands: CommandsConfig;
  github: GitHubConfig;
  conversation: ConversationConfig;
  privacy: PrivacyPolicyConfig;
  retry: RetryConfig;
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

export const privacyRetentionRule: ValidationRule = ({ privacy }) => {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = [];
  const { retention, redactionRules, profanityFilter } = privacy;

  if (retention.audioSeconds > 5) {
    errors.push(err('voicepilot.privacyPolicy.retention.audioSeconds', 'Audio retention must be ≤ 5 seconds', 'PRIVACY_RETENTION_AUDIO_TOO_HIGH', 'Reduce audio retention to 5 seconds or less.'));
  }
  if (retention.partialTranscriptSeconds > 30) {
    errors.push(err('voicepilot.privacyPolicy.retention.partialTranscriptSeconds', 'Partial transcript retention must be ≤ 30 seconds', 'PRIVACY_RETENTION_PARTIAL_TOO_HIGH', 'Reduce partial transcript retention to 30 seconds or less.'));
  }
  if (retention.finalTranscriptSeconds > 120) {
    errors.push(err('voicepilot.privacyPolicy.retention.finalTranscriptSeconds', 'Final transcript retention must be ≤ 120 seconds', 'PRIVACY_RETENTION_FINAL_TOO_HIGH', 'Reduce final transcript retention to 120 seconds or less.'));
  }
  if (retention.audioSeconds <= 0 || retention.partialTranscriptSeconds <= 0 || retention.finalTranscriptSeconds <= 0) {
    errors.push(err('voicepilot.privacyPolicy.retention', 'Retention windows must be positive values', 'PRIVACY_RETENTION_NON_POSITIVE', 'Set each retention value to a positive number within the allowed range.'));
  }
  if (retention.diagnosticsHours > 24) {
    errors.push(err('voicepilot.privacyPolicy.retention.diagnosticsHours', 'Diagnostics retention must be ≤ 24 hours', 'PRIVACY_RETENTION_DIAGNOSTICS_TOO_HIGH', 'Reduce diagnostics retention to 24 hours or less.'));
  }
  if (retention.diagnosticsHours <= 0) {
    errors.push(err('voicepilot.privacyPolicy.retention.diagnosticsHours', 'Diagnostics retention must be positive', 'PRIVACY_RETENTION_DIAGNOSTICS_NON_POSITIVE', 'Set diagnostics retention to at least 1 hour.'));
  }

  if (!['none', 'medium', 'high'].includes(profanityFilter)) {
    errors.push(err('voicepilot.privacyPolicy.profanityFilter', 'Profanity filter must be one of none, medium, or high', 'PRIVACY_PROFANITY_INVALID', 'Choose none, medium, or high.'));
  }

  if (redactionRules.some(rule => !rule.id || !rule.pattern)) {
    warnings.push({
      path: 'voicepilot.privacyPolicy.redactionRules',
      message: 'Custom redaction rules missing ids or patterns were automatically normalized',
      code: 'PRIVACY_REDACTION_RULE_NORMALIZED',
      remediation: 'Provide unique ids and valid patterns for each custom redaction rule.'
    });
  }

  return { errors, warnings };
};

// Placeholder stub rules for future expansion
export const audioDevicesRule: ValidationRule = () => ({ errors: [], warnings: [] });
export const networkReachabilityRule: ValidationRule = () => ({ errors: [], warnings: [] });

export const audioFeedbackRule: ValidationRule = ({ audioFeedback }) => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const gains = audioFeedback.categoryGains;
  for (const [category, value] of Object.entries(gains)) {
    if (value < 0 || value > 2) {
      errors.push(
        err(
          `voicepilot.audioFeedback.volume.${category}`,
          "Audio feedback gain must be between 0.0 and 2.0",
          "AUDIO_FEEDBACK_GAIN_RANGE",
          "Adjust gain to a value between 0.0 and 2.0",
        ),
      );
    } else if (value > 1.5) {
      warnings.push({
        path: `voicepilot.audioFeedback.volume.${category}`,
        message: "High gain may cause clipping in shared audio context",
        code: "AUDIO_FEEDBACK_GAIN_HIGH",
        remediation: "Consider reducing gain below 1.5 to avoid distortion.",
      });
    }
  }

  if (audioFeedback.degradedMode.failureThreshold < 1) {
    errors.push(
      err(
        "voicepilot.audioFeedback.degradedFailureThreshold",
        "Degraded-mode failure threshold must be at least 1",
        "AUDIO_FEEDBACK_DEGRADED_THRESHOLD",
        "Set the failure threshold to a value of 1 or higher.",
      ),
    );
  }
  if (audioFeedback.degradedMode.windowMs < 1000) {
    errors.push(
      err(
        "voicepilot.audioFeedback.degradedWindowSeconds",
        "Degraded-mode window must be at least one second",
        "AUDIO_FEEDBACK_DEGRADED_WINDOW",
        "Increase the degraded mode window to at least 1 second.",
      ),
    );
  }
  if (audioFeedback.degradedMode.cooldownMs < 5000) {
    warnings.push({
      path: "voicepilot.audioFeedback.degradedCooldownSeconds",
      message: "Short cooldown may cause rapid degraded-mode oscillation",
      code: "AUDIO_FEEDBACK_DEGRADED_COOLDOWN",
      remediation: "Increase cooldown to at least 5 seconds to stabilize recovery.",
    });
  }

  return { errors, warnings };
};

export const retryGuardrailsRule: ValidationRule = ({ retry }) => {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  for (const [domain, override] of Object.entries(retry.overrides ?? {})) {
    if (!override) {
      continue;
    }
    if (
      override.maxAttempts !== undefined &&
      (override.maxAttempts < RETRY_GUARDRAILS.minAttempts ||
        override.maxAttempts > RETRY_GUARDRAILS.maxAttempts)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.maxAttempts`,
          `maxAttempts must be between ${RETRY_GUARDRAILS.minAttempts} and ${RETRY_GUARDRAILS.maxAttempts}`,
          "RETRY_MAX_ATTEMPTS_GUARD",
          "Adjust maxAttempts to fall within the allowed guardrail range.",
        ),
      );
    }
    if (
      override.initialDelayMs !== undefined &&
      (override.initialDelayMs < RETRY_GUARDRAILS.minInitialDelayMs ||
        override.initialDelayMs > RETRY_GUARDRAILS.maxInitialDelayMs)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.initialDelayMs`,
          `initialDelayMs must be between ${RETRY_GUARDRAILS.minInitialDelayMs} and ${RETRY_GUARDRAILS.maxInitialDelayMs}`,
          "RETRY_INITIAL_DELAY_GUARD",
          "Adjust the initial delay to respect retry guardrails.",
        ),
      );
    }
    if (
      override.multiplier !== undefined &&
      (override.multiplier < RETRY_GUARDRAILS.minMultiplier ||
        override.multiplier > RETRY_GUARDRAILS.maxMultiplier)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.multiplier`,
          `multiplier must be between ${RETRY_GUARDRAILS.minMultiplier} and ${RETRY_GUARDRAILS.maxMultiplier}`,
          "RETRY_MULTIPLIER_GUARD",
          "Choose a multiplier inside the guardrail range.",
        ),
      );
    }
    if (
      override.maxDelayMs !== undefined &&
      (override.maxDelayMs < RETRY_GUARDRAILS.minMaxDelayMs ||
        override.maxDelayMs > RETRY_GUARDRAILS.maxMaxDelayMs)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.maxDelayMs`,
          `maxDelayMs must be between ${RETRY_GUARDRAILS.minMaxDelayMs} and ${RETRY_GUARDRAILS.maxMaxDelayMs}`,
          "RETRY_MAX_DELAY_GUARD",
          "Set a maxDelayMs value within guardrails.",
        ),
      );
    }
    if (
      override.coolDownMs !== undefined &&
      (override.coolDownMs < RETRY_GUARDRAILS.minCoolDownMs ||
        override.coolDownMs > RETRY_GUARDRAILS.maxCoolDownMs)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.coolDownMs`,
          `coolDownMs must be between ${RETRY_GUARDRAILS.minCoolDownMs} and ${RETRY_GUARDRAILS.maxCoolDownMs}`,
          "RETRY_COOLDOWN_GUARD",
          "Adjust the circuit breaker cool-down to respect guardrails.",
        ),
      );
    }
    if (
      override.failureBudgetMs !== undefined &&
      (override.failureBudgetMs < RETRY_GUARDRAILS.minFailureBudgetMs ||
        override.failureBudgetMs > RETRY_GUARDRAILS.maxFailureBudgetMs)
    ) {
      errors.push(
        err(
          `voicepilot.retry.overrides.${domain}.failureBudgetMs`,
          `failureBudgetMs must be between ${RETRY_GUARDRAILS.minFailureBudgetMs} and ${RETRY_GUARDRAILS.maxFailureBudgetMs}`,
          "RETRY_FAILURE_BUDGET_GUARD",
          "Ensure the retry failure budget stays within guardrails.",
        ),
      );
    }
    if (override.policy === "none" && override.maxAttempts !== undefined) {
      warnings.push({
        path: `voicepilot.retry.overrides.${domain}.policy`,
        message: "Policy 'none' ignores maxAttempts overrides",
        code: "RETRY_POLICY_NONE_WARN",
        remediation: "Remove maxAttempts or choose an active retry policy.",
      });
    }
  }
  return { errors, warnings };
};

export const allRules: ValidationRule[] = [endpointRule, regionRule, numericRangesRule, repoFormatRule, turnDetectionRule, azureRealtimeRule, conversationPolicyRule, privacyRetentionRule, audioFeedbackRule, retryGuardrailsRule, audioDevicesRule, networkReachabilityRule];

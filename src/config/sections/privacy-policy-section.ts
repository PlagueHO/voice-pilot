import * as vscode from 'vscode';
import {
    clampRetentionSeconds,
    DEFAULT_PRIVACY_POLICY,
    PrivacyPolicyConfig,
    PrivacyRetentionWindowConfig,
    RedactionRule
} from '../../types/privacy';

interface StoredRedactionRule {
  id?: string;
  pattern?: string;
  flags?: string;
  replacement?: string;
  explanation?: string;
}

function sanitizeRedactionRule(rule: StoredRedactionRule, index: number): RedactionRule {
  const id = rule.id && typeof rule.id === 'string' ? rule.id : `custom-${index}`;
  const patternSource = typeof rule.pattern === 'string' ? rule.pattern : '';
  const flags = typeof rule.flags === 'string' ? rule.flags : 'g';
  let pattern: RegExp | string = patternSource;
  try {
    if (patternSource) {
      pattern = new RegExp(patternSource, flags);
    }
  } catch {
    pattern = patternSource;
  }

  return {
    id,
    pattern,
    replacement: typeof rule.replacement === 'string' ? rule.replacement : '***',
    explanation: typeof rule.explanation === 'string' ? rule.explanation : undefined
  };
}

function sanitizeRetention(retention: Partial<PrivacyRetentionWindowConfig> | undefined): PrivacyRetentionWindowConfig {
  const defaults = DEFAULT_PRIVACY_POLICY.retention;
  return {
    audioSeconds: clampRetentionSeconds(retention?.audioSeconds ?? defaults.audioSeconds, defaults.audioSeconds),
    partialTranscriptSeconds: clampRetentionSeconds(retention?.partialTranscriptSeconds ?? defaults.partialTranscriptSeconds, defaults.partialTranscriptSeconds),
    finalTranscriptSeconds: clampRetentionSeconds(retention?.finalTranscriptSeconds ?? defaults.finalTranscriptSeconds, defaults.finalTranscriptSeconds),
    diagnosticsHours: Math.min(Math.max(1, Math.round(retention?.diagnosticsHours ?? defaults.diagnosticsHours)), 24)
  };
}

export class PrivacyPolicySection {
  read(): PrivacyPolicyConfig {
    const config = vscode.workspace.getConfiguration('voicepilot.privacyPolicy');
    const retention = sanitizeRetention(config.get<Partial<PrivacyRetentionWindowConfig>>('retention'));
    const storedRules = config.get<StoredRedactionRule[]>('redactionRules', []);

    const redactionRules = storedRules.map((rule, index) => sanitizeRedactionRule(rule ?? {}, index));

    return {
      retention,
      redactionRules,
      profanityFilter: config.get('profanityFilter', DEFAULT_PRIVACY_POLICY.profanityFilter),
      telemetryOptIn: config.get('telemetryOptIn', DEFAULT_PRIVACY_POLICY.telemetryOptIn),
      exportEnabled: config.get('exportEnabled', DEFAULT_PRIVACY_POLICY.exportEnabled)
    };
  }
}

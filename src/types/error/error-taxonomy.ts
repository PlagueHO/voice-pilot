export const VOICE_PILOT_FAULT_DOMAINS = [
  'auth',
  'session',
  'transport',
  'audio',
  'ui',
  'copilot',
  'infrastructure'
] as const;

export type VoicePilotFaultDomain = typeof VOICE_PILOT_FAULT_DOMAINS[number];

export const VOICE_PILOT_SEVERITIES = ['info', 'warning', 'error', 'critical'] as const;

export type VoicePilotSeverity = typeof VOICE_PILOT_SEVERITIES[number];

export const VOICE_PILOT_USER_IMPACTS = ['transparent', 'degraded', 'blocked'] as const;

export type VoicePilotUserImpact = typeof VOICE_PILOT_USER_IMPACTS[number];

export interface TaxonomyDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

type TaxonomyMap<TKey extends string> = Record<TKey, TaxonomyDescriptor>;

export const FAULT_DOMAIN_DESCRIPTORS: TaxonomyMap<VoicePilotFaultDomain> = {
  auth: {
    id: 'auth',
    label: 'Authentication',
    description: 'Credential acquisition, token exchange, and identity provider integrations.'
  },
  session: {
    id: 'session',
    label: 'Session Lifecycle',
    description: 'Voice session state transitions, renewals, and timers.'
  },
  transport: {
    id: 'transport',
    label: 'Transport',
    description: 'WebRTC signaling, network connectivity, and realtime channels.'
  },
  audio: {
    id: 'audio',
    label: 'Audio Pipeline',
    description: 'Capture, processing, and playback subsystems.'
  },
  ui: {
    id: 'ui',
    label: 'User Interface',
    description: 'VS Code panels, status bar indicators, and notifications.'
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    description: 'Copilot Chat APIs and planning workflows.'
  },
  infrastructure: {
    id: 'infrastructure',
    label: 'Infrastructure',
    description: 'Underlying extension host, file system, or dependency infrastructure.'
  }
};

export const SEVERITY_DESCRIPTORS: TaxonomyMap<VoicePilotSeverity> = {
  info: {
    id: 'info',
    label: 'Informational',
    description: 'Diagnostic events with no user impact.'
  },
  warning: {
    id: 'warning',
    label: 'Warning',
    description: 'Recoverable issue with limited user impact.'
  },
  error: {
    id: 'error',
    label: 'Error',
    description: 'Failure requiring mitigation or degraded operation.'
  },
  critical: {
    id: 'critical',
    label: 'Critical',
    description: 'Pervasive outage or security incident requiring immediate attention.'
  }
};

export const USER_IMPACT_DESCRIPTORS: TaxonomyMap<VoicePilotUserImpact> = {
  transparent: {
    id: 'transparent',
    label: 'Transparent',
    description: 'Issue hidden from users with no perceived degradation.'
  },
  degraded: {
    id: 'degraded',
    label: 'Degraded',
    description: 'Partial loss of capability; users can continue with limitations.'
  },
  blocked: {
    id: 'blocked',
    label: 'Blocked',
    description: 'User workflows are blocked until remediation occurs.'
  }
};

export function isFaultDomain(value: string): value is VoicePilotFaultDomain {
  return (VOICE_PILOT_FAULT_DOMAINS as readonly string[]).includes(value);
}

export function isSeverity(value: string): value is VoicePilotSeverity {
  return (VOICE_PILOT_SEVERITIES as readonly string[]).includes(value);
}

export function isUserImpact(value: string): value is VoicePilotUserImpact {
  return (VOICE_PILOT_USER_IMPACTS as readonly string[]).includes(value);
}

export const DEFAULT_SEVERITY_FOR_DOMAIN: Record<VoicePilotFaultDomain, VoicePilotSeverity> = {
  auth: 'error',
  session: 'error',
  transport: 'error',
  audio: 'warning',
  ui: 'warning',
  copilot: 'warning',
  infrastructure: 'critical'
};

export const DEFAULT_USER_IMPACT_FOR_DOMAIN: Record<VoicePilotFaultDomain, VoicePilotUserImpact> = {
  auth: 'blocked',
  session: 'degraded',
  transport: 'degraded',
  audio: 'degraded',
  ui: 'transparent',
  copilot: 'degraded',
  infrastructure: 'blocked'
};

export const SEVERITY_ORDER: Record<VoicePilotSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

export function compareSeverity(left: VoicePilotSeverity, right: VoicePilotSeverity): number {
  return SEVERITY_ORDER[left] - SEVERITY_ORDER[right];
}

export function normalizeSeverity(severity?: VoicePilotSeverity): VoicePilotSeverity {
  return severity && isSeverity(severity) ? severity : 'error';
}

export function normalizeUserImpact(userImpact?: VoicePilotUserImpact): VoicePilotUserImpact {
  return userImpact && isUserImpact(userImpact) ? userImpact : 'degraded';
}

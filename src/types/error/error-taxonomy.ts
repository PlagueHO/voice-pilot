/**
 * All fault domains recognized by the Agent Voice error taxonomy.
 */
export const VOICE_PILOT_FAULT_DOMAINS = [
  "auth",
  "session",
  "transport",
  "audio",
  "ui",
  "copilot",
  "infrastructure",
] as const;

/**
 * Enumerated fault domain derived from {@link VOICE_PILOT_FAULT_DOMAINS}.
 */
export type AgentVoiceFaultDomain = (typeof VOICE_PILOT_FAULT_DOMAINS)[number];

/**
 * Severity levels surfaced to users and telemetry.
 */
export const VOICE_PILOT_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

/**
 * Enumerated severity level derived from {@link VOICE_PILOT_SEVERITIES}.
 */
export type AgentVoiceSeverity = (typeof VOICE_PILOT_SEVERITIES)[number];

/**
 * User impact levels describing perceived degradation.
 */
export const VOICE_PILOT_USER_IMPACTS = [
  "transparent",
  "degraded",
  "blocked",
] as const;

/**
 * Enumerated user impact derived from {@link VOICE_PILOT_USER_IMPACTS}.
 */
export type AgentVoiceUserImpact = (typeof VOICE_PILOT_USER_IMPACTS)[number];

/**
 * Descriptor providing human-readable taxonomy labels.
 */
export interface TaxonomyDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

type TaxonomyMap<TKey extends string> = Record<TKey, TaxonomyDescriptor>;

/**
 * Mapping of fault domains to descriptor metadata.
 */
export const FAULT_DOMAIN_DESCRIPTORS: TaxonomyMap<AgentVoiceFaultDomain> = {
  auth: {
    id: "auth",
    label: "Authentication",
    description:
      "Credential acquisition, token exchange, and identity provider integrations.",
  },
  session: {
    id: "session",
    label: "Session Lifecycle",
    description: "Voice session state transitions, renewals, and timers.",
  },
  transport: {
    id: "transport",
    label: "Transport",
    description: "WebRTC signaling, network connectivity, and realtime channels.",
  },
  audio: {
    id: "audio",
    label: "Audio Pipeline",
    description: "Capture, processing, and playback subsystems.",
  },
  ui: {
    id: "ui",
    label: "User Interface",
    description: "VS Code panels, status bar indicators, and notifications.",
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot",
    description: "Copilot Chat APIs and planning workflows.",
  },
  infrastructure: {
    id: "infrastructure",
    label: "Infrastructure",
    description:
      "Underlying extension host, file system, or dependency infrastructure.",
  },
};

/**
 * Mapping of severities to human-readable descriptors.
 */
export const SEVERITY_DESCRIPTORS: TaxonomyMap<AgentVoiceSeverity> = {
  info: {
    id: "info",
    label: "Informational",
    description: "Diagnostic events with no user impact.",
  },
  warning: {
    id: "warning",
    label: "Warning",
    description: "Recoverable issue with limited user impact.",
  },
  error: {
    id: "error",
    label: "Error",
    description: "Failure requiring mitigation or degraded operation.",
  },
  critical: {
    id: "critical",
    label: "Critical",
    description:
      "Pervasive outage or security incident requiring immediate attention.",
  },
};

/**
 * Mapping of user impact levels to descriptive metadata.
 */
export const USER_IMPACT_DESCRIPTORS: TaxonomyMap<AgentVoiceUserImpact> = {
  transparent: {
    id: "transparent",
    label: "Transparent",
    description: "Issue hidden from users with no perceived degradation.",
  },
  degraded: {
    id: "degraded",
    label: "Degraded",
    description:
      "Partial loss of capability; users can continue with limitations.",
  },
  blocked: {
    id: "blocked",
    label: "Blocked",
    description: "User workflows are blocked until remediation occurs.",
  },
};

/**
 * Type guard ensuring a string maps to a known fault domain.
 */
export function isFaultDomain(value: string): value is AgentVoiceFaultDomain {
  return (VOICE_PILOT_FAULT_DOMAINS as readonly string[]).includes(value);
}

/**
 * Type guard ensuring a string maps to a known severity.
 */
export function isSeverity(value: string): value is AgentVoiceSeverity {
  return (VOICE_PILOT_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Type guard ensuring a string maps to a known user impact level.
 */
export function isUserImpact(value: string): value is AgentVoiceUserImpact {
  return (VOICE_PILOT_USER_IMPACTS as readonly string[]).includes(value);
}

/**
 * Default severity applied when fault domains do not provide overrides.
 */
export const DEFAULT_SEVERITY_FOR_DOMAIN: Record<
  AgentVoiceFaultDomain,
  AgentVoiceSeverity
> = {
  auth: "error",
  session: "error",
  transport: "error",
  audio: "warning",
  ui: "warning",
  copilot: "warning",
  infrastructure: "critical",
};

/**
 * Default user impact applied when fault domains do not provide overrides.
 */
export const DEFAULT_USER_IMPACT_FOR_DOMAIN: Record<
  AgentVoiceFaultDomain,
  AgentVoiceUserImpact
> = {
  auth: "blocked",
  session: "degraded",
  transport: "degraded",
  audio: "degraded",
  ui: "transparent",
  copilot: "degraded",
  infrastructure: "blocked",
};

/**
 * Ordering helper used to compare severities.
 */
export const SEVERITY_ORDER: Record<AgentVoiceSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

/**
 * Compares two severities and returns a signed order value.
 */
export function compareSeverity(
  left: AgentVoiceSeverity,
  right: AgentVoiceSeverity,
): number {
  return SEVERITY_ORDER[left] - SEVERITY_ORDER[right];
}

/**
 * Normalizes severities, falling back to the default when undefined.
 */
export function normalizeSeverity(
  severity?: AgentVoiceSeverity,
): AgentVoiceSeverity {
  return severity && isSeverity(severity) ? severity : "error";
}

/**
 * Normalizes user impact, falling back to the default when undefined.
 */
export function normalizeUserImpact(
  userImpact?: AgentVoiceUserImpact,
): AgentVoiceUserImpact {
  return userImpact && isUserImpact(userImpact) ? userImpact : "degraded";
}

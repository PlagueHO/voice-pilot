import { SessionDiagnostics } from "./session";

/**
 * Presence states surfaced by VoicePilot to UI surfaces.
 */
export type VoicePilotPresenceState =
  | "idle"
  | "listening"
  | "processing"
  | "waitingForCopilot"
  | "speaking"
  | "suspended"
  | "error"
  | "offline"
  | "interrupted";

/**
 * Canonical presence states used for descriptor lookup (excludes transient states).
 */
export type CanonicalPresenceState = Exclude<
  VoicePilotPresenceState,
  "interrupted"
>;

/**
 * Severity levels attached to presence descriptors.
 */
export type PresenceSeverity = "info" | "warn" | "error";

/**
 * Supplemental details associated with a presence update.
 */
export interface PresenceDetails {
  conversationTurnId?: string;
  retry: boolean;
  renewal: boolean;
  errorCode?: string;
  tooltip?: string;
  statusMode?: string;
  statusDetail?: string;
  diagnostics?: SessionDiagnostics;
}

/**
 * Notification emitted when the presence state changes.
 */
export interface PresenceUpdate {
  state: VoicePilotPresenceState;
  sessionId?: string;
  since: string;
  copilotAvailable: boolean;
  latencyMs?: number;
  message: string;
  details: PresenceDetails;
}

/**
 * Descriptor used to drive UI and accessibility elements for each state.
 */
export interface PresenceStateDescriptor {
  state: CanonicalPresenceState;
  sidebarLabel: string;
  statusBarText: string;
  message: string;
  tooltip: string;
  ariaLabel: string;
  severity: PresenceSeverity;
  activityBarIcon: string;
  defaultDetails: {
    retry: boolean;
    renewal: boolean;
  };
}

const BASE_DESCRIPTORS: Record<
  CanonicalPresenceState,
  PresenceStateDescriptor
> = {
  idle: {
    state: "idle",
    sidebarLabel: "Hands/Eyes Free Planning",
    statusBarText: "$(mic) VoicePilot",
    message: "Hands/Eyes Free Planning",
    tooltip: "Start Conversation",
    ariaLabel: "VoicePilot ready",
    severity: "info",
    activityBarIcon: "$(mic)",
    defaultDetails: { retry: false, renewal: false },
  },
  listening: {
    state: "listening",
    sidebarLabel: "● Listening",
    statusBarText: "$(unmute) Listening…",
    message: "● Listening",
    tooltip: "VoicePilot is listening. Speak anytime.",
    ariaLabel: "VoicePilot listening",
    severity: "info",
    activityBarIcon: "$(unmute)",
    defaultDetails: { retry: false, renewal: false },
  },
  processing: {
    state: "processing",
    sidebarLabel: "⋯ Thinking",
    statusBarText: "$(sync) Processing…",
    message: "⋯ Thinking",
    tooltip: "Analyzing your request.",
    ariaLabel: "VoicePilot processing your request",
    severity: "info",
    activityBarIcon: "$(sync)",
    defaultDetails: { retry: false, renewal: false },
  },
  waitingForCopilot: {
    state: "waitingForCopilot",
    sidebarLabel: "⋯ Waiting for Copilot",
    statusBarText: "$(clock) Waiting for Copilot…",
    message: "⋯ Waiting for Copilot",
    tooltip: "Copilot is responding. You may interrupt.",
    ariaLabel: "VoicePilot waiting for Copilot response",
    severity: "warn",
    activityBarIcon: "$(clock)",
    defaultDetails: { retry: false, renewal: false },
  },
  speaking: {
    state: "speaking",
    sidebarLabel: "● Speaking",
    statusBarText: "$(megaphone) Responding…",
    message: "● Speaking",
    tooltip: "VoicePilot is responding. Speak to interrupt.",
    ariaLabel: "VoicePilot speaking",
    severity: "info",
    activityBarIcon: "$(megaphone)",
    defaultDetails: { retry: false, renewal: false },
  },
  suspended: {
    state: "suspended",
    sidebarLabel: "◌ Paused",
    statusBarText: "$(debug-pause) Suspended…",
    message: "◌ Paused",
    tooltip: "Renewing connection. This may take a moment.",
    ariaLabel: "VoicePilot suspended while renewing connection",
    severity: "warn",
    activityBarIcon: "$(debug-pause)",
    defaultDetails: { retry: false, renewal: true },
  },
  error: {
    state: "error",
    sidebarLabel: "⚠️ Attention Needed",
    statusBarText: "$(error) VoicePilot issue",
    message: "⚠️ Attention Needed",
    tooltip: "Check logs. Run diagnostics command.",
    ariaLabel: "VoicePilot requires attention",
    severity: "error",
    activityBarIcon: "$(error)",
    defaultDetails: { retry: true, renewal: false },
  },
  offline: {
    state: "offline",
    sidebarLabel: "✖ Offline",
    statusBarText: "$(cloud-offline) Offline",
    message: "✖ Offline",
    tooltip: "Reconnect to resume voice control.",
    ariaLabel: "VoicePilot is offline",
    severity: "error",
    activityBarIcon: "$(cloud-offline)",
    defaultDetails: { retry: true, renewal: false },
  },
};

/**
 * Time window used to coalesce rapid presence updates.
 */
export const PRESENCE_BATCH_WINDOW_MS = 50;

/**
 * Normalizes the presence state by mapping transient states to canonical ones.
 */
export function normalizePresenceState(
  state: VoicePilotPresenceState,
): CanonicalPresenceState {
  return state === "interrupted" ? "listening" : state;
}

/**
 * Resolves the descriptor for a given presence state.
 */
export function resolvePresenceDescriptor(
  state: VoicePilotPresenceState,
): PresenceStateDescriptor {
  const canonical = normalizePresenceState(state);
  return BASE_DESCRIPTORS[canonical];
}

/**
 * Compares two presence updates to determine if they represent the same state.
 */
export function isPresenceStateEqual(
  a: PresenceUpdate | undefined,
  b: PresenceUpdate | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  const detailsEqual = JSON.stringify(a.details) === JSON.stringify(b.details);
  return (
    a.state === b.state &&
    a.message === b.message &&
    a.copilotAvailable === b.copilotAvailable &&
    detailsEqual
  );
}

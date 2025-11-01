import { randomUUID } from "crypto";
import type {
    AudioFeedbackControlMessage,
    AudioFeedbackEventMessage,
    AudioFeedbackStateMessage,
} from "../types/audio-feedback";
import type { TurnEventDiagnostics } from "../types/conversation";

/**
 * Enumerates the lifecycle states reflected in the voice control panel header.
 */
export type PanelStatus =
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "copilot-unavailable";

/**
 * Represents the microphone capture state communicated to the UI layer.
 */
export type MicrophoneStatus =
  | "idle"
  | "capturing"
  | "muted"
  | "permission-denied";

/**
 * Describes a single conversational transcript entry rendered in the panel.
 */
export interface TranscriptEntry {
  entryId: string;
  speaker: "user" | "agentvoice" | "copilot";
  content: string;
  timestamp: string;
  confidence?: number;
  partial?: boolean;
}

/**
 * Structured error surface used to communicate actionable issues to users.
 */
export interface UserFacingError {
  code: string;
  summary: string;
  remediation?: string;
}

/**
 * Captures the full render state required by the voice control panel webview.
 */
export interface VoiceControlPanelState {
  status: PanelStatus;
  statusLabel: string;
  statusMode?: string;
  statusDetail?: string;
  sessionId?: string;
  sessionStartedAt?: string;
  elapsedSeconds?: number;
  renewalCountdownSeconds?: number;
  transcript: TranscriptEntry[];
  copilotAvailable: boolean;
  configurationComplete: boolean;
  microphoneStatus: MicrophoneStatus;
  errorBanner?: UserFacingError;
  truncated?: boolean;
  pendingAction?: "start" | "stop" | "configure" | null;
  fallbackActive: boolean;
  diagnostics?: TurnEventDiagnostics;
}

/**
 * Message dispatched when the panel initializes and requests the latest state payload.
 */
export interface PanelInitializeMessage {
  type: "panel.initialize";
  state: VoiceControlPanelState;
}

/**
 * Session lifecycle message emitted to keep the panel state in sync with backend services.
 */
export interface SessionUpdateMessage {
  type: "session.update";
  sessionId?: string;
  status?: PanelStatus;
  statusLabel?: string;
  statusMode?: string;
  statusDetail?: string;
  fallbackActive?: boolean;
  sessionStartedAt?: string;
  elapsedSeconds?: number;
  renewalCountdownSeconds?: number;
  diagnostics?: TurnEventDiagnostics;
  error?: UserFacingError;
}

/**
 * Message instructing the panel to append or update a transcript entry.
 */
export interface TranscriptAppendMessage {
  type: "transcript.append";
  entry: TranscriptEntry;
}

/**
 * Message instructing the panel to commit a transcript entry with finalized content.
 */
export interface TranscriptCommitMessage {
  type: "transcript.commit";
  entryId: string;
  content: string;
  confidence?: number;
}

/**
 * Message notifying the panel that historical transcript entries were truncated.
 */
export interface TranscriptTruncatedMessage {
  type: "transcript.truncated";
}

/**
 * Message instructing the panel to remove a specific transcript entry.
 */
export interface TranscriptRemoveMessage {
  type: "transcript.remove";
  entryId: string;
}

/**
 * Message communicating microphone capture status changes to the panel.
 */
export interface AudioStatusMessage {
  type: "audio.status";
  microphoneStatus: MicrophoneStatus;
}

/**
 * Message broadcasting GitHub Copilot availability to the panel.
 */
export interface CopilotAvailabilityMessage {
  type: "copilot.availability";
  available: boolean;
}

/**
 * Message broadcasting configuration completeness to the panel.
 */
export interface ConfigurationStatusMessage {
  type: "configuration.status";
  complete: boolean;
}

/**
 * Union of messages sent from the extension host to the voice control panel.
 */
export type PanelOutboundMessage =
  | PanelInitializeMessage
  | SessionUpdateMessage
  | TranscriptAppendMessage
  | TranscriptCommitMessage
  | TranscriptTruncatedMessage
  | TranscriptRemoveMessage
  | AudioStatusMessage
  | CopilotAvailabilityMessage
  | ConfigurationStatusMessage
  | AudioFeedbackControlMessage
  | AudioFeedbackStateMessage;

/**
 * Message emitted by the panel when a user invokes an action control.
 */
export interface PanelActionMessage {
  type: "panel.action";
  action: "start" | "stop" | "configure";
}

/**
 * Message emitted by the panel for telemetry or error reporting feedback.
 */
export interface PanelFeedbackMessage {
  type: "panel.feedback";
  detail: unknown;
  kind: "error" | "telemetry";
}
/**
 * Union of messages received by the extension host from the voice control panel.
 */
export type PanelInboundMessage =
  | PanelActionMessage
  | PanelFeedbackMessage
  | AudioFeedbackEventMessage;

/**
 * Maximum number of transcript entries retained in panel memory.
 */
export const MAX_TRANSCRIPT_ENTRIES = 50;

/**
 * Constructs the default panel state presented when no session is active.
 *
 * @returns A panel state initialized with ready status and empty transcript.
 */
export function createInitialPanelState(): VoiceControlPanelState {
  return {
    status: "ready",
    statusLabel: "Ready",
    transcript: [],
    copilotAvailable: true,
    configurationComplete: false,
    microphoneStatus: "idle",
    pendingAction: null,
    fallbackActive: false,
  };
}

/**
 * Appends or merges a transcript entry while enforcing the transcript size limit.
 *
 * @param state - The current panel state.
 * @param entry - The transcript entry to append or merge.
 * @returns The updated panel state and a flag indicating whether truncation occurred.
 */
export function withTranscriptAppend(
  state: VoiceControlPanelState,
  entry: TranscriptEntry,
): { state: VoiceControlPanelState; truncated: boolean } {
  const nextEntries = [...state.transcript];
  const existingIndex = nextEntries.findIndex(
    (item) => item.entryId === entry.entryId,
  );
  if (existingIndex >= 0) {
    nextEntries[existingIndex] = { ...nextEntries[existingIndex], ...entry };
  } else {
    nextEntries.push(entry);
  }

  let truncated = false;
  while (nextEntries.length > MAX_TRANSCRIPT_ENTRIES) {
    nextEntries.shift();
    truncated = true;
  }

  return {
    state: {
      ...state,
      transcript: nextEntries,
      truncated: truncated || state.truncated,
    },
    truncated,
  };
}

/**
 * Finalizes a transcript entry by replacing partial content with the confirmed message.
 *
 * @param state - The existing panel state.
 * @param entryId - The identifier of the entry to commit.
 * @param content - The finalized transcript content.
 * @param confidence - Optional confidence score associated with the transcript.
 * @returns The updated panel state with the committed content.
 */
export function withTranscriptCommit(
  state: VoiceControlPanelState,
  entryId: string,
  content: string,
  confidence?: number,
): VoiceControlPanelState {
  const nextEntries = state.transcript.map((entry) =>
    entry.entryId === entryId
      ? {
          ...entry,
          content,
          confidence,
          partial: false,
        }
      : entry,
  );

  return {
    ...state,
    transcript: nextEntries,
  };
}

/**
 * Ensures transcript entries have a stable identifier, generating one when absent.
 *
 * @param entry - The entry that may or may not include an identifier.
 * @returns The existing entry identifier or a newly generated value.
 */
export function ensureEntryId(entry?: Partial<TranscriptEntry>): string {
  return entry?.entryId ?? randomUUID();
}

/**
 * Calculates elapsed whole seconds since the provided ISO start timestamp.
 *
 * @param start - ISO 8601 timestamp indicating when the session began.
 * @returns The elapsed seconds or undefined when the timestamp is invalid.
 */
export function getElapsedSeconds(start?: string): number | undefined {
  if (!start) {
    return undefined;
  }
  const started = new Date(start).getTime();
  if (Number.isNaN(started)) {
    return undefined;
  }
  return Math.floor((Date.now() - started) / 1000);
}

/**
 * Determines whether the panel should treat the current session as active.
 *
 * @param state - The current panel state.
 * @returns True when a session exists and the panel is not idle or in error.
 */
export function isSessionActive(state: VoiceControlPanelState): boolean {
  return (
    Boolean(state.sessionId) &&
    state.status !== "ready" &&
    state.status !== "error"
  );
}

/**
 * Infers the microphone status based on panel session context.
 *
 * @param state - The current panel state.
 * @returns The microphone status to reflect in the panel UI.
 */
export function deriveMicrophoneStatusFromState(
  state: VoiceControlPanelState,
): MicrophoneStatus {
  if (!state.sessionId) {
    return "idle";
  }
  if (state.status === "speaking") {
    return "muted";
  }
  if (state.status === "error") {
    return state.microphoneStatus;
  }
  return "capturing";
}

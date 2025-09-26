import { randomUUID } from 'crypto';
import type { TurnEventDiagnostics } from '../types/conversation';

export type PanelStatus =
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'copilot-unavailable';

export type MicrophoneStatus = 'idle' | 'capturing' | 'muted' | 'permission-denied';

export interface TranscriptEntry {
  entryId: string;
  speaker: 'user' | 'voicepilot' | 'copilot';
  content: string;
  timestamp: string;
  confidence?: number;
  partial?: boolean;
}

export interface UserFacingError {
  code: string;
  summary: string;
  remediation?: string;
}

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
  microphoneStatus: MicrophoneStatus;
  errorBanner?: UserFacingError;
  truncated?: boolean;
  pendingAction?: 'start' | 'stop' | 'configure' | null;
  fallbackActive: boolean;
  diagnostics?: TurnEventDiagnostics;
}

export interface PanelInitializeMessage {
  type: 'panel.initialize';
  state: VoiceControlPanelState;
}

export interface SessionUpdateMessage {
  type: 'session.update';
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

export interface TranscriptAppendMessage {
  type: 'transcript.append';
  entry: TranscriptEntry;
}

export interface TranscriptCommitMessage {
  type: 'transcript.commit';
  entryId: string;
  content: string;
  confidence?: number;
}

export interface TranscriptTruncatedMessage {
  type: 'transcript.truncated';
}

export interface AudioStatusMessage {
  type: 'audio.status';
  microphoneStatus: MicrophoneStatus;
}

export interface CopilotAvailabilityMessage {
  type: 'copilot.availability';
  available: boolean;
}

export type PanelOutboundMessage =
  | PanelInitializeMessage
  | SessionUpdateMessage
  | TranscriptAppendMessage
  | TranscriptCommitMessage
  | TranscriptTruncatedMessage
  | AudioStatusMessage
  | CopilotAvailabilityMessage;

export interface PanelActionMessage {
  type: 'panel.action';
  action: 'start' | 'stop' | 'configure';
}

export interface PanelFeedbackMessage {
  type: 'panel.feedback';
  detail: unknown;
  kind: 'error' | 'telemetry';
}

export type PanelInboundMessage = PanelActionMessage | PanelFeedbackMessage;

export const MAX_TRANSCRIPT_ENTRIES = 50;

export function createInitialPanelState(): VoiceControlPanelState {
  return {
    status: 'ready',
    statusLabel: 'Ready',
    transcript: [],
    copilotAvailable: true,
    microphoneStatus: 'idle',
    pendingAction: null,
    fallbackActive: false
  };
}

export function withTranscriptAppend(
  state: VoiceControlPanelState,
  entry: TranscriptEntry
): { state: VoiceControlPanelState; truncated: boolean } {
  const nextEntries = [...state.transcript];
  const existingIndex = nextEntries.findIndex(item => item.entryId === entry.entryId);
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
      truncated: truncated || state.truncated
    },
    truncated
  };
}

export function withTranscriptCommit(
  state: VoiceControlPanelState,
  entryId: string,
  content: string,
  confidence?: number
): VoiceControlPanelState {
  const nextEntries = state.transcript.map(entry =>
    entry.entryId === entryId
      ? {
          ...entry,
          content,
          confidence,
          partial: false
        }
      : entry
  );

  return {
    ...state,
    transcript: nextEntries
  };
}

export function ensureEntryId(entry?: Partial<TranscriptEntry>): string {
  return entry?.entryId ?? randomUUID();
}

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

export function isSessionActive(state: VoiceControlPanelState): boolean {
  return Boolean(state.sessionId) && state.status !== 'ready' && state.status !== 'error';
}

export function deriveMicrophoneStatusFromState(state: VoiceControlPanelState): MicrophoneStatus {
  if (!state.sessionId) {
    return 'idle';
  }
  if (state.status === 'speaking') {
    return 'muted';
  }
  if (state.status === 'error') {
    return state.microphoneStatus;
  }
  return 'capturing';
}

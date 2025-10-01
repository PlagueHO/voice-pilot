import { ServiceInitializable } from "../core/service-initializable";

/**
 * Identifiers assigned to individual audio cues rendered by the feedback system.
 */
export type AudioCueId =
  | "session.start"
  | "session.end"
  | "listening.prompt"
  | "thinking.transition"
  | "speaking.transition"
  | "interruption.detected"
  | "error.critical"
  | "degraded.enter"
  | "degraded.exit";

/**
 * Semantic grouping for cues that share gain profiles and spacing heuristics.
 */
export type AudioCueCategory = "session" | "state" | "error" | "accessibility";

/**
 * Ducking strategies applied to coordinate cue playback with TTS output.
 */
export type DuckingStrategy = "none" | "attenuate" | "pause" | "crossfade";

/**
 * Accessibility profiles affecting cue loudness and emphasis.
 */
export type AccessibilityProfile = "standard" | "high-contrast" | "silent";

/**
 * Discriminated union of commands sent from host to the webview audio player.
 */
export type AudioFeedbackControlMessage =
  | {
      type: "audioFeedback.control";
      payload: AudioFeedbackPlayCommand;
    }
  | {
      type: "audioFeedback.control";
      payload: AudioFeedbackStopCommand;
    }
  | {
      type: "audioFeedback.control";
      payload: AudioFeedbackSetConfigCommand;
    };

export interface AudioFeedbackPlayCommand {
  command: "play";
  handleId: string;
  cueId: AudioCueId;
  category: AudioCueCategory;
  duckStrategy: DuckingStrategy;
  accessibilityProfile: AccessibilityProfile;
  gain: number;
  fadeOutMs: number;
}

export interface AudioFeedbackStopCommand {
  command: "stop";
  handleId?: string;
  reason?: string;
}

export interface AudioFeedbackSetConfigCommand {
  command: "configure";
  accessibilityProfile: AccessibilityProfile;
  duckStrategy: DuckingStrategy;
  categoryGains: Record<AudioCueCategory, number>;
}

/**
 * Event message emitted by the webview when cue playback transitions state.
 */
export interface AudioFeedbackEventMessage {
  type: "audioFeedback.event";
  payload: AudioFeedbackEvent;
}

/**
 * State update propagated to the webview to display degraded/suppressed status.
 */
export interface AudioFeedbackStateMessage {
  type: "audioFeedback.state";
  payload: {
    degraded: boolean;
    reason?: string;
  };
}

/**
 * Playback state notification describing cue lifecycle transitions.
 */
export interface AudioFeedbackEvent {
  handleId: string;
  cueId: AudioCueId;
  status: "played" | "failed" | "suppressed" | "stopped";
  latencyMs?: number;
  errorCode?: string;
  ducking?: DuckingStrategy;
}

/**
 * Configuration values derived from VS Code settings for the audio feedback service.
 */
export interface AudioFeedbackConfig {
  enabled: boolean;
  defaultDucking: DuckingStrategy;
  accessibilityProfile: AccessibilityProfile;
  telemetryEnabled: boolean;
  categoryGains: Record<AudioCueCategory, number>;
  psychoacousticSpacingMs: number;
  degradedMode: {
    failureThreshold: number;
    windowMs: number;
    cooldownMs: number;
  };
}

/**
 * Request payload for host-initiated cue playback.
 */
export interface AudioCueRequest {
  cueId: AudioCueId;
  category: AudioCueCategory;
  duckStrategy?: DuckingStrategy;
  accessibilityProfile?: AccessibilityProfile;
  gainOverride?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Handle returned when a cue is scheduled for playback.
 */
export interface AudioCueHandle {
  id: string;
  cueId: AudioCueId;
  startedAt: number;
  status: "pending" | "played" | "failed" | "suppressed" | "stopped";
}

/**
 * Aggregated playback metrics surfaced for diagnostics and telemetry.
 */
export interface AudioFeedbackMetrics {
  averageLatencyMs: number;
  playedCount: number;
  failureCount: number;
  suppressedCount: number;
  duckingEngagementRatio: number;
}

/**
 * Adapter contract implemented by the webview bridge to send commands and receive events.
 */
export interface AudioFeedbackPanelAdapter {
  sendAudioFeedbackControl(message: AudioFeedbackControlMessage): void;
  sendAudioFeedbackState(payload: AudioFeedbackStateMessage["payload"]): void;
  onAudioFeedbackEvent(handler: (message: AudioFeedbackEventMessage) => void): {
    dispose(): void;
  };
}

/**
 * Service interface governing audio feedback orchestration.
 */
export interface AudioFeedbackService
  extends ServiceInitializable,
    AudioCueScheduler {}

/**
 * Scheduler operations exposed for other services to trigger cue playback.
 */
export interface AudioCueScheduler {
  playCue(request: AudioCueRequest): Promise<AudioCueHandle>;
  stopCue(handleId: string): Promise<void>;
  stopAllCues(): Promise<void>;
  getMetrics(): AudioFeedbackMetrics;
  isDegraded(): boolean;
}

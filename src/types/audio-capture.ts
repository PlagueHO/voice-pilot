import { ServiceInitializable } from "../core/service-initializable";
import type { AudioProcessingError } from "./audio-errors";

/**
 * Represents supported noise suppression strengths for the capture pipeline.
 */
export type NoiseSuppressionLevel = "low" | "medium" | "high";

/**
 * Represents echo cancellation strengths applied to the captured signal.
 */
export type EchoCancellationLevel = "low" | "medium" | "high";

/**
 * Represents automatic gain control intensities available to the pipeline.
 */
export type AutoGainControlLevel = "off" | "low" | "medium" | "high";

declare type AudioContextLatencyHint = AudioContextLatencyCategory | number;

/**
 * User-configurable settings that drive audio capture hardware selection and
 * browser media stream creation.
 */
export type AudioCaptureSampleRate = 16000 | 24000 | 48000;

export interface AudioCaptureConfig {
  deviceId?: string;
  sampleRate: AudioCaptureSampleRate;
  channelCount: number;
  bufferSize: number;
  latencyHint?: AudioContextLatencyHint;
  enableNoiseSuppression: boolean;
  enableEchoCancellation: boolean;
  enableAutoGainControl: boolean;
}

/**
 * Configuration values controlling the processing chain applied to captured audio.
 */
export interface AudioProcessingConfig {
  noiseSuppressionLevel: NoiseSuppressionLevel;
  echoCancellationLevel: EchoCancellationLevel;
  autoGainControlLevel: AutoGainControlLevel;
  voiceActivitySensitivity: number;
  analysisIntervalMs: number;
}

/**
 * Result payload describing the current voice activity detection decision.
 */
export interface VoiceActivityResult {
  isVoiceDetected: boolean;
  confidence: number;
  threshold: number;
  timestamp: number;
}

/**
 * Aggregated metrics emitted by the capture pipeline for diagnostics and telemetry.
 */
export interface AudioMetrics {
  inputLevel: number;
  peakLevel: number;
  rmsLevel: number;
  signalToNoiseRatio: number;
  latencyEstimate: number;
  latencyEstimateMs: number;
  bufferHealth: number;
  droppedFrameCount: number;
  totalFrameCount: number;
  analysisWindowMs: number;
  analysisDurationMs: number;
  cpuUtilization: number;
  updatedAt: number;
}

export interface PerformanceBudgetSample {
  id: string;
  requirement: string;
  durationMs: number;
  limitMs: number;
  exceeded: boolean;
  overageMs: number;
  timestamp: number;
}

export interface PerformanceBudgetSummary extends PerformanceBudgetSample {
  count: number;
  averageMs: number;
  maxMs: number;
  breaches: number;
}

export interface CpuUtilizationSample {
  utilization: number;
  budget: number;
  exceeded: boolean;
  workMs: number;
  intervalMs: number;
  timestamp: number;
}

export interface CpuUtilizationSummary extends CpuUtilizationSample {
  count: number;
  averageUtilization: number;
  maxUtilization: number;
  breaches: number;
}

export interface AudioPerformanceDiagnostics {
  budgets: PerformanceBudgetSummary[];
  cpu?: CpuUtilizationSummary;
}

/**
 * Supported event discriminators emitted by the capture pipeline.
 */
export type AudioCaptureEventType =
  | "captureStarted"
  | "captureStopped"
  | "audioLevelChanged"
  | "deviceChanged"
  | "permissionGranted"
  | "permissionDenied"
  | "voiceActivity"
  | "voiceActivityDetected"
  | "processingError"
  | "qualityChanged"
  | "metricsUpdated";

/**
 * Generic event contract emitted by the capture pipeline with optional data payloads.
 * @typeParam TType - Specific event discriminator.
 * @typeParam TData - Data payload shape associated with the event.
 */
export interface AudioCaptureEvent<
  TType extends AudioCaptureEventType = AudioCaptureEventType,
  TData = unknown,
> {
  type: TType;
  timestamp: number;
  data?: TData;
}

/**
 * Handler signature for capture pipeline events.
 * @typeParam TEvent - Event shape the handler expects.
 */
export type AudioCaptureEventHandler<
  TEvent extends AudioCaptureEvent = AudioCaptureEvent,
> = (event: TEvent) => void | Promise<void>;

/**
 * Event emitted when capture begins, providing the active stream and track details.
 */
export interface CaptureStartedEvent
  extends AudioCaptureEvent<"captureStarted"> {
  data: {
    streamId: string;
    trackId: string;
    settings: MediaTrackSettings;
  };
}

/**
 * Event emitted when capture stops, including contextual identifiers and reasoning.
 */
export interface CaptureStoppedEvent
  extends AudioCaptureEvent<"captureStopped"> {
  data: {
    streamId?: string;
    trackId?: string;
    reason?: string;
  };
}

/**
 * Event emitted when audio level metrics change beyond configured thresholds.
 */
export interface AudioLevelChangedEvent
  extends AudioCaptureEvent<"audioLevelChanged"> {
  data: {
    level: number;
    peak: number;
    rms: number;
  };
}

/**
 * Event emitted when the underlying media device is swapped or updated.
 */
export interface DeviceChangedEvent extends AudioCaptureEvent<"deviceChanged"> {
  data: {
    deviceId: string;
    label?: string;
  };
}

/**
 * Event emitted when microphone permission is granted, including negotiated capture parameters.
 */
export interface PermissionGrantedEvent
  extends AudioCaptureEvent<"permissionGranted"> {
  data: {
    deviceId?: string;
    label?: string;
    sampleRate: AudioCaptureSampleRate;
    channelCount: number;
    guidance?: string;
  };
}

/**
 * Event emitted when microphone permission is denied or restricted, providing retry guidance.
 */
export interface PermissionDeniedEvent
  extends AudioCaptureEvent<"permissionDenied"> {
  data: {
    reason: string;
    guidance: string;
    canRetry: boolean;
    retryAfterMs?: number;
  };
}

/**
 * Event emitted when voice activity detection produces a new decision.
 */
export interface VoiceActivityEvent extends AudioCaptureEvent<"voiceActivity"> {
  data: VoiceActivityResult;
}

/**
 * Event emitted when enhanced voice activity detection pipelines produce an updated decision.
 */
export interface VoiceActivityDetectedEvent
  extends AudioCaptureEvent<"voiceActivityDetected"> {
  data: VoiceActivityResult & {
    durationMs?: number;
    speechProbability?: number;
  };
}

/**
 * Event emitted when the processing chain encounters an error state.
 */
export interface ProcessingErrorEvent
  extends AudioCaptureEvent<"processingError"> {
  data: AudioProcessingError;
}

/**
 * Event emitted when perceived capture quality changes appreciably.
 */
export interface QualityChangedEvent
  extends AudioCaptureEvent<"qualityChanged"> {
  data: {
    quality: "excellent" | "good" | "fair" | "poor";
    reason?: string;
  };
}

/**
 * Event emitted periodically with refreshed performance metrics.
 */
export interface MetricsUpdatedEvent
  extends AudioCaptureEvent<"metricsUpdated"> {
  data: AudioMetrics;
}

/**
 * Discriminated union encompassing every supported pipeline event payload.
 */
export type AudioCapturePipelineEvent =
  | CaptureStartedEvent
  | CaptureStoppedEvent
  | AudioLevelChangedEvent
  | DeviceChangedEvent
  | PermissionGrantedEvent
  | PermissionDeniedEvent
  | VoiceActivityEvent
  | VoiceActivityDetectedEvent
  | ProcessingErrorEvent
  | QualityChangedEvent
  | MetricsUpdatedEvent;

/**
 * Outcome from validating a requested audio input device for capture readiness.
 */
export interface DeviceValidationResult {
  isValid: boolean;
  deviceId: string;
  label?: string;
  capabilities?: MediaTrackCapabilities;
  settings?: MediaTrackSettings;
  error?: AudioProcessingError;
}

/**
 * Shape of the Web Audio graph constructed to process microphone input.
 */
export interface AudioProcessingGraph {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
  workletNode: AudioWorkletNode;
}

/**
 * Abstraction responsible for constructing and managing audio processing graphs.
 */
export interface AudioProcessingChain {
  createProcessingGraph(
    stream: MediaStream,
    config: AudioProcessingConfig,
  ): Promise<AudioProcessingGraph>;
  updateProcessingParameters(
    graph: AudioProcessingGraph,
    config: Partial<AudioProcessingConfig>,
  ): Promise<void>;
  analyzeAudioLevel(graph: AudioProcessingGraph): AudioMetrics;
  measureLatency(context: AudioContext): Promise<number>;
  disposeGraph(graph: AudioProcessingGraph): void;
}

/**
 * Public interface for the audio capture pipeline used throughout VoicePilot.
 */
export interface AudioCapturePipeline extends ServiceInitializable {
  initialize(
    config?: Partial<AudioCaptureConfig>,
    processingConfig?: Partial<AudioProcessingConfig>,
  ): Promise<void>;
  startCapture(): Promise<void>;
  stopCapture(): Promise<void>;
  getCaptureStream(): MediaStream | null;
  getCaptureTrack(): MediaStreamTrack | null;
  getAudioContext(): AudioContext | null;
  replaceCaptureTrack(deviceId: string): Promise<MediaStreamTrack>;
  updateCaptureConfig(config: Partial<AudioCaptureConfig>): Promise<void>;
  updateProcessingConfig(config: Partial<AudioProcessingConfig>): Promise<void>;
  setAudioProcessing(config: AudioProcessingConfig): Promise<void>;
  validateAudioDevice(deviceId: string): Promise<DeviceValidationResult>;
  getAudioMetrics(): AudioMetrics;
  getAudioLevel(): number;
  detectVoiceActivity(): Promise<VoiceActivityResult>;
  getPerformanceDiagnostics(): AudioPerformanceDiagnostics;
  addEventListener<TEvent extends AudioCapturePipelineEvent>(
    type: TEvent["type"],
    handler: AudioCaptureEventHandler<TEvent>,
  ): void;
  removeEventListener<TEvent extends AudioCapturePipelineEvent>(
    type: TEvent["type"],
    handler: AudioCaptureEventHandler<TEvent>,
  ): void;
}

/**
 * Snapshot of the current pipeline configuration and metrics for telemetry or debugging.
 */
export interface AudioCaptureSnapshot {
  streamId?: string;
  trackId?: string;
  config: AudioCaptureConfig;
  processingConfig: AudioProcessingConfig;
  metrics: AudioMetrics;
}

/**
 * Detailed statistics gathered for a given audio track within the capture session.
 */
export interface AudioTrackStatistics {
  trackId: string;
  label: string;
  kind: string;
  enabled: boolean;
  muted: boolean;
  state: MediaStreamTrackState;
  sampleRate?: number;
  channelCount?: number;
  bitrate?: number;
  jitter?: number;
  packetsLost?: number;
  audioLevel?: number;
  framesPerSecond?: number;
  settings: MediaTrackSettings;
  capabilities?: MediaTrackCapabilities;
}

/**
 * Lightweight state descriptor for monitoring track readiness and availability.
 */
export interface AudioTrackState {
  trackId: string;
  state: MediaStreamTrackState;
  muted: boolean;
  enabled: boolean;
  ready: boolean;
  ended: boolean;
}

import { AudioMetrics } from "../types/audio-capture";

/**
 * Aggregated metrics describing the extension's handling of conversation interruptions.
 * @remarks
 * These values feed telemetry and adaptive heuristics that tune turn-taking behavior during
 * realtime audio sessions.
 */
export interface ConversationInterruptionMetrics {
  /** Total number of interruptions detected within the session lifetime. */
  totalInterruptions: number;
  /** Latency, in milliseconds, observed for the most recent interruption recovery. */
  recentLatencyMs: number;
  /** Running average latency, in milliseconds, for interruption recoveries. */
  averageLatencyMs: number;
  /** Count of times the system activated fallback logic due to interruption handling failures. */
  fallbackActivations: number;
  /** Timestamp (epoch milliseconds) for the most recent fallback activation, if recorded. */
  lastFallbackAt?: number;
  /** Number of times a cooldown period prevented immediate interruption processing. */
  cooldownActivations: number;
  /** Timestamp (epoch milliseconds) indicating when the metrics were last updated. */
  updatedAt: number;
}

const EPSILON = 1e-8;

/**
 * Produces a zeroed `AudioMetrics` structure for initializing analysis pipelines.
 * @returns A baseline metrics object with neutral values and a fresh timestamp.
 */
export function createEmptyMetrics(): AudioMetrics {
  return {
    inputLevel: 0,
    peakLevel: 0,
    rmsLevel: 0,
    signalToNoiseRatio: 0,
    latencyEstimate: 0,
    bufferHealth: 1,
    droppedFrameCount: 0,
    totalFrameCount: 0,
    analysisWindowMs: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Calculates the absolute peak amplitude of the provided audio frame.
 * @param data - PCM sample buffer to analyze.
 * @returns The maximum absolute value observed within the buffer.
 */
export function calculatePeak(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const value = Math.abs(data[i]);
    if (value > peak) {
      peak = value;
    }
  }
  return peak;
}

/**
 * Computes the root-mean-square amplitude for a frame of PCM samples.
 * @param data - PCM sample buffer to analyze.
 * @returns The RMS amplitude, or 0 when no samples are available.
 */
export function calculateRms(data: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / Math.max(data.length, 1));
}

/**
 * Estimates the signal-to-noise ratio for an audio frame using RMS heuristics.
 * @param data - PCM sample buffer to analyze.
 * @returns Estimated SNR in decibels, bounded to finite values.
 */
export function estimateSnr(data: Float32Array): number {
  const rms = calculateRms(data);
  if (rms < EPSILON) {
    return 0;
  }

  // Estimate noise as the RMS of lower amplitude samples
  let noiseSquares = 0;
  let noiseCount = 0;
  const noiseThreshold = rms * 0.5;

  for (let i = 0; i < data.length; i++) {
    const value = Math.abs(data[i]);
    if (value < noiseThreshold) {
      noiseSquares += value * value;
      noiseCount++;
    }
  }

  if (noiseCount === 0) {
    return 30; // Assume high SNR if no noise samples detected
  }

  const noiseRms = Math.sqrt(noiseSquares / noiseCount);
  const snr = 20 * Math.log10((rms + EPSILON) / (noiseRms + EPSILON));
  return Number.isFinite(snr) ? snr : 0;
}

/**
 * Computes the relative health of the audio buffer based on total and dropped frames.
 * @param totalFrames - Total frames produced for the interval.
 * @param droppedFrames - Frames dropped during the same interval.
 * @returns A normalized health value in the range [0, 1].
 */
export function computeBufferHealth(
  totalFrames: number,
  droppedFrames: number,
): number {
  if (totalFrames <= 0) {
    return 1;
  }

  const health = 1 - droppedFrames / totalFrames;
  return Math.min(Math.max(health, 0), 1);
}

/**
 * Merges new metric readings into the previous snapshot with an updated timestamp.
 * @param previous - The prior metrics snapshot.
 * @param next - Partial metrics to overlay atop the previous snapshot.
 * @returns Updated metrics reflecting the merge operation.
 */
export function mergeMetrics(
  previous: AudioMetrics,
  next: Partial<AudioMetrics>,
): AudioMetrics {
  return {
    ...previous,
    ...next,
    updatedAt: Date.now(),
  };
}

/**
 * Creates a zeroed set of interruption metrics with a fresh timestamp.
 * @returns Initialized `ConversationInterruptionMetrics` ready for accumulation.
 */
export function createInterruptionMetrics(): ConversationInterruptionMetrics {
  return {
    totalInterruptions: 0,
    recentLatencyMs: 0,
    averageLatencyMs: 0,
    fallbackActivations: 0,
    cooldownActivations: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Records a newly observed interruption latency and updates running statistics.
 * @param metrics - Existing interruption metrics to update.
 * @param latencyMs - Observed latency, in milliseconds, for the latest interruption.
 * @returns Updated metrics including the new latency sample and timestamp.
 */
export function recordInterruptionLatency(
  metrics: ConversationInterruptionMetrics,
  latencyMs: number,
): ConversationInterruptionMetrics {
  const totalInterruptions = metrics.totalInterruptions + 1;
  const averageLatencyMs =
    metrics.averageLatencyMs +
    (latencyMs - metrics.averageLatencyMs) / totalInterruptions;
  return {
    ...metrics,
    totalInterruptions,
    recentLatencyMs: latencyMs,
    averageLatencyMs,
    updatedAt: Date.now(),
  };
}

/**
 * Increments the fallback activation counter while tracking the triggering timestamp.
 * @param metrics - Existing interruption metrics to update.
 * @param timestamp - Epoch milliseconds when the fallback activation occurred.
 * @returns Updated metrics with incremented fallback counters.
 */
export function incrementFallbackActivations(
  metrics: ConversationInterruptionMetrics,
  timestamp: number,
): ConversationInterruptionMetrics {
  return {
    ...metrics,
    fallbackActivations: metrics.fallbackActivations + 1,
    lastFallbackAt: timestamp,
    updatedAt: Date.now(),
  };
}

/**
 * Increments the recorded count of cooldown activations.
 * @param metrics - Existing interruption metrics to update.
 * @returns Updated metrics reflecting the new cooldown activation.
 */
export function incrementCooldownActivations(
  metrics: ConversationInterruptionMetrics,
): ConversationInterruptionMetrics {
  return {
    ...metrics,
    cooldownActivations: metrics.cooldownActivations + 1,
    updatedAt: Date.now(),
  };
}

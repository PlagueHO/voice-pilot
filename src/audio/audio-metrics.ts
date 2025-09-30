import {
  AudioMetrics,
  AudioPerformanceDiagnostics,
  CpuUtilizationSample,
  CpuUtilizationSummary,
  PerformanceBudgetSample,
  PerformanceBudgetSummary,
} from "../types/audio-capture";

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
    latencyEstimateMs: 0,
    bufferHealth: 1,
    droppedFrameCount: 0,
    totalFrameCount: 0,
    analysisWindowMs: 0,
    analysisDurationMs: 0,
    cpuUtilization: 0,
    updatedAt: Date.now(),
  };
}

const hasPerformanceNow =
  typeof performance !== "undefined" && typeof performance.now === "function";

export function getTimestampMs(): number {
  return hasPerformanceNow ? performance.now() : Date.now();
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

interface BudgetAccumulator {
  totalDuration: number;
  maxDuration: number;
  count: number;
  breaches: number;
  lastSample?: PerformanceBudgetSample;
}

export interface PerformanceBudgetDefinition {
  id: string;
  limitMs: number;
  requirement: string;
  description?: string;
}

export class PerformanceBudgetTracker {
  private readonly budgets = new Map<string, PerformanceBudgetDefinition>();
  private readonly accumulators = new Map<string, BudgetAccumulator>();

  constructor(definitions: ReadonlyArray<PerformanceBudgetDefinition>) {
    definitions.forEach((definition) => {
      this.budgets.set(definition.id, { ...definition });
    });
  }

  record(id: string, durationMs: number): PerformanceBudgetSample {
    const definition = this.budgets.get(id);
    if (!definition) {
      throw new Error(`Unknown performance budget id: ${id}`);
    }

    const exceeded = durationMs > definition.limitMs;
    const timestamp = getTimestampMs();
    const sample: PerformanceBudgetSample = {
      id,
      requirement: definition.requirement,
      durationMs,
      limitMs: definition.limitMs,
      exceeded,
      overageMs: exceeded ? durationMs - definition.limitMs : 0,
      timestamp,
    };

    const accumulator = this.accumulators.get(id) ?? {
      totalDuration: 0,
      maxDuration: 0,
      count: 0,
      breaches: 0,
    };

    accumulator.totalDuration += durationMs;
    accumulator.count += 1;
    accumulator.maxDuration = Math.max(accumulator.maxDuration, durationMs);
    if (exceeded) {
      accumulator.breaches += 1;
    }
    accumulator.lastSample = sample;

    this.accumulators.set(id, accumulator);
    return sample;
  }

  getSummary(id: string): PerformanceBudgetSummary | undefined {
    const definition = this.budgets.get(id);
    const accumulator = this.accumulators.get(id);
    if (!definition || !accumulator || !accumulator.lastSample) {
      return undefined;
    }

    const { totalDuration, maxDuration, count, breaches, lastSample } =
      accumulator;

    return {
      ...lastSample,
      count,
      averageMs: count > 0 ? totalDuration / count : 0,
      maxMs: maxDuration,
      breaches,
    };
  }

  getSummaries(): PerformanceBudgetSummary[] {
    const summaries: PerformanceBudgetSummary[] = [];
    for (const id of this.budgets.keys()) {
      const summary = this.getSummary(id);
      if (summary) {
        summaries.push(summary);
      }
    }
    return summaries;
  }

  reset(id?: string): void {
    if (id) {
      this.accumulators.delete(id);
      return;
    }
    this.accumulators.clear();
  }
}

interface CpuAccumulator {
  totalUtilization: number;
  maxUtilization: number;
  count: number;
  breaches: number;
  lastSample?: CpuUtilizationSample;
}

export class CpuLoadTracker {
  private readonly accumulator: CpuAccumulator = {
    totalUtilization: 0,
    maxUtilization: 0,
    count: 0,
    breaches: 0,
  };

  constructor(
    private readonly budgetRatio: number,
    private readonly minimumIntervalMs = 1,
  ) {}

  record(workMs: number, intervalMs: number): CpuUtilizationSample {
    const safeInterval = Math.max(intervalMs, this.minimumIntervalMs);
    const utilization = safeInterval > 0 ? workMs / safeInterval : 0;
    const exceeded = utilization > this.budgetRatio;
    const sample: CpuUtilizationSample = {
      utilization,
      budget: this.budgetRatio,
      exceeded,
      workMs,
      intervalMs: safeInterval,
      timestamp: getTimestampMs(),
    };

    this.accumulator.totalUtilization += utilization;
    this.accumulator.count += 1;
    this.accumulator.maxUtilization = Math.max(
      this.accumulator.maxUtilization,
      utilization,
    );
    if (exceeded) {
      this.accumulator.breaches += 1;
    }
    this.accumulator.lastSample = sample;

    return sample;
  }

  getSummary(): CpuUtilizationSummary | undefined {
    if (!this.accumulator.lastSample) {
      return undefined;
    }

    return {
      ...this.accumulator.lastSample,
      count: this.accumulator.count,
      averageUtilization:
        this.accumulator.count > 0
          ? this.accumulator.totalUtilization / this.accumulator.count
          : 0,
      maxUtilization: this.accumulator.maxUtilization,
      breaches: this.accumulator.breaches,
    };
  }

  reset(): void {
    this.accumulator.totalUtilization = 0;
    this.accumulator.maxUtilization = 0;
    this.accumulator.count = 0;
    this.accumulator.breaches = 0;
    this.accumulator.lastSample = undefined;
  }
}

export function mergeDiagnostics(
  tracker: PerformanceBudgetTracker,
  cpuTracker: CpuLoadTracker,
): AudioPerformanceDiagnostics {
  return {
    budgets: tracker.getSummaries(),
    cpu: cpuTracker.getSummary(),
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

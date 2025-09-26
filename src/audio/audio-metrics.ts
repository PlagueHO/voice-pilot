import { AudioMetrics } from '../types/audio-capture';

export interface ConversationInterruptionMetrics {
    totalInterruptions: number;
    recentLatencyMs: number;
    averageLatencyMs: number;
    fallbackActivations: number;
    lastFallbackAt?: number;
    cooldownActivations: number;
    updatedAt: number;
}

const EPSILON = 1e-8;

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
        updatedAt: Date.now()
    };
}

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

export function calculateRms(data: Float32Array): number {
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
        const value = data[i];
        sumSquares += value * value;
    }
    return Math.sqrt(sumSquares / Math.max(data.length, 1));
}

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

export function computeBufferHealth(totalFrames: number, droppedFrames: number): number {
    if (totalFrames <= 0) {
        return 1;
    }

    const health = 1 - droppedFrames / totalFrames;
    return Math.min(Math.max(health, 0), 1);
}

export function mergeMetrics(previous: AudioMetrics, next: Partial<AudioMetrics>): AudioMetrics {
    return {
        ...previous,
        ...next,
        updatedAt: Date.now()
    };
}

export function createInterruptionMetrics(): ConversationInterruptionMetrics {
    return {
        totalInterruptions: 0,
        recentLatencyMs: 0,
        averageLatencyMs: 0,
        fallbackActivations: 0,
        cooldownActivations: 0,
        updatedAt: Date.now()
    };
}

export function recordInterruptionLatency(
    metrics: ConversationInterruptionMetrics,
    latencyMs: number
): ConversationInterruptionMetrics {
    const totalInterruptions = metrics.totalInterruptions + 1;
    const averageLatencyMs =
        metrics.averageLatencyMs + (latencyMs - metrics.averageLatencyMs) / totalInterruptions;
    return {
        ...metrics,
        totalInterruptions,
        recentLatencyMs: latencyMs,
        averageLatencyMs,
        updatedAt: Date.now()
    };
}

export function incrementFallbackActivations(
    metrics: ConversationInterruptionMetrics,
    timestamp: number
): ConversationInterruptionMetrics {
    return {
        ...metrics,
        fallbackActivations: metrics.fallbackActivations + 1,
        lastFallbackAt: timestamp,
        updatedAt: Date.now()
    };
}

export function incrementCooldownActivations(
    metrics: ConversationInterruptionMetrics
): ConversationInterruptionMetrics {
    return {
        ...metrics,
        cooldownActivations: metrics.cooldownActivations + 1,
        updatedAt: Date.now()
    };
}

import { AudioMetrics } from '../types/audio-capture';

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

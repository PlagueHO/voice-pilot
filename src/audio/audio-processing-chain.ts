import { Logger } from "../core/logger";
import {
  AudioMetrics,
  AudioProcessingChain,
  AudioProcessingConfig,
  AudioProcessingGraph,
} from "../types/audio-capture";
import {
  calculatePeak,
  calculateRms,
  computeBufferHealth,
  createEmptyMetrics,
  estimateSnr,
  mergeMetrics,
} from "./audio-metrics";
import {
  ensurePcmEncoderWorklet,
  PCM_ENCODER_WORKLET_NAME,
} from "./worklets/pcm-encoder-worklet";

interface MetricsState {
  totalFrames: number;
  droppedFrames: number;
  lastAnalysisTimestamp: number;
  metrics: AudioMetrics;
}

const DEFAULT_ANALYSIS_INTERVAL_MS = 100;
const DEFAULT_LATENCY_HINT: AudioContextLatencyCategory = "interactive";

export class WebAudioProcessingChain implements AudioProcessingChain {
  private readonly logger: Logger;
  private readonly metricsState = new WeakMap<
    AudioProcessingGraph,
    MetricsState
  >();

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("WebAudioProcessingChain");
  }

  async createProcessingGraph(
    stream: MediaStream,
    config: AudioProcessingConfig,
  ): Promise<AudioProcessingGraph> {
    try {
      const latencyHint: AudioContextLatencyCategory | number =
        typeof config.analysisIntervalMs === "number"
          ? Math.max(config.analysisIntervalMs / 1000, 0.001)
          : DEFAULT_LATENCY_HINT;

      const context = new AudioContext({ latencyHint });
      const source = context.createMediaStreamSource(stream);
      const gainNode = context.createGain();
      const analyserNode = context.createAnalyser();

      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.8;
      analyserNode.minDecibels = -90;
      analyserNode.maxDecibels = -10;

      this.applyProcessingLevels(gainNode, config);

      source.connect(gainNode);
      gainNode.connect(analyserNode);

      await ensurePcmEncoderWorklet(context);
      const workletNode = new AudioWorkletNode(context, PCM_ENCODER_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });

      analyserNode.connect(workletNode);

      const graph: AudioProcessingGraph = {
        context,
        source,
        gainNode,
        analyserNode,
        workletNode,
      };

      this.metricsState.set(graph, {
        totalFrames: 0,
        droppedFrames: 0,
        lastAnalysisTimestamp: performance.now(),
        metrics: createEmptyMetrics(),
      });

      this.logger.debug("Audio processing graph created");
      return graph;
    } catch (error: any) {
      this.logger.error("Failed to create audio processing graph", {
        error: error?.message,
      });
      throw error;
    }
  }

  async updateProcessingParameters(
    graph: AudioProcessingGraph,
    config: Partial<AudioProcessingConfig>,
  ): Promise<void> {
    const { gainNode } = graph;
    this.applyProcessingLevels(gainNode, config);
    this.logger.debug("Audio processing parameters updated", { config });
  }

  analyzeAudioLevel(graph: AudioProcessingGraph): AudioMetrics {
    const state = this.metricsState.get(graph);
    if (!state) {
      return createEmptyMetrics();
    }

    const { analyserNode } = graph;
    const bufferLength = analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    analyserNode.getFloatTimeDomainData(dataArray);

    const peakLevel = calculatePeak(dataArray);
    const rmsLevel = calculateRms(dataArray);
    const snr = estimateSnr(dataArray);
    state.totalFrames += bufferLength;

    const now = performance.now();
    const analysisWindowMs = now - state.lastAnalysisTimestamp;
    state.lastAnalysisTimestamp = now;

    const metrics = mergeMetrics(state.metrics, {
      inputLevel: peakLevel,
      peakLevel,
      rmsLevel,
      signalToNoiseRatio: snr,
      bufferHealth: computeBufferHealth(state.totalFrames, state.droppedFrames),
      totalFrameCount: state.totalFrames,
      droppedFrameCount: state.droppedFrames,
      analysisWindowMs,
    });

    state.metrics = metrics;
    return metrics;
  }

  async measureLatency(context: AudioContext): Promise<number> {
    const baseLatency = context.baseLatency ?? 0;
    const outputLatency = (context as any).outputLatency ?? 0;
    return baseLatency + outputLatency;
  }

  disposeGraph(graph: AudioProcessingGraph): void {
    try {
      graph.source.disconnect();
      graph.gainNode.disconnect();
      graph.analyserNode.disconnect();
      graph.workletNode.disconnect();
      graph.workletNode.port.onmessage = null;
      graph.workletNode.port.onmessageerror = null;
      try {
        graph.workletNode.port.close();
      } catch (closeError: any) {
        this.logger.debug("Audio worklet port close failed", {
          error: closeError?.message,
        });
      }
    } catch (error: any) {
      this.logger.warn("Failed to fully disconnect processing graph", {
        error: error?.message,
      });
    }

    void graph.context.close();
    this.metricsState.delete(graph);
    this.logger.debug("Audio processing graph disposed");
  }

  private applyProcessingLevels(
    gainNode: GainNode,
    config: Partial<AudioProcessingConfig>,
  ): void {
    if (config.autoGainControlLevel) {
      const levelMap: Record<string, number> = {
        off: 1.0,
        low: 1.1,
        medium: 1.2,
        high: 1.35,
      };
      gainNode.gain.value =
        levelMap[config.autoGainControlLevel] ?? gainNode.gain.value;
    }
  }
}

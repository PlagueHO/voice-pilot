import { Logger } from "../core/logger";
import {
  AudioMetrics,
  AudioProcessingChain,
  AudioProcessingConfig,
  AudioProcessingGraph,
  RenderQuantumTelemetry,
} from "../types/audio-capture";
import {
  AudioContextProvider,
  sharedAudioContextProvider,
} from "./audio-context-provider";
import {
  calculatePeak,
  calculateRms,
  computeBufferHealth,
  createEmptyMetrics,
  DEFAULT_EXPECTED_RENDER_QUANTUM,
  estimateSnr,
  getTimestampMs,
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
  lastRenderQuantum: number;
  expectedRenderQuantum: number;
  renderUnderrunCount: number;
  renderOverrunCount: number;
  consecutiveUnderruns: number;
  lastRenderUnderrunAt?: number;
  renderFrameTotal: number;
  telemetryListeners: Set<RenderTelemetryListener>;
}

const DEFAULT_ANALYSIS_INTERVAL_MS = 100;

type RenderTelemetryListener = (telemetry: RenderQuantumTelemetry) => void;

/**
 * Creates and manages a Web Audio graph for microphone capture and analysis.
 */
export class WebAudioProcessingChain implements AudioProcessingChain {
  private readonly logger: Logger;
  private readonly audioContextProvider: AudioContextProvider;
  private readonly metricsState = new WeakMap<
    AudioProcessingGraph,
    MetricsState
  >();

  /**
   * Constructs a processing chain with optional overrides for logging and audio context provisioning.
   *
   * @param logger - Logger instance used for diagnostics; defaults to a scoped logger when omitted.
   * @param audioContextProvider - Provider responsible for supplying shared audio contexts.
   */
  constructor(logger?: Logger, audioContextProvider?: AudioContextProvider) {
    this.logger = logger || new Logger("WebAudioProcessingChain");
    this.audioContextProvider =
      audioContextProvider ?? sharedAudioContextProvider;
  }

  /**
   * Creates the Web Audio processing graph for the supplied media stream and configuration.
   *
   * @param stream - Input media stream containing audio tracks to process.
   * @param config - Processing configuration including gain and analysis parameters.
   * @returns Promise resolving with the constructed processing graph.
   */
  async createProcessingGraph(
    stream: MediaStream,
    config: AudioProcessingConfig,
  ): Promise<AudioProcessingGraph> {
    try {
      const context = await this.audioContextProvider.getOrCreateContext();
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
      const workletNode = new AudioWorkletNode(
        context,
        PCM_ENCODER_WORKLET_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        },
      );

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
        lastRenderQuantum: DEFAULT_EXPECTED_RENDER_QUANTUM,
        expectedRenderQuantum: DEFAULT_EXPECTED_RENDER_QUANTUM,
        renderUnderrunCount: 0,
        renderOverrunCount: 0,
        consecutiveUnderruns: 0,
        renderFrameTotal: 0,
        telemetryListeners: new Set<RenderTelemetryListener>(),
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

  /**
   * Applies updated processing parameters to an existing audio graph.
   *
   * @param graph - Existing graph whose nodes should be reconfigured.
   * @param config - Partial configuration with parameters to override.
   */
  async updateProcessingParameters(
    graph: AudioProcessingGraph,
    config: Partial<AudioProcessingConfig>,
  ): Promise<void> {
    const { gainNode } = graph;
    this.applyProcessingLevels(gainNode, config);
    this.logger.debug("Audio processing parameters updated", { config });
  }

  addRenderTelemetryListener(
    graph: AudioProcessingGraph,
    listener: RenderTelemetryListener,
  ): () => void {
    const state = this.metricsState.get(graph);
    if (!state) {
      this.logger.warn(
        "Attempted to register telemetry listener for unknown graph",
      );
      return () => {
        // no-op cleanup for unknown graph
      };
    }

    state.telemetryListeners.add(listener);
    return () => {
      state.telemetryListeners.delete(listener);
    };
  }

  removeRenderTelemetryListener(
    graph: AudioProcessingGraph,
    listener: RenderTelemetryListener,
  ): void {
    const state = this.metricsState.get(graph);
    state?.telemetryListeners.delete(listener);
  }

  ingestRenderTelemetry(
    graph: AudioProcessingGraph,
    telemetry: RenderQuantumTelemetry,
  ): void {
    const state = this.metricsState.get(graph);
    if (!state) {
      this.logger.debug("Render telemetry received for unknown audio graph");
      return;
    }

    const expected =
      telemetry.expectedFrameCount ?? state.expectedRenderQuantum;
    const frameCount = telemetry.frameCount ?? 0;
    const droppedFrames =
      telemetry.droppedFrames ?? Math.max(expected - frameCount, 0);
    const underrun = Boolean(telemetry.underrun);
    const overrun = Boolean(telemetry.overrun);
    const timestampMs = telemetry.timestamp ?? getTimestampMs();

    state.lastRenderQuantum = frameCount;
    state.expectedRenderQuantum = expected;
    state.renderFrameTotal += expected;
    state.droppedFrames += droppedFrames;

    if (underrun) {
      state.renderUnderrunCount += 1;
      state.consecutiveUnderruns += 1;
      state.lastRenderUnderrunAt = timestampMs;
      this.logger.warn("Audio worklet underrun detected", {
        frameCount,
        expected,
        droppedFrames,
        sequence: telemetry.sequence,
      });
    } else {
      state.consecutiveUnderruns = 0;
    }

    if (overrun) {
      state.renderOverrunCount += 1;
      this.logger.warn("Audio worklet overrun detected", {
        frameCount,
        expected,
        sequence: telemetry.sequence,
      });
    }

    state.metrics = mergeMetrics(state.metrics, {
      renderQuantumFrames: state.lastRenderQuantum,
      expectedRenderQuantumFrames: state.expectedRenderQuantum,
      renderUnderrunCount: state.renderUnderrunCount,
      renderOverrunCount: state.renderOverrunCount,
      renderDroppedFrameCount: state.droppedFrames,
      consecutiveUnderruns: state.consecutiveUnderruns,
      lastRenderUnderrunAt: state.lastRenderUnderrunAt,
    });

    this.notifyRenderTelemetry(state, {
      ...telemetry,
      expectedFrameCount: expected,
      frameCount,
      droppedFrames,
      timestamp: timestampMs,
    });
  }

  /**
   * Analyses the current audio level and aggregates metrics for the provided graph.
   *
   * @param graph - Graph whose analyser node should be sampled.
   * @returns The most recent set of audio metrics.
   */
  analyzeAudioLevel(graph: AudioProcessingGraph): AudioMetrics {
    const state = this.metricsState.get(graph);
    if (!state) {
      return createEmptyMetrics();
    }

    const { analyserNode } = graph;
    const bufferLength = analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    const start = getTimestampMs();
    analyserNode.getFloatTimeDomainData(dataArray);

    const peakLevel = calculatePeak(dataArray);
    const rmsLevel = calculateRms(dataArray);
    const snr = estimateSnr(dataArray);
    state.totalFrames += bufferLength;
    const totalRenderFrames =
      state.renderFrameTotal > 0 ? state.renderFrameTotal : state.totalFrames;

    const now = performance.now();
    const analysisWindowMs = now - state.lastAnalysisTimestamp;
    state.lastAnalysisTimestamp = now;
    const analysisDurationMs = getTimestampMs() - start;

    const metrics = mergeMetrics(state.metrics, {
      inputLevel: peakLevel,
      peakLevel,
      rmsLevel,
      signalToNoiseRatio: snr,
      bufferHealth: computeBufferHealth(totalRenderFrames, state.droppedFrames),
      totalFrameCount: totalRenderFrames,
      droppedFrameCount: state.droppedFrames,
      analysisWindowMs,
      analysisDurationMs,
    });

    state.metrics = metrics;
    return metrics;
  }

  /**
   * Estimates end-to-end audio latency for the given context.
   *
   * @param context - Audio context from which to read latency properties.
   * @returns Total latency in seconds derived from base and output latency values.
   */
  async measureLatency(context: AudioContext): Promise<number> {
    const baseLatency = context.baseLatency ?? 0;
    const outputLatency = (context as any).outputLatency ?? 0;
    return baseLatency + outputLatency;
  }

  /**
   * Disconnects and disposes of the nodes associated with the supplied processing graph.
   *
   * @param graph - Graph whose resources should be cleaned up.
   */
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

    const state = this.metricsState.get(graph);
    state?.telemetryListeners.clear();
    this.metricsState.delete(graph);
    this.logger.debug("Audio processing graph disposed");
  }

  /**
   * Derives gain levels based on configuration presets and applies them to the provided node.
   *
   * @param gainNode - Gain node whose value should be adjusted.
   * @param config - Partial processing configuration containing the desired automatic gain level.
   */
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

  private notifyRenderTelemetry(
    state: MetricsState,
    telemetry: RenderQuantumTelemetry,
  ): void {
    for (const listener of state.telemetryListeners) {
      try {
        listener(telemetry);
      } catch (error: any) {
        this.logger.error("Render telemetry listener failed", {
          error: error?.message,
        });
      }
    }
  }
}

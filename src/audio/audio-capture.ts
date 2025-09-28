import { Logger } from "../core/logger";
import {
  AudioCaptureConfig,
  AudioCaptureEventHandler,
  AudioCaptureEventType,
  AudioCapturePipeline,
  AudioCapturePipelineEvent,
  AudioMetrics,
  AudioProcessingConfig,
  AudioProcessingGraph,
  DeviceValidationResult,
  VoiceActivityResult,
} from "../types/audio-capture";
import { AudioErrorCode, AudioProcessingError } from "../types/audio-errors";
import { AudioConfiguration } from "../types/webrtc";
import {
  AudioContextProvider,
  sharedAudioContextProvider,
} from "./audio-context-provider";
import { createEmptyMetrics, mergeMetrics } from "./audio-metrics";
import { WebAudioProcessingChain } from "./audio-processing-chain";
import { AudioDeviceValidator } from "./device-validator";

const DEFAULT_CAPTURE_CONFIG: AudioCaptureConfig = {
  deviceId: undefined,
  sampleRate: 24000,
  channelCount: 1,
  bufferSize: 4096,
  latencyHint: "interactive",
  enableNoiseSuppression: true,
  enableEchoCancellation: true,
  enableAutoGainControl: true,
};

const DEFAULT_PROCESSING_CONFIG: AudioProcessingConfig = {
  noiseSuppressionLevel: "medium",
  echoCancellationLevel: "medium",
  autoGainControlLevel: "medium",
  voiceActivitySensitivity: 0.65,
  analysisIntervalMs: 100,
};

type EventHandlerSet = Set<AudioCaptureEventHandler>;

/**
 * Optional dependency overrides that allow the capture pipeline to run with custom collaborators.
 *
 * @remarks
 * Providing overrides is primarily intended for tests or advanced scenarios where the default
 * singleton {@link sharedAudioContextProvider} or processing chain must be replaced.
 */
interface AudioCaptureDependencies {
  audioContextProvider?: AudioContextProvider;
  processingChain?: WebAudioProcessingChain;
  deviceValidator?: AudioDeviceValidator;
}

/**
 * Audio capture service implementing the audio capture pipeline contract.
 * Provides microphone capture with noise suppression, audio metrics, and PCM output suitable for Azure OpenAI Realtime API.
 */
export class AudioCapture implements AudioCapturePipeline {
  private readonly logger: Logger;
  private readonly audioContextProvider: AudioContextProvider;
  private readonly processingChain: WebAudioProcessingChain;
  private readonly deviceValidator: AudioDeviceValidator;
  private readonly listeners = new Map<
    AudioCaptureEventType,
    EventHandlerSet
  >();
  private readonly audioDataCallbacks = new Set<(audioData: Buffer) => void>();

  private initialized = false;
  private isCapturing = false;

  private captureConfig: AudioCaptureConfig;
  private processingConfig: AudioProcessingConfig;

  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private processingGraph: AudioProcessingGraph | null = null;

  private metrics: AudioMetrics = createEmptyMetrics();
  private metricsTimerId?: ReturnType<typeof setInterval>;

  private onErrorCallback?: (error: Error) => void;
  private contextStateSubscription?: {
    context: AudioContext;
    listener: () => void;
  };

  /**
   * Creates a new audio capture pipeline instance.
   *
   * @param config - Optional capture configuration overrides applied to the defaults.
   * @param logger - Optional logger instance; if omitted a scoped logger is created.
   * @param dependencies - Optional dependency overrides enabling test seams or custom audio context providers.
   */
  constructor(
    config: Partial<AudioCaptureConfig> = {},
    logger?: Logger,
    dependencies: AudioCaptureDependencies = {},
  ) {
    this.logger = logger || new Logger("AudioCapture");
    this.audioContextProvider =
      dependencies.audioContextProvider ?? sharedAudioContextProvider;
    this.processingChain =
      dependencies.processingChain ??
      new WebAudioProcessingChain(this.logger, this.audioContextProvider);
    this.deviceValidator =
      dependencies.deviceValidator ?? new AudioDeviceValidator(this.logger);
    this.captureConfig = { ...DEFAULT_CAPTURE_CONFIG, ...config };
    this.processingConfig = { ...DEFAULT_PROCESSING_CONFIG };
  }

  /**
   * Initializes browser audio capture by validating device APIs and applying configuration overrides.
   *
   * @param config - Optional capture configuration overrides applied at initialization time.
   * @param processingConfig - Optional processing configuration overrides for the audio chain.
   * @throws {Error} When media device APIs are unavailable in the current environment.
   */
  async initialize(
    config?: Partial<AudioCaptureConfig>,
    processingConfig?: Partial<AudioProcessingConfig>,
  ): Promise<void> {
    if (config) {
      this.captureConfig = { ...this.captureConfig, ...config };
    }

    if (processingConfig) {
      this.processingConfig = { ...this.processingConfig, ...processingConfig };
    }

    this.configureAudioContextProvider();

    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error(
        "MediaDevices.getUserMedia is not available in this environment",
      );
    }

    await navigator.mediaDevices.enumerateDevices();
    this.initialized = true;
    this.logger.info("Audio capture initialized", {
      config: this.captureConfig,
      processingConfig: this.processingConfig,
    });
  }

  /**
   * Indicates whether initialization has completed successfully.
   *
   * @returns True when the capture pipeline has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Releases internal resources, stops capture, and clears handlers.
   */
  dispose(): void {
    void this.stopCapture();
    this.listeners.clear();
    this.audioDataCallbacks.clear();
    this.onErrorCallback = undefined;
    this.initialized = false;
  }

  /**
   * Starts microphone capture and processing, emitting audio data and metrics events.
   *
   * @throws {Error | AudioProcessingError} When device validation, stream acquisition, or graph setup fails.
   */
  async startCapture(): Promise<void> {
    if (!this.initialized) {
      throw new Error("Audio capture not initialized");
    }

    if (this.isCapturing) {
      this.logger.warn("Audio capture already active");
      return;
    }

    try {
      const validation = await this.deviceValidator.validateDevice(
        this.captureConfig.deviceId,
      );
      if (!validation.isValid) {
        const processingError =
          validation.error ??
          this.createProcessingError(
            AudioErrorCode.DeviceUnavailable,
            "Audio device validation failed",
            false,
          );
        throw processingError;
      }

      this.captureConfig.deviceId = validation.deviceId;

      const stream = await this.acquireStream(validation.deviceId);
      const graph = await this.processingChain.createProcessingGraph(
        stream,
        this.processingConfig,
      );
      await this.ensureContextIsRunning(graph.context);
    this.registerContextStateHandler(graph.context);

    this.stream = stream;
    this.track = stream.getAudioTracks()[0] ?? null;
    this.processingGraph = graph;

    this.registerWorkletMessageHandler();
      await this.updateLatencyMetric();
      this.startMetricsMonitor();

      this.isCapturing = true;
      this.logger.info("Audio capture started", {
        trackId: this.track?.id,
        deviceId: this.captureConfig.deviceId,
      });

      this.emitEvent("captureStarted", {
        streamId: this.stream?.id ?? "",
        trackId: this.track?.id ?? "",
        settings: this.track?.getSettings() ?? {},
      });

      if (this.track) {
        this.emitEvent("deviceChanged", {
          deviceId:
            this.track.getSettings().deviceId ??
            this.captureConfig.deviceId ??
            "default",
          label: this.track.label,
        });
      }
    } catch (error: any) {
      this.handleError("Failed to start audio capture", error);
      const thrownError =
        error instanceof Error
          ? error
          : new Error(
              (error as AudioProcessingError)?.message ??
                "Failed to start audio capture",
            );
      throw thrownError;
    }
  }

  /**
   * Stops microphone capture and tears down active processing resources.
   */
  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    const streamId = this.stream?.id;
    const trackId = this.track?.id;

    this.stopMetricsMonitor();

    if (this.processingGraph) {
      this.unregisterContextStateHandler();
      this.processingChain.disposeGraph(this.processingGraph);
    }
    this.processingGraph = null;

    this.stopStream();

    this.isCapturing = false;
    this.emitEvent("captureStopped", {
      streamId,
      trackId,
      reason: "user-request",
    });

    this.logger.info("Audio capture stopped");
  }

  /**
   * Retrieves the active media stream associated with the capture pipeline, if any.
   *
   * @returns The current `MediaStream` when capture is active; otherwise `null`.
   */
  getCaptureStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Retrieves the active media stream track associated with the capture pipeline, if any.
   *
   * @returns The current `MediaStreamTrack` when capture is active; otherwise `null`.
   */
  getCaptureTrack(): MediaStreamTrack | null {
    return this.track;
  }

  /**
   * Replaces the currently active capture track with a new device while keeping capture active.
   *
   * @param deviceId - Identifier of the desired audio input device.
   * @returns The new `MediaStreamTrack` sourced from the requested device.
   * @throws {Error | AudioProcessingError} When device validation fails or the new stream cannot be established.
   */
  async replaceCaptureTrack(deviceId: string): Promise<MediaStreamTrack> {
    let candidateStream: MediaStream | null = null;
    let candidateTrack: MediaStreamTrack | null = null;
    let candidateGraph: AudioProcessingGraph | null = null;

    try {
      const validation = await this.deviceValidator.validateDevice(deviceId);
      if (!validation.isValid) {
        const processingError =
          validation.error ??
          this.createProcessingError(
            AudioErrorCode.DeviceUnavailable,
            "Audio device validation failed",
            false,
          );
        throw processingError;
      }

      candidateStream = await this.acquireStream(validation.deviceId);
      candidateTrack = candidateStream.getAudioTracks()[0] ?? null;

      if (!candidateTrack) {
        throw new Error("Unable to obtain audio track from new device");
      }

      if (!this.isCapturing) {
        throw new Error(
          "Cannot replace capture track when audio capture is inactive",
        );
      }

      this.stopMetricsMonitor();
      if (this.processingGraph) {
        this.unregisterContextStateHandler();
        this.processingChain.disposeGraph(this.processingGraph);
        this.processingGraph = null;
      }
      this.stopStream();

      candidateGraph = await this.processingChain.createProcessingGraph(
        candidateStream,
        this.processingConfig,
      );
      await this.ensureContextIsRunning(candidateGraph.context);
    this.registerContextStateHandler(candidateGraph.context);

    this.stream = candidateStream;
    this.track = candidateTrack;
    this.processingGraph = candidateGraph;

    this.registerWorkletMessageHandler();
      await this.updateLatencyMetric();
      this.startMetricsMonitor();

      this.captureConfig.deviceId = validation.deviceId;
      this.emitEvent("deviceChanged", {
        deviceId: validation.deviceId,
        label: this.track?.label,
      });

      // Ownership transferred to class properties; prevent cleanup in finally block.
      candidateStream = null;
      candidateGraph = null;

      return this.track!;
    } catch (error: any) {
      if (candidateStream) {
        candidateStream.getTracks().forEach((track) => track.stop());
      }

      if (candidateGraph) {
        this.processingChain.disposeGraph(candidateGraph);
      }

      this.handleError("Failed to replace capture track", error);
      const thrownError =
        error instanceof Error
          ? error
          : new Error(
              (error as AudioProcessingError)?.message ??
                "Failed to replace capture track",
            );
      throw thrownError;
    }
  }

  /**
   * Updates the capture configuration and restarts capture if it is currently active.
   *
   * @param config - Partial capture configuration overrides to merge with existing settings.
   */
  async updateCaptureConfig(
    config: Partial<AudioCaptureConfig>,
  ): Promise<void> {
    this.captureConfig = { ...this.captureConfig, ...config };
    this.configureAudioContextProvider();

    if (this.isCapturing) {
      await this.restartCapture();
    }
  }

  /**
   * Applies new processing configuration values to the active audio processing graph.
   *
   * @param config - Partial processing configuration overrides to apply.
   */
  async updateProcessingConfig(
    config: Partial<AudioProcessingConfig>,
  ): Promise<void> {
    this.processingConfig = { ...this.processingConfig, ...config };

    if (this.processingGraph) {
      await this.processingChain.updateProcessingParameters(
        this.processingGraph,
        config,
      );
    }
  }

  /**
   * Runs validation checks for a given audio input device identifier.
   *
   * @param deviceId - The identifier of the device to validate.
   * @returns Validation details indicating whether the device can be used.
   */
  async validateAudioDevice(deviceId: string): Promise<DeviceValidationResult> {
    return this.deviceValidator.validateDevice(deviceId);
  }

  /**
   * Returns the most recent audio metrics collected from the processing chain.
   *
   * @returns Aggregated audio metrics including level, peak, RMS, and latency data.
   */
  getAudioMetrics(): AudioMetrics {
    return this.metrics;
  }

  /**
   * Returns the current input audio level in the range `[0, 1]`.
   *
   * @returns Normalized input level derived from the latest metrics.
   */
  getAudioLevel(): number {
    return this.metrics.inputLevel;
  }

  /**
   * Performs a voice activity detection check using the latest audio metrics.
   *
   * @returns Voice activity detection result including confidence and threshold data.
   */
  async detectVoiceActivity(): Promise<VoiceActivityResult> {
    const threshold = Math.min(
      Math.max(this.processingConfig.voiceActivitySensitivity, 0.05),
      0.95,
    );
    const isVoiceDetected = this.metrics.rmsLevel >= threshold;

    return {
      isVoiceDetected,
      confidence: Math.min(Math.max(this.metrics.rmsLevel, 0), 1),
      threshold,
      timestamp: Date.now(),
    };
  }

  /**
   * Adds an event handler for a capture pipeline event type.
   *
   * @typeParam TEvent - The specific event shape tied to the subscribed type.
   * @param type - The event type to subscribe to.
   * @param handler - Callback invoked when the event is emitted.
   * @returns void.
   */
  addEventListener<TEvent extends AudioCapturePipelineEvent>(
    type: TEvent["type"],
    handler: AudioCaptureEventHandler<TEvent>,
  ): void {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(handler as AudioCaptureEventHandler);
    this.listeners.set(type, handlers);
  }

  /**
   * Removes a previously registered event handler for a specific event type.
   *
   * @typeParam TEvent - The specific event shape tied to the subscribed type.
   * @param type - The event type to unsubscribe from.
   * @param handler - Callback reference to remove.
   * @returns void.
   */
  removeEventListener<TEvent extends AudioCapturePipelineEvent>(
    type: TEvent["type"],
    handler: AudioCaptureEventHandler<TEvent>,
  ): void {
    const handlers = this.listeners.get(type);
    handlers?.delete(handler as AudioCaptureEventHandler);
    if (handlers && handlers.size === 0) {
      this.listeners.delete(type);
    }
  }

  /**
   * Registers a callback to receive raw PCM audio buffers captured by the pipeline.
   *
   * @param callback - Function invoked with PCM16 audio buffers.
   */
  onAudioData(callback: (audioData: Buffer) => void): void {
    this.audioDataCallbacks.add(callback);
  }

  /**
   * Registers a callback invoked when unrecoverable errors occur within the capture pipeline.
   *
   * @param callback - Error handler receiving the surfaced error.
   */
  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Indicates whether audio capture is currently active.
   *
   * @returns True when the capture pipeline is running.
   */
  isCaptureActive(): boolean {
    return this.isCapturing;
  }

  /**
   * Requests a media stream from the browser using the active capture configuration.
   *
   * @param deviceId - Optional audio input device identifier to target.
   * @throws {@link AudioProcessingError} When the browser rejects the request.
   */
  private async acquireStream(deviceId?: string): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: this.captureConfig.channelCount,
        sampleRate: this.captureConfig.sampleRate,
        echoCancellation: this.captureConfig.enableEchoCancellation,
        noiseSuppression: this.captureConfig.enableNoiseSuppression,
        autoGainControl: this.captureConfig.enableAutoGainControl,
        deviceId: deviceId ? { exact: deviceId } : undefined,
      },
    };

    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error: any) {
      const processingError = this.mapGetUserMediaError(error, deviceId);
      throw processingError;
    }
  }

  /**
   * Registers handlers for PCM payloads emitted by the audio worklet backing the processing graph.
   *
   * @remarks
   * The worklet posts raw PCM16 buffers that are forwarded to registered audio data callbacks while capture is active.
   */
  private registerWorkletMessageHandler(): void {
    if (!this.processingGraph) {
      return;
    }

    const workletNode = this.processingGraph.workletNode;
    if (!workletNode) {
      this.logger.warn("Audio processing graph missing worklet node");
      return;
    }

    workletNode.port.onmessage = (event) => {
      if (!this.isCapturing) {
        return;
      }

      const payload = event.data;
      if (payload instanceof ArrayBuffer) {
        const pcmBuffer = Buffer.from(new Uint8Array(payload));
        this.notifyAudioCallbacks(pcmBuffer);
        return;
      }

      if (payload && (payload as { buffer?: ArrayBuffer }).buffer) {
        const bufferPayload = (payload as { buffer: ArrayBuffer }).buffer;
        const pcmBuffer = Buffer.from(new Uint8Array(bufferPayload));
        this.notifyAudioCallbacks(pcmBuffer);
        return;
      }

      this.logger.warn("Received unexpected payload from audio worklet", {
        type: typeof payload,
      });
    };

    workletNode.port.onmessageerror = (event) => {
      this.logger.error("Audio worklet port encountered a message error", {
        error: event,
      });
    };
  }

  /**
   * Derives the audio configuration used to provision the shared {@link AudioContextProvider} instance.
   *
   * @remarks
   * The Web Audio specification requires that consumers reuse a single `AudioContext` per document when possible.
   * This method synchronizes capture preferences with the shared provider before streams are acquired.
   */
  private configureAudioContextProvider(): void {
    const sampleRate = (this.captureConfig.sampleRate ?? 24000) as 24000;
    const audioConfiguration: AudioConfiguration = {
      sampleRate,
      format: "pcm16",
      channels: 1,
      echoCancellation: this.captureConfig.enableEchoCancellation,
      noiseSuppression: this.captureConfig.enableNoiseSuppression,
      autoGainControl: this.captureConfig.enableAutoGainControl,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: this.captureConfig.latencyHint ?? "interactive",
        resumeOnActivation: true,
        requiresUserGesture: false,
      },
      workletModuleUrls: [],
    };

    this.audioContextProvider.configure(audioConfiguration);
  }

  /**
   * Delivers a PCM buffer to registered audio data subscribers, shielding each callback from failures.
   *
   * @param audioData - PCM16 buffer emitted by the audio worklet.
   */
  private notifyAudioCallbacks(audioData: Buffer): void {
    for (const callback of this.audioDataCallbacks) {
      try {
        callback(audioData);
      } catch (error: any) {
        this.logger.error("Audio data callback failed", {
          error: error?.message,
        });
      }
    }
  }

  /**
   * Starts periodic metric sampling for audio levels, latency, and voice activity detection.
   */
  private startMetricsMonitor(): void {
    const interval =
      this.processingConfig.analysisIntervalMs ??
      DEFAULT_PROCESSING_CONFIG.analysisIntervalMs;
    this.metricsTimerId = setInterval(() => {
      void this.updateMetrics();
    }, interval);
  }

  /**
   * Stops the periodic metric sampling timer when capture is paused or disposed.
   */
  private stopMetricsMonitor(): void {
    if (typeof this.metricsTimerId !== "undefined") {
      clearInterval(this.metricsTimerId);
      this.metricsTimerId = undefined;
    }
  }

  /**
   * Updates aggregate audio metrics and emits telemetry events for listeners.
   */
  private async updateMetrics(): Promise<void> {
    if (!this.processingGraph) {
      return;
    }

    const metrics = this.processingChain.analyzeAudioLevel(
      this.processingGraph,
    );
    const latency = await this.processingChain.measureLatency(
      this.processingGraph.context,
    );

    this.metrics = mergeMetrics(metrics, { latencyEstimate: latency });

    this.emitEvent("metricsUpdated", this.metrics);
    this.emitEvent("audioLevelChanged", {
      level: this.metrics.inputLevel,
      peak: this.metrics.peakLevel,
      rms: this.metrics.rmsLevel,
    });

    const vad = await this.detectVoiceActivity();
    if (vad.isVoiceDetected) {
      this.emitEvent("voiceActivity", vad);
    }
  }

  /**
   * Refreshes the latency estimate for the active audio context.
   */
  private async updateLatencyMetric(): Promise<void> {
    if (!this.processingGraph) {
      return;
    }

    const latency = await this.processingChain.measureLatency(
      this.processingGraph.context,
    );
    this.metrics = mergeMetrics(this.metrics, { latencyEstimate: latency });
  }

  /**
   * Stops the active media stream and clears cached track references.
   */
  private stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    this.stream = null;
    this.track = null;
  }

  /**
   * Restarts capture when configuration changes require pipeline re-initialization.
   */
  private async restartCapture(): Promise<void> {
    const wasCapturing = this.isCapturing;
    await this.stopCapture();
    if (wasCapturing) {
      await this.startCapture();
    }
  }

  /**
   * Emits a typed capture pipeline event to registered listeners with best-effort error isolation.
   */
  private emitEvent<TType extends AudioCapturePipelineEvent["type"]>(
    type: TType,
    data?: Extract<AudioCapturePipelineEvent, { type: TType }>["data"],
  ): void {
    const handlers = this.listeners.get(type);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const event = {
      type,
      data,
      timestamp: Date.now(),
    } as AudioCapturePipelineEvent;

    handlers.forEach((handler) => {
      Promise.resolve(handler(event)).catch((error) => {
        this.logger.error("Audio capture event handler failed", {
          type,
          error: (error as Error)?.message,
        });
      });
    });
  }

  /**
   * Normalizes `getUserMedia` failures into the audio processing error contract.
   *
   * @param error - Browser error raised by `navigator.mediaDevices.getUserMedia`.
   * @param deviceId - Optional device identifier associated with the request.
   */
  private mapGetUserMediaError(
    error: any,
    deviceId?: string,
  ): AudioProcessingError {
    const name = error?.name;
    let code = AudioErrorCode.DeviceUnavailable;
    let recoverable = true;
    let message = error?.message ?? "Failed to access audio device";

    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        code = AudioErrorCode.PermissionDenied;
        recoverable = false;
        message =
          "Microphone access was denied by the user or browser settings";
        break;
      case "NotFoundError":
      case "OverconstrainedError":
        code = AudioErrorCode.DeviceNotFound;
        recoverable = false;
        message = deviceId
          ? `The requested audio device (${deviceId}) is not available`
          : "No suitable audio input device found";
        break;
      case "NotReadableError":
      case "DeviceInUseError":
      case "AbortError":
        code = AudioErrorCode.DeviceUnavailable;
        recoverable = true;
        message =
          "The selected audio device is currently in use or unavailable";
        break;
      case "NotSupportedError":
      case "TypeError":
        code = AudioErrorCode.ConfigurationInvalid;
        recoverable = false;
        message = "The current audio configuration is not supported";
        break;
      default:
        code = AudioErrorCode.ProcessingGraphFailed;
        recoverable = true;
    }

    return this.createProcessingError(code, message, recoverable, error);
  }

  /**
   * Resumes a suspended audio context and surfaces failures as processing errors.
   */
  private async ensureContextIsRunning(context: AudioContext): Promise<void> {
    if (context.state === "suspended") {
      try {
        await context.resume();
        this.logger.warn("Audio context resumed after suspension");
      } catch (error: any) {
        const processingError = this.createProcessingError(
          AudioErrorCode.ProcessingGraphFailed,
          "Failed to resume audio context",
          true,
          error,
        );
        this.emitEvent("processingError", processingError);
      }
    }
  }

  /**
   * Subscribes to the shared audio context state and attempts recovery when browsers suspend the context.
   */
  private registerContextStateHandler(context: AudioContext): void {
    this.unregisterContextStateHandler();

    const listener = () => {
      if (context.state === "suspended") {
        void context.resume().catch((error) => {
          const processingError = this.createProcessingError(
            AudioErrorCode.ProcessingGraphFailed,
            "Audio context suspended and failed to resume",
            true,
            error,
          );
          this.emitEvent("processingError", processingError);
          this.logger.error("Audio context suspension detected", {
            error: (error as Error)?.message,
          });
        });
      }
    };

    context.addEventListener("statechange", listener);
    this.contextStateSubscription = { context, listener };
  }

  /**
   * Removes the active audio context state listener, if present.
   */
  private unregisterContextStateHandler(): void {
    if (!this.contextStateSubscription) {
      return;
    }

    const { context, listener } = this.contextStateSubscription;
    context.removeEventListener("statechange", listener);
    this.contextStateSubscription = undefined;
  }

  /**
   * Builds a structured {@link AudioProcessingError} with contextual metadata for diagnostics.
   */
  private createProcessingError(
    code: AudioErrorCode,
    message: string,
    recoverable: boolean,
    cause?: unknown,
  ): AudioProcessingError {
    return {
      code,
      message,
      recoverable,
      timestamp: Date.now(),
      context: {
        deviceId: this.captureConfig.deviceId,
        trackId: this.track?.id,
        streamId: this.stream?.id,
        captureConfig: this.captureConfig,
        processingConfig: this.processingConfig,
        mediaDevicesSupported: !!navigator?.mediaDevices,
        getUserMediaSupported: !!navigator?.mediaDevices?.getUserMedia,
      },
      cause,
    };
  }

  /**
   * Routes errors through the pipeline’s error channel and invokes the external error callback.
   */
  private handleError(message: string, cause: any): void {
    if (this.isProcessingError(cause)) {
      this.emitEvent("processingError", cause);
      this.logger.error(message, { error: cause.message, code: cause.code });
      this.onErrorCallback?.(new Error(cause.message));
      return;
    }

    const error = cause instanceof Error ? cause : new Error(message);
    const processingError = this.createProcessingError(
      AudioErrorCode.ProcessingGraphFailed,
      message,
      true,
      cause,
    );
    this.emitEvent("processingError", processingError);
    this.logger.error(message, { error: error.message });
    this.onErrorCallback?.(error);
  }

  /**
   * Type guard ensuring an unknown value conforms to {@link AudioProcessingError} shape.
   */
  private isProcessingError(value: unknown): value is AudioProcessingError {
    return Boolean(
      value &&
        typeof value === "object" &&
        "code" in (value as Record<string, unknown>) &&
        "message" in (value as Record<string, unknown>),
    );
  }
}

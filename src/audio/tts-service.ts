import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { Logger } from "../core/logger";
import {
  ChunkMetadata,
  TextToSpeechService,
  TtsError,
  TtsPlaybackEvent,
  TtsPlaybackEventType,
  TtsPlaybackMetrics,
  TtsServiceConfig,
  TtsSpeakHandle,
  TtsSpeakRequest,
  TtsVoiceProfile,
} from "../types/tts";
import {
  AudioChunk,
  RealtimeAudioConfig,
  RealtimeAudioService,
} from "./realtime-audio-service";

interface CircuitBreakerState {
  failureTimestamps: number[];
  openUntil: number;
}

const CIRCUIT_BREAKER_WINDOW_MS = 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;

const DEFAULT_METRICS: TtsPlaybackMetrics = {
  averageChunkLatencyMs: 0,
  bufferedDurationMs: 0,
  totalChunks: 0,
  droppedChunks: 0,
  averageAudioLevel: 0,
  peakAudioLevel: 0,
  lastUpdated: 0,
};

type PlaybackEventListener = (event: TtsPlaybackEvent) => void;

type RealtimeServiceFactory = (
  config: RealtimeAudioConfig,
  logger: Logger,
) => RealtimeAudioService;

export class AzureRealtimeTextToSpeechService implements TextToSpeechService {
  private readonly logger: Logger;
  private readonly realtimeFactory: RealtimeServiceFactory;
  private readonly eventEmitter = new EventEmitter();

  private config: TtsServiceConfig | undefined;
  private realtimeService: RealtimeAudioService | undefined;
  private realtimeDisposables: Array<{ dispose(): void }> = [];
  private initialized = false;

  private activeHandle: TtsSpeakHandle | null = null;
  private handles = new Map<string, TtsSpeakHandle>();
  private metrics: TtsPlaybackMetrics = { ...DEFAULT_METRICS };
  private circuit: CircuitBreakerState = {
    failureTimestamps: [],
    openUntil: 0,
  };
  private fallbackActivated = false;
  private currentConversationItemHandleId: string | null = null;
  private conversationItemByHandle = new Map<string, string>();
  private bufferedChunks: ChunkMetadata[] = [];

  constructor(options?: {
    logger?: Logger;
    realtimeFactory?: RealtimeServiceFactory;
  }) {
    this.logger = options?.logger ?? new Logger("VoicePilot:TTS");
    this.realtimeFactory =
      options?.realtimeFactory ??
      ((config, logger) => new RealtimeAudioService(config, logger));
  }

  async initialize(): Promise<void>;
  async initialize(config: TtsServiceConfig): Promise<void>;
  async initialize(config?: TtsServiceConfig): Promise<void> {
    if (config) {
      this.applyConfig(config);
    }
    if (!this.config) {
      throw new Error("TTS configuration required for initialization");
    }

    if (this.initialized) {
      await this.disposeRealtime();
    }

    await this.createRealtimeService();
    this.initialized = true;
    this.logger.info("AzureRealtimeTextToSpeechService initialized");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    void this.disposeRealtime();
    this.handles.clear();
    this.activeHandle = null;
    this.initialized = false;
  }

  async speak(request: TtsSpeakRequest): Promise<TtsSpeakHandle> {
    this.ensureReady();

    if (this.isCircuitOpen()) {
      this.logger.warn("Circuit breaker open; entering degraded mode");
      this.activateFallback();
      throw this.asError(
        "STREAM_TIMEOUT",
        "Text-to-speech unavailable due to repeated failures",
        false,
      );
    }

    if (this.activeHandle) {
      await this.stop(this.activeHandle.id);
    }

    if (request.voice) {
      await this.updateVoiceProfile(request.voice);
    }

    const handle: TtsSpeakHandle = {
      id: randomUUID(),
      state: "pending",
      enqueuedAt: Date.now(),
    };
    this.handles.set(handle.id, handle);
    this.activeHandle = handle;
    this.currentConversationItemHandleId = handle.id;
    this.metrics = { ...DEFAULT_METRICS };
    this.bufferedChunks = [];
    this.emitPlaybackEvent("speaking-state-changed", handle, { state: "idle" });

    try {
      await this.ensureRealtimeSession();
      await this.sendSpeakRequest(request);
      this.logger.info("TTS speak request dispatched", { handleId: handle.id });
    } catch (error: any) {
      this.logger.error("Failed to start TTS request", {
        error: error?.message ?? error,
        handleId: handle.id,
      });
      this.markHandleFailed(
        handle,
        this.asError(
          "NETWORK_ERROR",
          error?.message ?? "Failed to start speech synthesis",
        ),
      );
      this.recordFailure();
      throw error;
    }

    return handle;
  }

  async stop(handleId?: string): Promise<void> {
    this.ensureReady();
    const target = handleId ? this.handles.get(handleId) : this.activeHandle;
    if (!target) {
      return;
    }

    try {
      await this.realtimeService?.cancelResponse();
      await this.realtimeService?.clearOutputAudioBuffer();
      const itemId = this.conversationItemByHandle.get(target.id);
      await this.realtimeService?.truncateConversation(itemId);
    } catch (error: any) {
      this.logger.warn("Error while stopping realtime response", {
        error: error?.message ?? error,
      });
    }

    target.state = "stopped";
    target.stoppedAt = Date.now();
    if (this.activeHandle?.id === target.id) {
      this.activeHandle = null;
    }
    this.emitPlaybackEvent("interrupted", target, { state: "idle" });
    this.emitPlaybackEvent("speaking-state-changed", target, { state: "idle" });
  }

  async pause(handleId: string): Promise<void> {
    this.ensureReady();
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new Error(`Handle ${handleId} not found`);
    }
    if (handle.state === "paused") {
      return;
    }
    handle.state = "paused";
    this.emitPlaybackEvent("speaking-state-changed", handle, {
      state: "paused",
    });
  }

  async resume(handleId: string): Promise<void> {
    this.ensureReady();
    const handle = this.handles.get(handleId);
    if (!handle) {
      throw new Error(`Handle ${handleId} not found`);
    }
    if (handle.state === "speaking") {
      return;
    }
    handle.state = "speaking";
    this.emitPlaybackEvent("speaking-state-changed", handle, {
      state: "speaking",
    });
  }

  async updateVoiceProfile(profile: Partial<TtsVoiceProfile>): Promise<void> {
    this.ensureReady();
    if (!this.config) {
      throw new Error("TTS configuration unavailable");
    }

    const merged: TtsVoiceProfile = {
      ...this.config.defaultVoice,
      ...profile,
    };
    this.config.defaultVoice = merged;

    if (!this.realtimeService) {
      return;
    }

    this.logger.info("Applying new voice profile", { voice: merged.name });
    try {
      await this.realtimeService.updateSessionConfig({ voice: merged.name });
    } catch (error: any) {
      this.logger.warn(
        "Failed to push voice profile update to existing session; reinitializing realtime service",
        { error: error?.message ?? error },
      );
      await this.initialize();
    }
  }

  onPlaybackEvent(listener: PlaybackEventListener) {
    this.eventEmitter.on("tts.event", listener);
    return { dispose: () => this.eventEmitter.off("tts.event", listener) };
  }

  getActiveHandle(): TtsSpeakHandle | null {
    return this.activeHandle;
  }

  getMetrics(): TtsPlaybackMetrics {
    return { ...this.metrics };
  }

  private applyConfig(config: TtsServiceConfig): void {
    this.config = { ...config, defaultVoice: { ...config.defaultVoice } };
    if (!this.config.apiVersion) {
      this.config.apiVersion = "2025-04-01-preview";
    }
  }

  private async createRealtimeService(): Promise<void> {
    if (!this.config) {
      throw new Error("Cannot create realtime service without configuration");
    }

    const transport = this.config.transport;
    if (transport !== "websocket" && transport !== "webrtc") {
      throw new Error(`Unsupported TTS transport: ${transport}`);
    }
    if (transport === "webrtc") {
      this.logger.warn(
        "WebRTC transport not yet implemented for TTS; falling back to WebSocket",
      );
    }

    const realtimeConfig: RealtimeAudioConfig = {
      endpoint: this.config.endpoint,
      deploymentName: this.config.deployment,
      apiVersion: this.config.apiVersion,
      outputAudioFormat: "pcm16",
      voice: this.config.defaultVoice.name,
      modalities: ["text", "audio"],
      turnDetection: {
        type: "none",
        createResponse: false,
        interruptResponse: true,
      },
    };

    this.realtimeService = this.realtimeFactory(realtimeConfig, this.logger);
    await this.realtimeService.initialize();
    this.registerRealtimeHandlers();
  }

  private registerRealtimeHandlers(): void {
    if (!this.realtimeService) {
      return;
    }

    this.disposeRealtimeHandlers();

    this.realtimeService.onAudioChunk((chunk) => this.handleAudioChunk(chunk));
    this.realtimeService.onTranscript((transcript) =>
      this.handleTranscript(transcript.text),
    );
    this.realtimeService.onError((error) => this.handleRealtimeError(error));
    this.realtimeService.onSessionState((state) =>
      this.logger.debug("Realtime session state", { state }),
    );

    const realtimeSubscription = this.realtimeService.onRealtimeMessage(
      (message) => this.handleRealtimeMessage(message),
    );
    this.realtimeDisposables.push(realtimeSubscription);
  }

  private async disposeRealtime(): Promise<void> {
    this.disposeRealtimeHandlers();
    this.realtimeService?.dispose();
    this.realtimeService = undefined;
  }

  private disposeRealtimeHandlers(): void {
    for (const disposable of this.realtimeDisposables.splice(0)) {
      try {
        disposable.dispose();
      } catch (error: any) {
        this.logger.warn("Failed to dispose realtime handler", {
          error: error?.message ?? error,
        });
      }
    }
  }

  private async ensureRealtimeSession(): Promise<void> {
    if (!this.realtimeService) {
      await this.createRealtimeService();
    }
    if (!this.realtimeService?.getIsConnected()) {
      await this.realtimeService?.startSession();
    }
  }

  private async sendSpeakRequest(request: TtsSpeakRequest): Promise<void> {
    if (!this.realtimeService) {
      throw new Error("Realtime service not ready");
    }

    const prosody = request.prosody ?? this.config?.defaultProsody ?? {};
    if (prosody && Object.keys(prosody).length > 0) {
      await this.realtimeService.updateSessionConfig({ prosody });
    }

    await this.realtimeService.sendTextMessage(request.text);
  }

  private handleAudioChunk(chunk: AudioChunk): void {
    if (!this.activeHandle) {
      this.logger.debug("Audio chunk received without active handle; dropping");
      return;
    }

    if (this.activeHandle.state === "pending") {
      this.activeHandle.state = "speaking";
      this.activeHandle.startedAt = Date.now();
      this.emitPlaybackEvent("speaking-state-changed", this.activeHandle, {
        state: "speaking",
      });
    }

    const latencyMs = Date.now() - this.activeHandle.enqueuedAt;
    this.updateMetrics(chunk, latencyMs);

    const chunkBase64 = chunk.data.toString("base64");
    this.emitPlaybackEvent("chunk-received", this.activeHandle, {
      chunkSize: chunk.data.length,
      chunkBase64,
      latencyMs,
    });

    this.bufferedChunks.push({
      sequence: this.metrics.totalChunks,
      durationMs: this.estimateChunkDuration(chunk.data.length),
      transcript: undefined,
    });
  }

  private handleTranscript(transcriptDelta: string): void {
    const handle = this.activeHandle;
    if (!handle) {
      return;
    }
    this.emitPlaybackEvent("chunk-received", handle, { transcriptDelta });
  }

  private handleRealtimeMessage(message: { type: string; data: any }): void {
    switch (message.type) {
      case "response.done":
        this.handleResponseComplete();
        break;
      case "response.error":
        this.handleRealtimeError(
          new Error(message.data?.error?.message ?? "Realtime error"),
        );
        break;
      case "conversation.item.created":
        this.handleConversationItemCreated(message.data);
        break;
      default:
        break;
    }
  }

  private handleConversationItemCreated(event: any): void {
    if (!this.currentConversationItemHandleId || !event?.item?.id) {
      return;
    }
    const handleId = this.currentConversationItemHandleId;
    this.conversationItemByHandle.set(handleId, event.item.id);
    if (event.item.role === "assistant") {
      this.currentConversationItemHandleId = null;
    }
  }

  private handleResponseComplete(): void {
    const handle = this.activeHandle;
    if (!handle) {
      return;
    }
    handle.state = "completed";
    handle.stoppedAt = Date.now();
    this.emitPlaybackEvent("playback-complete", handle, { state: "idle" });
    this.emitPlaybackEvent("speaking-state-changed", handle, { state: "idle" });
    this.activeHandle = null;
    this.resetCircuitBreaker();
  }

  private handleRealtimeError(error: Error): void {
    this.logger.error("Realtime TTS error", { error: error.message });
    const handle = this.activeHandle;
    const ttsError = this.asError("NETWORK_ERROR", error.message, true);
    if (handle) {
      this.markHandleFailed(handle, ttsError);
    }
    this.recordFailure();
  }

  private markHandleFailed(handle: TtsSpeakHandle, error: TtsError): void {
    handle.state = "failed";
    handle.stoppedAt = Date.now();
    handle.error = error;
    if (this.activeHandle?.id === handle.id) {
      this.activeHandle = null;
    }
    this.emitPlaybackEvent("playback-error", handle, { error, state: "idle" });
  }

  private emitPlaybackEvent(
    type: TtsPlaybackEventType,
    handle: TtsSpeakHandle,
    data?: TtsPlaybackEvent["data"],
  ): void {
    const event: TtsPlaybackEvent = {
      type,
      handleId: handle.id,
      timestamp: Date.now(),
      data,
    };
    this.eventEmitter.emit("tts.event", event);
  }

  private updateMetrics(chunk: AudioChunk, latencyMs: number): void {
    this.metrics.totalChunks += 1;
    this.metrics.averageChunkLatencyMs = this.incrementalAverage(
      this.metrics.averageChunkLatencyMs,
      latencyMs,
      this.metrics.totalChunks,
    );
    this.metrics.bufferedDurationMs = this.bufferedChunks.reduce(
      (sum, entry) => sum + entry.durationMs,
      0,
    );
    this.metrics.lastUpdated = Date.now();
    this.emitPlaybackEvent("metrics-updated", this.activeHandle!, {
      metrics: { ...this.metrics },
    });
  }

  private incrementalAverage(
    currentAverage: number,
    newValue: number,
    totalSamples: number,
  ): number {
    if (totalSamples === 0) {
      return newValue;
    }
    return currentAverage + (newValue - currentAverage) / totalSamples;
  }

  private estimateChunkDuration(bytes: number): number {
    // PCM16, mono => 2 bytes per sample. Assume 24kHz sample rate.
    const samples = bytes / 2;
    const durationSeconds = samples / 24_000;
    return durationSeconds * 1000;
  }

  private activateFallback(): void {
    if (this.fallbackActivated) {
      return;
    }
    this.fallbackActivated = true;
    const handle = this.activeHandle;
    if (handle) {
      this.emitPlaybackEvent("interrupted", handle, {
        state: "idle",
        error: this.asError(
          "STREAM_TIMEOUT",
          "Entering text-only fallback mode",
          false,
        ),
      });
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    this.circuit.failureTimestamps.push(now);
    this.circuit.failureTimestamps = this.circuit.failureTimestamps.filter(
      (ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS,
    );
    if (this.circuit.failureTimestamps.length >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuit.openUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }

  private resetCircuitBreaker(): void {
    this.circuit.failureTimestamps = [];
    this.circuit.openUntil = 0;
    this.fallbackActivated = false;
  }

  private isCircuitOpen(): boolean {
    if (this.circuit.openUntil === 0) {
      return false;
    }
    if (Date.now() > this.circuit.openUntil) {
      this.resetCircuitBreaker();
      return false;
    }
    return true;
  }

  private asError(
    code: TtsError["code"],
    message: string,
    recoverable = true,
  ): TtsError {
    return { code, message, recoverable };
  }

  private ensureReady(): void {
    if (!this.config) {
      throw new Error("TTS service not configured");
    }
  }
}

export type { AzureRealtimeTextToSpeechService as DefaultTtsService };

import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import { AudioTrackState, AudioTrackStatistics } from "../types/audio-capture";
import {
    AudioConfiguration,
    ConnectionQuality,
    ConnectionStatistics,
    WebRTCErrorCode,
    WebRTCErrorImpl,
    WebRTCTransport,
} from "../types/webrtc";
import {
    AudioContextProvider,
    AudioGraphNodes,
    sharedAudioContextProvider,
} from "./audio-context-provider";

const QUALITY_MONITOR_DEFAULT_INTERVAL_MS = 2000;

type CaptureGraphContext = {
  inputStream: MediaStream;
  inputTrack: MediaStreamTrack;
  graph: AudioGraphNodes;
};

/**
 * Manages audio tracks for WebRTC communication
 * Handles microphone capture, track management, quality monitoring, and seamless device switching.
 */
export class AudioTrackManager implements ServiceInitializable {
  private initialized = false;
  private readonly logger: Logger;
  private readonly audioContextProvider: AudioContextProvider;

  private audioConfiguration?: AudioConfiguration;

  private localStream: MediaStream | null = null;
  private readonly localTracks = new Map<string, MediaStreamTrack>();
  private readonly trackStreams = new Map<string, MediaStream>();
  private readonly remoteStreams = new Map<string, MediaStream>();
  private readonly captureGraphs = new Map<string, CaptureGraphContext>();
  private readonly remotePlaybackSources = new Map<
    string,
    MediaStreamAudioSourceNode
  >();

  private readonly trackStateHandlers = new Set<
    (trackId: string, state: AudioTrackState) => void
  >();
  private readonly trackMuteHandlers = new Set<
    (trackId: string, muted: boolean) => void
  >();
  private readonly trackQualityHandlers = new Set<
    (quality: ConnectionQuality, statistics?: ConnectionStatistics) => void
  >();

  private qualityMonitorTimer?: ReturnType<typeof setInterval>;
  private qualityMonitorTransport: WebRTCTransport | null = null;
  private qualityMonitorInterval = QUALITY_MONITOR_DEFAULT_INTERVAL_MS;
  private lastConnectionQuality?: ConnectionQuality;

  private audioConstraints: MediaTrackConstraints = {
    sampleRate: 24000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  constructor(logger?: Logger, audioContextProvider?: AudioContextProvider) {
    this.logger = logger || new Logger("AudioTrackManager");
    this.audioContextProvider =
      audioContextProvider ?? sharedAudioContextProvider;
  }

  setAudioConfiguration(configuration: AudioConfiguration): void {
    this.audioConfiguration = configuration;
    this.audioContextProvider.configure(configuration);

    this.audioConstraints = {
      sampleRate: configuration.sampleRate,
      channelCount: configuration.channels,
      echoCancellation: configuration.echoCancellation ?? true,
      noiseSuppression: configuration.noiseSuppression ?? true,
      autoGainControl: configuration.autoGainControl ?? true,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info("Initializing AudioTrackManager");

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia not supported in this environment");
    }

    this.initialized = true;
    this.logger.info("AudioTrackManager initialized successfully");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info("Disposing AudioTrackManager");

    this.stopQualityMonitor();
    this.stopAllLocalTracks();
    this.clearRemoteStreams();

    this.trackStateHandlers.clear();
    this.trackMuteHandlers.clear();
    this.trackQualityHandlers.clear();
    this.trackStreams.clear();

    this.initialized = false;
    this.logger.info("AudioTrackManager disposed");
  }

  async captureMicrophone(
    customConstraints?: MediaTrackConstraints,
  ): Promise<MediaStreamTrack> {
    this.ensureInitialized();

    if (!this.audioConfiguration) {
      throw new Error(
        "Audio configuration not set. Call setAudioConfiguration() before capturing.",
      );
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia not supported in this environment");
    }

    const constraints = {
      audio: {
        ...this.audioConstraints,
        ...customConstraints,
      },
    } as MediaStreamConstraints;

    this.logger.debug("Requesting microphone access", { constraints });

  let inputStream: MediaStream | undefined;
  let processedStream: MediaStream | undefined;
  let captureContext: CaptureGraphContext | undefined;

    try {
      inputStream = await navigator.mediaDevices.getUserMedia(constraints);
      const inputTrack = inputStream.getAudioTracks()[0];

      if (!inputTrack) {
        inputStream.getTracks().forEach((track) => track.stop());
        throw new Error("Failed to obtain audio track from microphone");
      }

      const processed = await this.createProcessedTrackForStream(inputStream);
      processedStream = processed.processedStream;
      captureContext = {
        inputStream,
        inputTrack,
        graph: processed.graph,
      };

      this.registerProcessedTrack(
        processed.processedTrack,
        processed.processedStream,
        captureContext,
      );

      captureContext = undefined;
      processedStream = undefined;
      inputStream = undefined;

      this.logger.info("Microphone captured successfully", {
        trackId: processed.processedTrack.id,
        label: inputTrack.label,
        settings: inputTrack.getSettings(),
      });

      return processed.processedTrack;
    } catch (error: any) {
      this.logger.error("Failed to capture microphone", {
        error: error?.message,
      });

      if (captureContext && processedStream) {
        this.disposePendingCaptureContext(captureContext, processedStream);
      } else if (inputStream) {
        inputStream.getTracks().forEach((track) => track.stop());
      }

      if (error?.name === "NotAllowedError") {
        throw new WebRTCErrorImpl({
          code: WebRTCErrorCode.AudioTrackFailed,
          message: "Microphone access denied by user",
          details: error,
          recoverable: false,
          timestamp: new Date(),
        });
      }

      if (error?.name === "NotFoundError") {
        throw new WebRTCErrorImpl({
          code: WebRTCErrorCode.AudioTrackFailed,
          message: "No microphone device found",
          details: error,
          recoverable: false,
          timestamp: new Date(),
        });
      }

      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to capture microphone: ${error?.message ?? "unknown error"}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  async addTrackToTransport(
    transport: WebRTCTransport,
    track: MediaStreamTrack,
  ): Promise<void> {
    try {
      await transport.addAudioTrack(track);
      this.logger.debug("Audio track added to transport", {
        trackId: track.id,
      });
    } catch (error: any) {
      this.logger.error("Failed to add track to transport", {
        error: error?.message,
      });
      throw error;
    }
  }

  async removeTrackFromTransport(
    transport: WebRTCTransport,
    track: MediaStreamTrack,
  ): Promise<void> {
    try {
      await transport.removeAudioTrack(track);
      this.localTracks.delete(track.id);
      this.stopStreamForTrack(track.id);
      this.emitTrackStateById(track.id, true);
      this.logger.debug("Audio track removed from transport", {
        trackId: track.id,
      });
    } catch (error: any) {
      this.logger.error("Failed to remove track from transport", {
        error: error?.message,
      });
      throw error;
    }
  }

  async replaceTrack(
    transport: WebRTCTransport,
    newTrack: MediaStreamTrack,
    processedStream: MediaStream,
    captureContext: CaptureGraphContext,
    currentTrackId?: string,
  ): Promise<void> {
    this.ensureInitialized();

    const existingTrackId = currentTrackId ?? this.getPrimaryTrackId();
    const existingTrack = existingTrackId
      ? this.localTracks.get(existingTrackId)
      : undefined;

    try {
      const supportsReplace =
        typeof (
          transport as unknown as {
            replaceAudioTrack?: (
              oldTrack: MediaStreamTrack,
              newTrack: MediaStreamTrack,
            ) => Promise<void>;
          }
        ).replaceAudioTrack === "function";

      if (existingTrack && supportsReplace) {
        await (
          transport as unknown as {
            replaceAudioTrack: (
              oldTrack: MediaStreamTrack,
              newTrack: MediaStreamTrack,
            ) => Promise<void>;
          }
        ).replaceAudioTrack(existingTrack, newTrack);
        this.logger.debug(
          "Replaced audio track using transport replaceAudioTrack",
          { oldTrackId: existingTrack.id, newTrackId: newTrack.id },
        );
      } else {
        if (existingTrack) {
          await transport.removeAudioTrack(existingTrack);
          this.logger.debug("Removed existing track prior to replacement", {
            trackId: existingTrack.id,
          });
        }

        await transport.addAudioTrack(newTrack);
        this.logger.debug("Added new audio track to transport", {
          trackId: newTrack.id,
        });
      }

      if (existingTrack) {
        this.localTracks.delete(existingTrack.id);
        this.stopStreamForTrack(existingTrack.id);
        existingTrack.stop();
      }

      this.registerProcessedTrack(newTrack, processedStream, captureContext);
    } catch (error: any) {
      this.logger.error("Failed to replace audio track", {
        error: error?.message,
      });
      this.disposePendingCaptureContext(captureContext, processedStream);
      throw error;
    }
  }

  handleRemoteStream(stream: MediaStream, streamId?: string): void {
    const id = streamId ?? stream.id;
    this.remoteStreams.set(id, stream);
    this.logger.debug("Remote stream registered", {
      streamId: id,
      trackCount: stream.getTracks().length,
    });
    void this.setupAudioPlayback(stream, id);
  }

  getLocalTracks(): MediaStreamTrack[] {
    return Array.from(this.localTracks.values());
  }

  getRemoteStreams(): MediaStream[] {
    return Array.from(this.remoteStreams.values());
  }

  stopTrack(trackId: string): void {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return;
    }

    track.stop();
    this.localTracks.delete(trackId);
    this.stopStreamForTrack(trackId);
    this.emitTrackStateById(trackId, true);
    this.logger.debug("Audio track stopped", { trackId });
  }

  stopAllLocalTracks(): void {
    const trackIds = Array.from(this.localTracks.keys());
    for (const trackId of trackIds) {
      const track = this.localTracks.get(trackId);
      track?.stop();
      this.stopStreamForTrack(trackId);
      this.localTracks.delete(trackId);
    }

    this.trackStreams.clear();
    this.captureGraphs.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.logger.info("All local audio tracks stopped");
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return;
    }

    track.enabled = !muted;
    const captureGraph = this.captureGraphs.get(trackId);
    if (captureGraph) {
      captureGraph.inputTrack.enabled = !muted;
    }
    this.emitTrackMuted(trackId, muted);
    this.emitTrackState(track);
    this.logger.debug("Track mute state changed", { trackId, muted });
  }

  getTrackStatistics(
    track: MediaStreamTrack,
    statistics?: ConnectionStatistics,
  ): AudioTrackStatistics {
    const settings = track.getSettings();
    const capabilities =
      typeof track.getCapabilities === "function"
        ? track.getCapabilities()
        : undefined;
    const connectionStats = statistics ?? this.tryGetConnectionStatistics();
    const durationSeconds = connectionStats
      ? Math.max(connectionStats.connectionDurationMs / 1000, 1)
      : undefined;
    const bitrate =
      connectionStats && durationSeconds
        ? (connectionStats.audioBytesSent * 8) / durationSeconds
        : undefined;

    return {
      trackId: track.id,
      label: track.label,
      kind: track.kind,
      enabled: track.enabled,
      muted: track.muted,
      state: track.readyState,
      sampleRate: settings.sampleRate,
      channelCount: settings.channelCount,
      bitrate,
      jitter: connectionStats?.jitter,
      packetsLost: connectionStats?.packetsLost,
      audioLevel: connectionStats
        ? this.estimateAudioLevel(connectionStats.connectionQuality)
        : undefined,
      framesPerSecond: settings.frameRate,
      settings,
      capabilities,
    };
  }

  getTrackState(trackId: string): AudioTrackState | null {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return null;
    }

    return {
      trackId,
      state: track.readyState,
      muted: track.muted,
      enabled: track.enabled,
      ready: track.readyState === "live",
      ended: track.readyState === "ended",
    };
  }

  adjustAudioQuality(quality: ConnectionQuality): void {
    switch (quality) {
      case ConnectionQuality.Excellent:
        this.audioConstraints = {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        break;
      case ConnectionQuality.Good:
        this.audioConstraints = {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        break;
      case ConnectionQuality.Fair:
      case ConnectionQuality.Poor:
        this.audioConstraints = {
          sampleRate: 8000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        break;
      case ConnectionQuality.Failed:
        break;
    }

    this.emitQualityChanged(quality, this.tryGetConnectionStatistics());
    this.logger.debug("Audio quality adjusted", {
      quality,
      constraints: this.audioConstraints,
    });
  }

  async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "audioinput");
    } catch (error: any) {
      this.logger.error("Failed to enumerate audio devices", {
        error: error?.message,
      });
      return [];
    }
  }

  async switchAudioDevice(
    deviceId: string,
    transport?: WebRTCTransport,
  ): Promise<MediaStreamTrack> {
    this.ensureInitialized();

    if (!this.audioConfiguration) {
      throw new Error(
        "Audio configuration not set. Call setAudioConfiguration() before switching devices.",
      );
    }

    const constraints: MediaStreamConstraints = {
      audio: {
        ...this.audioConstraints,
        deviceId: { exact: deviceId },
      },
    };

    let inputStream: MediaStream | undefined;
    let processedStream: MediaStream | undefined;
    let captureContext: CaptureGraphContext | undefined;

    try {
      inputStream = await navigator.mediaDevices.getUserMedia(constraints);
      const inputTrack = inputStream.getAudioTracks()[0];

      if (!inputTrack) {
        throw new Error("Failed to obtain audio track when switching devices");
      }

      const processed = await this.createProcessedTrackForStream(inputStream);
      processedStream = processed.processedStream;
      captureContext = {
        inputStream,
        inputTrack,
        graph: processed.graph,
      };

      if (transport && this.localTracks.size > 0) {
        await this.replaceTrack(
          transport,
          processed.processedTrack,
          processed.processedStream,
          captureContext,
        );
      } else {
        this.stopAllLocalTracks();
        this.registerProcessedTrack(
          processed.processedTrack,
          processed.processedStream,
          captureContext,
        );
      }

      captureContext = undefined;
      processedStream = undefined;
      inputStream = undefined;

      this.logger.info("Audio device switched", {
        deviceId,
        trackId: processed.processedTrack.id,
      });
      return processed.processedTrack;
    } catch (error: any) {
      if (captureContext && processedStream) {
        this.disposePendingCaptureContext(captureContext, processedStream);
      } else if (inputStream) {
        inputStream.getTracks().forEach((track) => track.stop());
      }

      this.logger.error("Failed to switch audio device", {
        deviceId,
        error: error?.message,
      });
      throw error;
    }
  }

  onTrackQualityChanged(
    handler: (
      quality: ConnectionQuality,
      statistics?: ConnectionStatistics,
    ) => void,
  ): void {
    this.trackQualityHandlers.add(handler);
  }

  onTrackStateChanged(
    handler: (trackId: string, state: AudioTrackState) => void,
  ): void {
    this.trackStateHandlers.add(handler);
  }

  onTrackMuted(handler: (trackId: string, muted: boolean) => void): void {
    this.trackMuteHandlers.add(handler);
  }

  startQualityMonitor(
    transport: WebRTCTransport,
    intervalMs = QUALITY_MONITOR_DEFAULT_INTERVAL_MS,
  ): void {
    this.stopQualityMonitor();
    this.qualityMonitorTransport = transport;
    this.qualityMonitorInterval = intervalMs;
    this.qualityMonitorTimer = setInterval(
      () => this.pollConnectionQuality(),
      intervalMs,
    );
  }

  stopQualityMonitor(): void {
    if (this.qualityMonitorTimer) {
      clearInterval(this.qualityMonitorTimer);
      this.qualityMonitorTimer = undefined;
    }
    this.qualityMonitorTransport = null;
    this.lastConnectionQuality = undefined;
  }

  private pollConnectionQuality(): void {
    if (!this.qualityMonitorTransport) {
      return;
    }

    try {
      const stats = this.qualityMonitorTransport.getConnectionStatistics();
      if (!stats) {
        return;
      }

      if (
        !this.lastConnectionQuality ||
        this.lastConnectionQuality !== stats.connectionQuality
      ) {
        this.lastConnectionQuality = stats.connectionQuality;
        this.emitQualityChanged(stats.connectionQuality, stats);
      }
    } catch (error: any) {
      this.logger.warn("Failed to poll connection quality", {
        error: error?.message,
      });
    }
  }

  private emitQualityChanged(
    quality: ConnectionQuality,
    statistics?: ConnectionStatistics,
  ): void {
    for (const handler of this.trackQualityHandlers) {
      try {
        handler(quality, statistics);
      } catch (error: any) {
        this.logger.error("Track quality handler failed", {
          error: error?.message,
        });
      }
    }
  }

  private emitTrackState(track: MediaStreamTrack): void {
    const state: AudioTrackState = {
      trackId: track.id,
      state: track.readyState,
      muted: track.muted,
      enabled: track.enabled,
      ready: track.readyState === "live",
      ended: track.readyState === "ended",
    };

    for (const handler of this.trackStateHandlers) {
      try {
        handler(track.id, state);
      } catch (error: any) {
        this.logger.error("Track state handler failed", {
          error: error?.message,
        });
      }
    }
  }

  private emitTrackStateById(trackId: string, ended: boolean): void {
    const state: AudioTrackState = {
      trackId,
      state: ended ? "ended" : "live",
      muted: true,
      enabled: false,
      ready: !ended,
      ended,
    };

    for (const handler of this.trackStateHandlers) {
      try {
        handler(trackId, state);
      } catch (error: any) {
        this.logger.error("Track state handler failed", {
          error: error?.message,
        });
      }
    }
  }

  private emitTrackMuted(trackId: string, muted: boolean): void {
    for (const handler of this.trackMuteHandlers) {
      try {
        handler(trackId, muted);
      } catch (error: any) {
        this.logger.error("Track mute handler failed", {
          error: error?.message,
        });
      }
    }
  }

  private setupTrackEventHandlers(track: MediaStreamTrack): void {
    track.addEventListener("ended", () => {
      this.logger.warn("Audio track ended", { trackId: track.id });
      this.localTracks.delete(track.id);
      this.stopStreamForTrack(track.id);
      this.emitTrackState(track);
    });

    track.addEventListener("mute", () => {
      this.logger.debug("Audio track muted", { trackId: track.id });
      this.emitTrackMuted(track.id, true);
      this.emitTrackState(track);
    });

    track.addEventListener("unmute", () => {
      this.logger.debug("Audio track unmuted", { trackId: track.id });
      this.emitTrackMuted(track.id, false);
      this.emitTrackState(track);
    });
  }

  private async setupAudioPlayback(
    stream: MediaStream,
    streamId: string,
  ): Promise<void> {
    try {
      const sourceNode = await this.audioContextProvider.connectStreamToDestination(
        stream,
      );
      this.remotePlaybackSources.set(streamId, sourceNode);
      this.logger.debug("Remote audio ready for playback", { streamId });
    } catch (error: any) {
      this.logger.error("Audio playback error", {
        streamId,
        error: error?.message,
      });
    }
  }

  private async createProcessedTrackForStream(
    stream: MediaStream,
  ): Promise<{
    processedTrack: MediaStreamTrack;
    processedStream: MediaStream;
    graph: AudioGraphNodes;
  }> {
    const graph = await this.audioContextProvider.createGraphForStream(stream);
    const processedStream = graph.destination.stream;
    const processedTrack = processedStream.getAudioTracks()[0];

    if (!processedTrack) {
      this.logger.error("Processed audio stream did not yield a track", {
        streamId: stream.id,
      });
      graph.source.disconnect();
      graph.processor.disconnect();
      try {
        graph.destination.disconnect();
      } catch (error: any) {
        this.logger.debug("Destination disconnect skipped", {
          streamId: stream.id,
          error: error?.message,
        });
      }
      throw new Error("Failed to create processed audio track");
    }

    return { processedTrack, processedStream, graph };
  }

  private registerProcessedTrack(
    track: MediaStreamTrack,
    processedStream: MediaStream,
    context: CaptureGraphContext,
  ): void {
    this.captureGraphs.set(track.id, context);
    this.localTracks.set(track.id, track);
    this.trackStreams.set(track.id, processedStream);
    this.localStream = processedStream;
    this.setupTrackEventHandlers(track);
    this.emitTrackState(track);
  }

  private disposeCaptureGraph(trackId: string): void {
    const context = this.captureGraphs.get(trackId);
    if (!context) {
      return;
    }

    try {
      context.graph.source.disconnect();
    } catch (error: any) {
      this.logger.warn("Failed to disconnect source node", {
        trackId,
        error: error?.message,
      });
    }

    try {
      context.graph.processor.disconnect();
      context.graph.processor.port.close();
    } catch (error: any) {
      this.logger.warn("Failed to dispose processor node", {
        trackId,
        error: error?.message,
      });
    }

    try {
      context.graph.destination.disconnect();
    } catch (error: any) {
      this.logger.debug("Destination node disconnect skipped", {
        trackId,
        error: error?.message,
      });
    }

    context.inputStream.getTracks().forEach((inputTrack) => inputTrack.stop());
    const processedStream = context.graph.destination.stream;
    processedStream.getTracks().forEach((processedTrack) =>
      processedTrack.stop(),
    );

    this.captureGraphs.delete(trackId);
  }

  private disposePendingCaptureContext(
    context: CaptureGraphContext,
    processedStream: MediaStream,
  ): void {
    try {
      context.graph.source.disconnect();
    } catch (error: any) {
      this.logger.debug("Pending source disconnect failure", {
        error: error?.message,
      });
    }

    try {
      context.graph.processor.disconnect();
      context.graph.processor.port.close();
    } catch (error: any) {
      this.logger.debug("Pending processor disposal failure", {
        error: error?.message,
      });
    }

    try {
      context.graph.destination.disconnect();
    } catch (error: any) {
      this.logger.debug("Pending destination disconnect failure", {
        error: error?.message,
      });
    }

    context.inputStream.getTracks().forEach((track) => track.stop());
    processedStream.getTracks().forEach((track) => track.stop());
  }

  private clearRemoteStreams(): void {
    for (const [streamId, stream] of this.remoteStreams) {
      const sourceNode = this.remotePlaybackSources.get(streamId);
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch (error: any) {
          this.logger.warn("Failed to disconnect remote playback source", {
            streamId,
            error: error?.message,
          });
        }
        this.remotePlaybackSources.delete(streamId);
      }
      stream.getTracks().forEach((track) => track.stop());
      this.logger.debug("Remote stream cleared", { streamId });
    }
    this.remoteStreams.clear();
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "AudioTrackManager not initialized. Call initialize() first.",
      );
    }
  }

  private stopStreamForTrack(trackId: string): void {
    const stream = this.trackStreams.get(trackId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      this.trackStreams.delete(trackId);
    }

    this.disposeCaptureGraph(trackId);
  }

  private getPrimaryTrackId(): string | undefined {
    const iterator = this.localTracks.keys();
    const result = iterator.next();
    return result.done ? undefined : result.value;
  }

  private tryGetConnectionStatistics(): ConnectionStatistics | undefined {
    try {
      return this.qualityMonitorTransport?.getConnectionStatistics();
    } catch (error: any) {
      this.logger.warn("Unable to retrieve connection statistics", {
        error: error?.message,
      });
      return undefined;
    }
  }

  private estimateAudioLevel(quality: ConnectionQuality): number {
    switch (quality) {
      case ConnectionQuality.Excellent:
        return 0.9;
      case ConnectionQuality.Good:
        return 0.75;
      case ConnectionQuality.Fair:
        return 0.55;
      case ConnectionQuality.Poor:
        return 0.35;
      case ConnectionQuality.Failed:
      default:
        return 0.1;
    }
  }
}

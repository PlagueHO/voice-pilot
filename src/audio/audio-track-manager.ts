import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import {
  AudioCaptureSampleRate,
  AudioTrackState,
  AudioTrackStatistics,
} from "../types/audio-capture";
import {
  AudioConfiguration,
  AudioTrackRegistrationOptions,
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

  /**
   * Creates a new audio track manager that coordinates capture, processing, and playback resources.
   * @param logger - Optional logger for emitting diagnostic messages.
   * @param audioContextProvider - Optional provider that supplies shared audio graph resources.
   */
  constructor(logger?: Logger, audioContextProvider?: AudioContextProvider) {
    this.logger = logger || new Logger("AudioTrackManager");
    this.audioContextProvider =
      audioContextProvider ?? sharedAudioContextProvider;
  }

  /**
   * Applies the supplied audio configuration and primes the audio graph for future captures.
   * @param configuration - The configuration describing sample rate, channels, and DSP options.
   */
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

  /**
   * Initializes the manager and validates that required browser APIs are available.
   * @throws {Error} If the execution environment does not expose `navigator.mediaDevices`.
   */
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

  /**
   * Indicates whether the manager has completed the initialization sequence.
   * @returns `true` when initialization succeeded, otherwise `false`.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Releases all active audio resources and resets handler registrations.
   */
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

  /**
   * Captures audio from the microphone, applies processing, and returns a managed track.
   * @param customConstraints - Optional media constraints to merge with the configured defaults.
   * @returns The processed microphone track ready to add to a transport.
   * @throws {WebRTCErrorImpl} When device access fails or the capture pipeline cannot be built.
   */
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

  /**
   * Registers a processed audio track with the provided WebRTC transport.
   * @param transport - The transport responsible for publishing audio frames.
   * @param track - The processed track created by this manager.
   */
  async addTrackToTransport(
    transport: WebRTCTransport,
    track: MediaStreamTrack,
  ): Promise<void> {
    try {
      const processedStream = this.trackStreams.get(track.id);
      const captureContext = this.captureGraphs.get(track.id);
      const audioContext = await this.audioContextProvider.getOrCreateContext();

      const registrationOptions: AudioTrackRegistrationOptions = {
        processedStream,
        sourceStream: captureContext?.inputStream,
        audioContext,
        metadata: {
          graphNodes: captureContext?.graph ? "active" : "missing",
        },
      };

      await transport.addAudioTrack(track, registrationOptions);
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

  /**
   * Removes a track from the transport and disposes of associated resources.
   * @param transport - The transport that currently owns the track.
   * @param track - The track instance to remove.
   */
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

  /**
   * Swaps the active transport track with a newly processed capture stream.
   * @param transport - The transport that should publish the new track.
   * @param newTrack - The replacement audio track.
   * @param processedStream - The processed stream associated with the replacement track.
   * @param captureContext - Graph and source metadata used for diagnostics and disposal.
   * @param currentTrackId - Optional identifier of the track to replace when not using the primary.
   */
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
      const audioContext = await this.audioContextProvider.getOrCreateContext();
      const registrationOptions: AudioTrackRegistrationOptions = {
        processedStream,
        sourceStream: captureContext.inputStream,
        audioContext,
        metadata: {
          graphNodes: "active",
        },
      };

      const supportsReplace =
        typeof (
          transport as unknown as {
            replaceAudioTrack?: (
              oldTrack: MediaStreamTrack,
              newTrack: MediaStreamTrack,
              options?: AudioTrackRegistrationOptions,
            ) => Promise<void>;
          }
        ).replaceAudioTrack === "function";

      if (existingTrack && supportsReplace) {
        await (
          transport as unknown as {
            replaceAudioTrack: (
              oldTrack: MediaStreamTrack,
              newTrack: MediaStreamTrack,
              options?: AudioTrackRegistrationOptions,
            ) => Promise<void>;
          }
        ).replaceAudioTrack(existingTrack, newTrack, registrationOptions);
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

        await transport.addAudioTrack(newTrack, registrationOptions);
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

  /**
   * Registers an incoming remote stream and primes it for playback through the shared audio context.
   * @param stream - The remote media stream received from the transport.
   * @param streamId - Optional identifier to use when tracking the stream internally.
   */
  handleRemoteStream(stream: MediaStream, streamId?: string): void {
    const id = streamId ?? stream.id;
    this.remoteStreams.set(id, stream);
    this.logger.debug("Remote stream registered", {
      streamId: id,
      trackCount: stream.getTracks().length,
    });
    void this.setupAudioPlayback(stream, id);
  }

  /**
   * Returns all locally managed tracks that are currently active.
   * @returns An array containing each local media stream track.
   */
  getLocalTracks(): MediaStreamTrack[] {
    return Array.from(this.localTracks.values());
  }

  /**
   * Returns all remote streams that have been registered for playback.
   * @returns An array of remote media streams.
   */
  getRemoteStreams(): MediaStream[] {
    return Array.from(this.remoteStreams.values());
  }

  /**
   * Stops the specified local track and disposes its processing graph.
   * @param trackId - Identifier of the track to stop.
   */
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

  /**
   * Stops and clears all locally managed tracks along with their processed streams.
   */
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

  /**
   * Updates the muted state of the specified track and reflects the change downstream.
   * @param trackId - Identifier of the track to control.
   * @param muted - Indicates whether the track should be muted.
   */
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

  /**
   * Builds a snapshot of intrinsic track details and optional transport statistics.
   * @param track - The media track to inspect.
   * @param statistics - Connection statistics reported by the transport layer, if available.
   * @returns Track metadata and derived metrics such as bitrate and jitter.
   */
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

  /**
   * Retrieves the current lifecycle state for a managed track.
   * @param trackId - Identifier of the track of interest.
   * @returns The track state when managed or `null` if the track is unknown.
   */
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

  /**
   * Adjusts capture constraints based on observed connection quality and notifies listeners.
   * @param quality - The quality classification reported by the transport diagnostics.
   */
  adjustAudioQuality(quality: ConnectionQuality): void {
    let targetSampleRate: AudioCaptureSampleRate | null = null;

    switch (quality) {
      case ConnectionQuality.Excellent:
        targetSampleRate = 48000;
        break;
      case ConnectionQuality.Good:
        targetSampleRate = 24000;
        break;
      case ConnectionQuality.Fair:
      case ConnectionQuality.Poor:
        targetSampleRate = 16000;
        break;
      case ConnectionQuality.Failed:
        targetSampleRate = null;
        break;
    }

    if (targetSampleRate !== null) {
      this.audioConstraints = {
        sampleRate: targetSampleRate,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
    }

    this.emitQualityChanged(quality, this.tryGetConnectionStatistics());
    this.logger.debug("Audio quality adjusted", {
      quality,
      constraints: this.audioConstraints,
    });
  }

  /**
   * Enumerates available audio input devices, returning only microphone-capable entries.
   * @returns A filtered list of media devices representing audio inputs.
   */
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

  /**
   * Switches the active audio input to the specified device and updates the transport when supplied.
   * @param deviceId - Identifier of the desired audio input device.
   * @param transport - Optional transport to receive the newly captured track.
   * @returns The processed track sourced from the selected device.
   */
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

  /**
   * Registers a handler that is invoked when aggregate connection quality changes.
   * @param handler - Callback receiving the updated quality classification and optional statistics.
   */
  onTrackQualityChanged(
    handler: (
      quality: ConnectionQuality,
      statistics?: ConnectionStatistics,
    ) => void,
  ): void {
    this.trackQualityHandlers.add(handler);
  }

  /**
   * Registers a handler to observe state transitions for managed tracks.
   * @param handler - Callback receiving the track identifier and its derived state information.
   */
  onTrackStateChanged(
    handler: (trackId: string, state: AudioTrackState) => void,
  ): void {
    this.trackStateHandlers.add(handler);
  }

  /**
   * Registers a handler that fires when a track's mute status changes locally or via device events.
   * @param handler - Callback receiving the track identifier and the new muted flag.
   */
  onTrackMuted(handler: (trackId: string, muted: boolean) => void): void {
    this.trackMuteHandlers.add(handler);
  }

  /**
   * Starts polling the transport for connection statistics on a fixed interval.
   * @param transport - The WebRTC transport that exposes connection statistics.
   * @param intervalMs - Optional polling cadence in milliseconds.
   */
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

  /**
   * Stops the quality monitor and clears any cached diagnostics.
   */
  stopQualityMonitor(): void {
    if (this.qualityMonitorTimer) {
      clearInterval(this.qualityMonitorTimer);
      this.qualityMonitorTimer = undefined;
    }
    this.qualityMonitorTransport = null;
    this.lastConnectionQuality = undefined;
  }

  /**
   * Polls the active transport for fresh connection statistics and emits
   * quality change notifications when the classification has shifted.
   */
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

  /**
   * Notifies listeners that the aggregate connection quality has changed.
   * @param quality - Latest quality classification determined by the transport.
   * @param statistics - Optional connection statistics associated with the sample.
   */
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

  /**
   * Emits a lifecycle snapshot for the provided media track to registered listeners.
   * @param track - Media track whose state should be announced.
   */
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

  /**
   * Emits a lifecycle snapshot for a track by identifier when the underlying track is unavailable.
   * @param trackId - Identifier of the track whose state is being synthesized.
   * @param ended - Indicates whether the track has completed playback.
   */
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

  /**
   * Notifies listeners that the mute state for a track has changed.
   * @param trackId - Identifier of the track whose mute state changed.
   * @param muted - Current mute flag for the track.
   */
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

  /**
   * Registers listeners on the supplied track to react to lifecycle events and propagate updates.
   * @param track - Media track that should be monitored for lifecycle changes.
   */
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

  /**
   * Connects the provided stream to the shared audio context for playback and stores its source node.
   * @param stream - Remote media stream that should be rendered to the destination.
   * @param streamId - Identifier used to track the playback resources associated with the stream.
   */
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

  /**
   * Creates a processed audio track by routing the provided stream through the configured graph.
   * @param stream - Raw media stream that will be processed.
   * @returns Processed track, its owning stream, and the constructed graph nodes.
   */
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

  /**
   * Registers a processed track and its associated resources for lifecycle management.
   * @param track - Processed audio track produced by the capture pipeline.
   * @param processedStream - Media stream that owns the processed track.
   * @param context - Capture graph and source information used for disposal.
   */
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

  /**
   * Disposes the capture graph and associated streams for the specified track identifier.
   * @param trackId - Identifier of the track whose capture graph should be released.
   */
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

  /**
   * Disposes a capture context that failed to register completely, stopping any temporary streams.
   * @param context - Capture graph context containing the partially constructed nodes.
   * @param processedStream - Stream associated with the processed track that needs to be stopped.
   */
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

  /**
   * Clears all registered remote streams and detaches their playback nodes.
   */
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

  /**
   * Ensures the manager has been initialized before executing operations that require setup.
   * @throws {Error} When the manager has not completed initialization.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "AudioTrackManager not initialized. Call initialize() first.",
      );
    }
  }

  /**
   * Stops and removes the processed stream associated with the provided track identifier.
   * @param trackId - Identifier of the track whose processed stream should be halted.
   */
  private stopStreamForTrack(trackId: string): void {
    const stream = this.trackStreams.get(trackId);
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      this.trackStreams.delete(trackId);
    }

    this.disposeCaptureGraph(trackId);
  }

  /**
   * Retrieves the identifier of the first managed track, typically representing the primary capture path.
   * @returns Identifier of the primary track when available; otherwise `undefined`.
   */
  private getPrimaryTrackId(): string | undefined {
    const iterator = this.localTracks.keys();
    const result = iterator.next();
    return result.done ? undefined : result.value;
  }

  /**
   * Safely retrieves connection statistics from the monitored transport, logging on failure.
   * @returns Current connection statistics when available.
   */
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

  /**
   * Estimates an audio level heuristic for the provided connection quality classification.
   * @param quality - Connection quality classification used to derive the audio level.
   * @returns Normalized audio level in the range `[0, 1]`.
   */
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

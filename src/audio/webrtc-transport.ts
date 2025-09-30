import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import type {
  RealtimeEvent,
  SessionUpdateEvent,
} from "../types/realtime-events";
import {
  AudioTrackRegistrationOptions,
  ConnectionQuality,
  ConnectionResult,
  ConnectionStatistics,
  RecoveryEventPayload,
  WebRTCConfig,
  WebRTCConnectionState,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  WebRTCEvent,
  WebRTCEventHandler,
  WebRTCEventType,
  WebRTCSessionConfiguration,
  WebRTCTransport,
} from "../types/webrtc";

type TrackRegistrationState = {
  sender: RTCRtpSender;
  options?: AudioTrackRegistrationOptions;
};

/**
 * WebRTC transport implementation for Azure OpenAI Realtime API
 * Provides low-latency, full-duplex audio communication with Azure endpoints
 *
 * Based on Azure OpenAI Realtime Audio Quickstart patterns with WebRTC transport
 */
export class WebRTCTransportImpl
  implements WebRTCTransport, ServiceInitializable
{
  private initialized = false;
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private connectionState: WebRTCConnectionState =
    WebRTCConnectionState.Disconnected;
  private connectionId: string = "";
  private logger: Logger;
  private fallbackActive = false;
  private pendingDataChannelMessages: RealtimeEvent[] = [];
  private isFlushingQueue = false;
  private readonly maxQueuedMessages = 100;

  // Event handling
  private eventHandlers = new Map<WebRTCEventType, Set<WebRTCEventHandler>>();

  // Audio tracks
  private localTracks = new Set<MediaStreamTrack>();
  private trackRegistrations = new Map<string, TrackRegistrationState>();
  private remoteStream: MediaStream | null = null;
  private audioContextRef: AudioContext | null = null;

  // Connection statistics
  private connectionStartTime: number = 0;
  private statsInterval: NodeJS.Timeout | null = null;
  private statsIntervalMs = 5000;
  private statsCollectionInProgress = false;
  private latestConnectionStatistics: ConnectionStatistics | null = null;
  private lastConnectionQuality: ConnectionQuality | null = null;
  private negotiationTimeoutHandle: NodeJS.Timeout | null = null;
  private lastNegotiationDurationMs: number | null = null;
  private readonly negotiationTimeoutMs = 5000;

  // Current configuration
  private config: WebRTCConfig | null = null;

  /**
   * Creates a new WebRTC transport for handling realtime audio sessions.
   * @param logger Optional logger instance for emitting diagnostic output.
   */
  constructor(logger?: Logger) {
    this.logger = logger || new Logger("WebRTCTransport");
    this.connectionId = this.generateConnectionId();
  }

  /**
   * Initializes the transport and prepares it for connection establishment.
   * @returns A promise that resolves when initialization has completed.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info("Initializing WebRTC transport");
    this.initialized = true;
  }

  /**
   * Indicates whether the transport has been initialized.
   * @returns True when {@link initialize} has been called successfully.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Disposes all resources associated with the transport instance.
   */
  dispose(): void {
    this.logger.info("Disposing WebRTC transport");
    this.closeConnection();
    this.eventHandlers.clear();
    this.initialized = false;
  }

  // Connection lifecycle
  /**
   * Establishes a new WebRTC connection using the provided configuration.
   * @param config WebRTC configuration containing endpoint and session details.
   * @returns Connection result describing success and any associated metadata.
   */
  async establishConnection(config: WebRTCConfig): Promise<ConnectionResult> {
    this.ensureInitialized();

    if (this.connectionState === WebRTCConnectionState.Connected) {
      this.logger.warn("Connection already established");
      return this.createConnectionResult(true);
    }

    try {
      this.config = config;
      this.setConnectionState(WebRTCConnectionState.Connecting);
      this.connectionStartTime = Date.now();

      // Create peer connection with ICE servers
      this.peerConnection = new RTCPeerConnection({
        iceServers: config.connectionConfig?.iceServers || [
          { urls: "stun:stun.l.google.com:19302" },
        ],
      });

      // Set up event handlers
      this.setupPeerConnectionHandlers();

      // Create data channel for realtime events
      const initialChannel = this.peerConnection.createDataChannel(
        config.dataChannelConfig?.channelName || "realtime-channel",
        {
          ordered: config.dataChannelConfig?.ordered ?? true,
          maxRetransmits: config.dataChannelConfig?.maxRetransmits,
        },
      );

      this.attachDataChannel(initialChannel, "local");

      // Create SDP offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      await this.peerConnection.setLocalDescription(offer);

      // Send SDP offer to Azure endpoint with authentication
      const response = await this.performNegotiationWithTimeout(config, offer);

      // Set remote description from Azure response
      const answer = new RTCSessionDescription({
        type: "answer",
        sdp: response.sdp,
      });

      await this.peerConnection.setRemoteDescription(answer);

      // Wait for connection to be established
      await this.waitForConnection(
        config.connectionConfig?.connectionTimeoutMs || 5000,
      );

      this.setConnectionState(WebRTCConnectionState.Connected);
      this.emitConnectionDiagnostics({});

      // Start statistics monitoring
      this.startStatisticsMonitoring();

      this.logger.info("WebRTC connection established successfully", {
        connectionId: this.connectionId,
        endpoint: config.endpoint.url,
      });

      return this.createConnectionResult(true);
    } catch (error: any) {
      this.logger.error("Failed to establish WebRTC connection", {
        error: error.message,
      });
      this.setConnectionState(WebRTCConnectionState.Failed);

      const webrtcError = new WebRTCErrorImpl({
        code: this.classifyError(error),
        message: error.message,
        details: error,
        recoverable: this.isRecoverableError(error),
        timestamp: new Date(),
      });

      return this.createConnectionResult(false, webrtcError);
    }
  }

  /**
   * Closes the active WebRTC connection and releases associated resources.
   * @returns A promise that resolves when teardown has completed.
   */
  async closeConnection(): Promise<void> {
    this.logger.info("Closing WebRTC connection");

    this.stopStatisticsMonitoring();
    this.clearNegotiationTimer();
    this.statsCollectionInProgress = false;
    this.latestConnectionStatistics = null;
    this.lastConnectionQuality = null;
    this.lastNegotiationDurationMs = null;

    // Close data channel
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    this.pendingDataChannelMessages = [];
    this.isFlushingQueue = false;
    this.fallbackActive = false;

    // Stop all local tracks
    for (const track of this.localTracks) {
      track.stop();
    }
    this.localTracks.clear();
    this.trackRegistrations.clear();
    this.audioContextRef = null;

    // Close peer connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.remoteStream = null;
    this.setConnectionState(WebRTCConnectionState.Closed);
  }

  /**
   * Attempts to restart ICE negotiation using the current peer connection.
   * @param config WebRTC configuration used for renewed negotiation.
   * @returns True when ICE restarts successfully; otherwise false.
   */
  async restartIce(config: WebRTCConfig): Promise<boolean> {
    if (!this.peerConnection) {
      this.logger.warn("Cannot restart ICE without peer connection");
      return false;
    }

    const timeoutMs = config.connectionConfig?.connectionTimeoutMs ?? 5000;

    try {
      if (typeof this.peerConnection.restartIce === "function") {
        try {
          this.peerConnection.restartIce();
        } catch (error: any) {
          this.logger.debug("peerConnection.restartIce threw", {
            error: error?.message ?? error,
          });
        }
      }

      const offer = await this.peerConnection.createOffer({
        iceRestart: true,
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });

      await this.peerConnection.setLocalDescription(offer);

      const response = await this.performNegotiationWithTimeout(config, offer);

      const answer = new RTCSessionDescription({
        type: "answer",
        sdp: response.sdp,
      });

      await this.peerConnection.setRemoteDescription(answer);

      await this.waitForConnection(timeoutMs);

      this.logger.info("ICE restart completed successfully", {
        connectionId: this.connectionId,
      });

      this.emitConnectionDiagnostics({});

      return true;
    } catch (error: any) {
      this.logger.error("ICE restart failed", {
        error: error?.message ?? error,
      });
      return false;
    }
  }

  /**
   * Recreates the data channel with the provided configuration.
   * @param config WebRTC configuration that supplies the data channel options.
   * @returns The newly opened data channel, or null if recreation failed.
   */
  async recreateDataChannel(
    config: WebRTCConfig,
  ): Promise<RTCDataChannel | null> {
    if (!this.peerConnection) {
      this.logger.warn("Cannot recreate data channel without peer connection");
      return null;
    }

    const channelConfig = config.dataChannelConfig ?? {
      channelName: "realtime-channel",
      ordered: true,
    };

    this.logger.info("Recreating data channel", {
      channelName: channelConfig.channelName,
    });

    if (this.dataChannel) {
      this.detachDataChannelHandlers(this.dataChannel);
      try {
        this.dataChannel.close();
      } catch (error: any) {
        this.logger.debug("Error closing existing data channel", {
          error: error?.message ?? error,
        });
      }
      this.dataChannel = null;
    }

    const newChannel = this.peerConnection.createDataChannel(
      channelConfig.channelName,
      {
        ordered: channelConfig.ordered,
        maxRetransmits: channelConfig.maxRetransmits,
      },
    );

    this.attachDataChannel(newChannel, "local");

    const opened = await this.waitForDataChannelOpen(newChannel, 3000);

    if (!opened) {
      this.logger.warn("Data channel did not open within timeout");
      return null;
    }

    return newChannel;
  }

  /**
   * Gets the current data channel state or "unavailable" when no channel exists.
   * @returns The current {@link RTCDataChannelState} or a sentinel string value.
   */
  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return this.dataChannel?.readyState ?? "unavailable";
  }

  /**
   * Indicates whether the transport is operating in data-channel fallback mode.
   * @returns True when fallback is active due to channel unavailability.
   */
  isDataChannelFallbackActive(): boolean {
    return this.fallbackActive;
  }

  /**
   * Publishes a recovery event to listening observers.
   * @param event Recovery event payload describing reconnect attempts/outcomes.
   */
  publishRecoveryEvent(event: RecoveryEventPayload): void {
    const timestamp = new Date();

    switch (event.type) {
      case "reconnectAttempt":
        this.emitEvent({
          type: "reconnectAttempt",
          connectionId: this.connectionId,
          timestamp,
          data: {
            strategy: event.strategy,
            attempt: event.attempt,
            delayMs: event.delayMs,
          },
        });
        break;
      case "reconnectSucceeded":
      case "reconnectFailed":
        this.emitEvent({
          type: event.type,
          connectionId: this.connectionId,
          timestamp,
          data: {
            strategy: event.strategy,
            attempt: event.attempt,
            durationMs: event.durationMs,
            error: event.type === "reconnectFailed" ? event.error : undefined,
          },
        });
        break;
      default:
        ((_: never) => {
          // Exhaustive check - no runtime action needed
        })(event);
    }
  }

  // Connection state
  /**
   * Retrieves the current WebRTC connection state.
   * @returns The current {@link WebRTCConnectionState} value.
   */
  getConnectionState(): WebRTCConnectionState {
    return this.connectionState;
  }

  /**
   * Returns the latest sampled connection statistics.
   * @returns A copy of the connection statistics snapshot.
   */
  getConnectionStatistics(): ConnectionStatistics {
    const snapshot =
      this.latestConnectionStatistics ?? this.computeConnectionStatistics();

    return { ...snapshot };
  }

  // Audio stream management
  /**
   * Adds an audio track to the active peer connection.
   * @param track Media stream track to register.
   * @param options Optional registration metadata and related streams.
   * @throws {@link WebRTCErrorImpl} when the track fails to register.
   */
  async addAudioTrack(
    track: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("No active peer connection");
    }

    try {
      const streams: MediaStream[] = [];

      if (options?.processedStream) {
        this.ensureStreamContainsTrack(options.processedStream, track);
        streams.push(options.processedStream);
      }

      if (
        options?.sourceStream &&
        options.sourceStream !== options.processedStream
      ) {
        this.ensureStreamContainsTrack(options.sourceStream, track);
        streams.push(options.sourceStream);
      }

      if (streams.length === 0) {
        const fallbackStream = new MediaStream([track]);
        streams.push(fallbackStream);
      }

      const sender = this.peerConnection.addTrack(track, ...streams);

      this.localTracks.add(track);
      this.trackRegistrations.set(track.id, {
        sender,
        options,
      });

      if (options?.audioContext) {
        this.audioContextRef = options.audioContext;
      }

      this.logger.debug("Audio track added", {
        trackId: track.id,
        metadata: options?.metadata,
      });

      this.emitLocalTrackEvent("audioTrackAdded", track, options);
    } catch (error: any) {
      this.logger.error("Failed to add audio track", { error: error.message });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to add audio track: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Replaces an existing audio track with a new one on the peer connection.
   * @param oldTrack Track currently registered with the connection.
   * @param newTrack Replacement track to attach.
   * @param options Optional registration details for the new track.
   * @throws {@link WebRTCErrorImpl} when replacement fails.
   */
  async replaceAudioTrack(
    oldTrack: MediaStreamTrack,
    newTrack: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("No active peer connection");
    }

    const registration = this.trackRegistrations.get(oldTrack.id);
    const sender =
      registration?.sender ||
      this.peerConnection
        .getSenders()
        .find((candidate) => candidate.track === oldTrack);

    if (!sender) {
      this.logger.warn(
        "No sender found for existing track; falling back to add/remove cycle",
        {
          oldTrackId: oldTrack.id,
        },
      );

      await this.removeAudioTrack(oldTrack);
      await this.addAudioTrack(newTrack, options);
      return;
    }

    try {
      await sender.replaceTrack(newTrack);

      this.localTracks.delete(oldTrack);
      this.localTracks.add(newTrack);

      const mergedOptions = this.mergeRegistrationOptions(
        registration?.options,
        options,
      );

      this.trackRegistrations.delete(oldTrack.id);
      this.trackRegistrations.set(newTrack.id, {
        sender,
        options: mergedOptions,
      });

      if (mergedOptions?.audioContext) {
        this.audioContextRef = mergedOptions.audioContext;
      }

      this.logger.debug("Audio track replaced", {
        oldTrackId: oldTrack.id,
        newTrackId: newTrack.id,
      });

      this.emitLocalTrackEvent(
        "audioTrackRemoved",
        oldTrack,
        registration?.options,
      );
      this.emitLocalTrackEvent("audioTrackAdded", newTrack, mergedOptions);
      oldTrack.stop();
    } catch (error: any) {
      this.logger.error("Failed to replace audio track", {
        error: error.message,
      });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to replace audio track: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Removes an audio track from the peer connection and stops the local track.
   * @param track Media stream track to remove.
   * @throws {@link WebRTCErrorImpl} when removal fails.
   */
  async removeAudioTrack(track: MediaStreamTrack): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("No active peer connection");
    }

    try {
      const registration = this.trackRegistrations.get(track.id);
      const sender = registration?.sender;

      if (sender) {
        this.peerConnection.removeTrack(sender);
      } else {
        const fallbackSender = this.peerConnection
          .getSenders()
          .find((candidate) => candidate.track === track);
        if (fallbackSender) {
          this.peerConnection.removeTrack(fallbackSender);
        }
      }

      this.localTracks.delete(track);
      track.stop();

      this.trackRegistrations.delete(track.id);

      if (this.trackRegistrations.size === 0) {
        this.audioContextRef = null;
      }

      this.logger.debug("Audio track removed", { trackId: track.id });
      this.emitLocalTrackEvent(
        "audioTrackRemoved",
        track,
        registration?.options,
      );
    } catch (error: any) {
      this.logger.error("Failed to remove audio track", {
        error: error.message,
      });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to remove audio track: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Gets the remote audio stream exposed by the peer connection.
   * @returns Remote audio stream when available, otherwise null.
   */
  getRemoteAudioStream(): MediaStream | null {
    return this.remoteStream;
  }

  /**
   * Retrieves the audio context associated with registered tracks, if any.
   * @returns Shared {@link AudioContext} instance or null when not assigned.
   */
  getAudioContext(): AudioContext | null {
    return this.audioContextRef;
  }

  // Data channel operations
  /**
   * Sends a realtime event through the data channel or queues it if unavailable.
   * @param message Realtime event payload to transmit.
   * @throws {@link WebRTCErrorImpl} when transmission ultimately fails.
   */
  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    const channel = this.dataChannel;

    if (!channel || channel.readyState !== "open") {
      this.logger.warn("Data channel unavailable, queueing message", {
        readyState: channel?.readyState ?? "unavailable",
        type: message.type,
      });
      this.enqueueDataChannelMessage(
        message,
        "Data channel unavailable, queued message",
      );
      return;
    }

    if (this.pendingDataChannelMessages.length > 0) {
      this.pendingDataChannelMessages.push(message);
      await this.flushQueuedMessages();
      return;
    }

    try {
      const messageJson = JSON.stringify(message);
      channel.send(messageJson);

      this.logger.debug("Data channel message sent", { type: message.type });
    } catch (error: any) {
      this.logger.error("Failed to send data channel message", {
        error: error?.message ?? error,
      });
      this.enqueueDataChannelMessage(
        message,
        `Failed to send message: ${error?.message ?? error}`,
      );
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.DataChannelFailed,
        message: `Failed to send message: ${error?.message ?? error}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  // Event handling
  /**
   * Registers an event listener for the specified event type.
   * @param type WebRTC event type to subscribe to.
   * @param handler Callback invoked when the event is emitted.
   */
  addEventListener(type: WebRTCEventType, handler: WebRTCEventHandler): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);
  }

  /**
   * Removes a previously registered event listener.
   * @param type Event type originally registered.
   * @param handler Handler instance to unregister.
   */
  removeEventListener(
    type: WebRTCEventType,
    handler: WebRTCEventHandler,
  ): void {
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  // Private implementation methods
  /**
   * Performs SDP negotiation with Azure while enforcing a timeout.
   * @param config WebRTC configuration containing endpoint details.
   * @param offer Local session description offer to send for negotiation.
   * @returns The SDP answer provided by the Azure service.
   * @throws {@link WebRTCErrorImpl} when negotiation times out or fails.
   */
  private async performNegotiationWithTimeout(
    config: WebRTCConfig,
    offer: RTCSessionDescriptionInit,
  ): Promise<{ sdp: string }> {
    const startedAt = Date.now();
    this.logger.debug("Starting SDP negotiation", {
      connectionId: this.connectionId,
      timeoutMs: this.negotiationTimeoutMs,
    });

    try {
      const response = await this.withNegotiationTimeout(
        this.negotiateWithAzure(config, offer),
        startedAt,
      );

      const durationMs = Date.now() - startedAt;
      this.lastNegotiationDurationMs = durationMs;

      this.logger.info("SDP negotiation completed", {
        connectionId: this.connectionId,
        durationMs,
      });

      this.emitConnectionDiagnostics({
        negotiation: {
          durationMs,
          timeoutMs: this.negotiationTimeoutMs,
          timedOut: false,
        },
      });

      return response;
    } catch (error: any) {
      const durationMs = Date.now() - startedAt;
      this.lastNegotiationDurationMs = durationMs;

      if (error instanceof WebRTCErrorImpl) {
        this.logger.error("SDP negotiation failed", {
          connectionId: this.connectionId,
          code: error.code,
          message: error.message,
          durationMs,
        });

        if (error.code === WebRTCErrorCode.SdpNegotiationFailed) {
          this.emitConnectionDiagnostics({
            negotiation: {
              durationMs,
              timeoutMs: this.negotiationTimeoutMs,
              timedOut: true,
              errorCode: error.code,
            },
          });
        }
      } else {
        this.logger.error("SDP negotiation failed", {
          connectionId: this.connectionId,
          error: error?.message ?? error,
          durationMs,
        });
      }

      throw error;
    }
  }

  /**
   * Wraps a promise with an SDP negotiation timeout guard.
   * @param promise Negotiation promise to monitor.
   * @param startedAt Millisecond timestamp used to compute duration.
   * @returns The resolved promise value when it completes in time.
   * @throws {@link WebRTCErrorImpl} when timeout elapses before resolution.
   */
  private async withNegotiationTimeout<T>(
    promise: Promise<T>,
    startedAt: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.negotiationTimeoutHandle = setTimeout(() => {
        this.negotiationTimeoutHandle = null;

        const durationMs = Date.now() - startedAt;
        const timeoutError = new WebRTCErrorImpl({
          code: WebRTCErrorCode.SdpNegotiationFailed,
          message: `SDP negotiation timed out after ${this.negotiationTimeoutMs}ms`,
          details: {
            timeoutMs: this.negotiationTimeoutMs,
            durationMs,
          },
          recoverable: false,
          timestamp: new Date(),
        });

        reject(timeoutError);
      }, this.negotiationTimeoutMs);

      promise
        .then((value) => {
          this.clearNegotiationTimer();
          resolve(value);
        })
        .catch((error) => {
          this.clearNegotiationTimer();
          reject(error);
        });
    });
  }

  /**
   * Clears any pending negotiation timeout to avoid spurious failures.
   */
  private clearNegotiationTimer(): void {
    if (this.negotiationTimeoutHandle) {
      clearTimeout(this.negotiationTimeoutHandle);
      this.negotiationTimeoutHandle = null;
    }
  }

  /**
   * Posts the SDP offer to the Azure endpoint and returns the response.
   * @param config WebRTC configuration, including endpoint and authentication.
   * @param offer Local SDP offer to forward to Azure.
   * @returns Object containing the SDP answer text.
   */
  private async negotiateWithAzure(
    config: WebRTCConfig,
    offer: RTCSessionDescriptionInit,
  ): Promise<{ sdp: string }> {
    const endpoint = `${config.endpoint.url}?model=${encodeURIComponent(config.endpoint.deployment)}&api-version=${encodeURIComponent(config.endpoint.apiVersion)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.authentication.ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
      body: offer.sdp,
    });

    if (!response.ok) {
      throw new Error(
        `SDP negotiation failed: ${response.status} ${response.statusText}`,
      );
    }

    const sdp = await response.text();
    return { sdp };
  }

  /**
   * Attaches standard event handlers to the peer connection instance.
   */
  private setupPeerConnectionHandlers(): void {
    if (!this.peerConnection) {
      return;
    }

    this.peerConnection.oniceconnectionstatechange = () => {
      this.handleIceConnectionStateChange();
    };

    this.peerConnection.ontrack = (event) => {
      this.handleRemoteTrack(event);
    };

    this.peerConnection.ondatachannel = (event) => {
      this.handleDataChannelReceived(event.channel);
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.logger.debug("ICE candidate received", {
          candidate: event.candidate.candidate,
        });
      }
    };
  }

  /**
   * Attaches the data channel to the transport and wires event handlers.
   * @param channel Data channel received or created by the peer connection.
   * @param origin Indicates whether the channel originated locally or remotely.
   */
  private attachDataChannel(
    channel: RTCDataChannel,
    origin: "local" | "remote",
  ): void {
    if (this.dataChannel && this.dataChannel !== channel) {
      this.detachDataChannelHandlers(this.dataChannel);
    }

    this.dataChannel = channel;
    this.setupDataChannelHandlers(channel);

    this.logger.debug("Data channel attached", {
      origin,
      state: channel.readyState,
    });

    if (channel.readyState === "open") {
      this.updateFallbackState(false, `${origin} data channel open`);
      void this.sendInitialSessionUpdate();
      void this.flushQueuedMessages();
    } else if (channel.readyState === "connecting") {
      this.updateFallbackState(true, `${origin} data channel connecting`);
    } else {
      this.emitDataChannelState(`Data channel state: ${channel.readyState}`);
    }
  }

  /**
   * Removes all event handlers from a data channel instance.
   * @param channel Data channel whose callbacks should be cleared.
   */
  private detachDataChannelHandlers(channel: RTCDataChannel): void {
    channel.onopen = null;
    channel.onclose = null;
    channel.onerror = null;
    channel.onmessage = null;
  }

  /**
   * Configures event handlers for an active data channel.
   * @param channel Data channel to configure.
   */
  private setupDataChannelHandlers(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.handleDataChannelOpen();
    };

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(event);
    };

    channel.onclose = () => {
      this.handleDataChannelClose("closed");
    };

    channel.onerror = (error) => {
      this.handleDataChannelError(error);
    };
  }

  /**
   * Handles data channel open events by flushing queued messages.
   */
  private handleDataChannelOpen(): void {
    this.logger.debug("Data channel opened");
    this.updateFallbackState(false, "Data channel opened");
    void this.sendInitialSessionUpdate();
    void this.flushQueuedMessages();
  }

  /**
   * Handles data channel closing and switches the transport to fallback mode.
   * @param reason Human-readable explanation for the closure.
   */
  private handleDataChannelClose(reason: string): void {
    this.logger.debug("Data channel closed", { reason });
    this.updateFallbackState(true, reason);
  }

  /**
   * Emits a transport error when the data channel encounters an issue.
   * @param error Error object raised by the data channel implementation.
   */
  private handleDataChannelError(error: unknown): void {
    const message =
      error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : "Data channel error occurred";

    this.logger.error("Data channel error", { error: message });
    this.updateFallbackState(true, message);

    this.emitEvent({
      type: "error",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: new WebRTCErrorImpl({
        code: WebRTCErrorCode.DataChannelFailed,
        message,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      }),
    });
  }

  /**
   * Updates fallback mode state and emits corresponding diagnostics.
   * @param active True when fallback mode should be enabled.
   * @param reason Description explaining why fallback state changed.
   */
  private updateFallbackState(active: boolean, reason: string): void {
    const previous = this.fallbackActive;
    this.fallbackActive = active;

    this.emitDataChannelState(reason);

    if (previous !== active) {
      this.emitEvent({
        type: "fallbackStateChanged",
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: {
          state: this.getDataChannelState(),
          fallbackActive: active,
          queuedMessages: this.pendingDataChannelMessages.length,
          reason,
        },
      });
    }
  }

  /**
   * Emits a data channel state change event with optional contextual reason.
   * @param reason Optional description for the state change.
   */
  private emitDataChannelState(reason?: string): void {
    this.emitEvent({
      type: "dataChannelStateChanged",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        state: this.getDataChannelState(),
        fallbackActive: this.fallbackActive,
        queuedMessages: this.pendingDataChannelMessages.length,
        reason,
      },
    });
  }

  /**
   * Adds a message to the queue when immediate transmission is not possible.
   * @param message Realtime event payload awaiting transmission.
   * @param reason Explanation associated with the queuing decision.
   */
  private enqueueDataChannelMessage(
    message: RealtimeEvent,
    reason: string,
  ): void {
    if (this.pendingDataChannelMessages.length >= this.maxQueuedMessages) {
      this.logger.warn("Data channel queue capacity reached; dropping oldest");
      this.pendingDataChannelMessages.shift();
    }

    this.pendingDataChannelMessages.push(message);
    this.updateFallbackState(true, reason);
  }

  /**
   * Attempts to send all queued data channel messages.
   */
  private async flushQueuedMessages(): Promise<void> {
    if (this.isFlushingQueue) {
      return;
    }

    const channel = this.dataChannel;
    if (!channel || channel.readyState !== "open") {
      return;
    }

    this.isFlushingQueue = true;

    try {
      while (this.pendingDataChannelMessages.length > 0) {
        const next = this.pendingDataChannelMessages[0];
        try {
          const payload = JSON.stringify(next);
          channel.send(payload);
          this.pendingDataChannelMessages.shift();
        } catch (sendError: any) {
          this.logger.warn("Failed to flush data channel message", {
            error: sendError?.message ?? sendError,
            queuedMessages: this.pendingDataChannelMessages.length,
          });
          this.updateFallbackState(true, "Failed to flush queued message");
          break;
        }
      }

      if (this.pendingDataChannelMessages.length === 0) {
        this.updateFallbackState(false, "Queued messages flushed");
      }
    } finally {
      this.isFlushingQueue = false;
    }
  }

  /**
   * Waits for the provided data channel to transition to the open state.
   * @param channel Data channel to monitor.
   * @param timeoutMs Maximum time to wait before giving up.
   * @returns True when the channel opens before timing out.
   */
  private async waitForDataChannelOpen(
    channel: RTCDataChannel,
    timeoutMs: number,
  ): Promise<boolean> {
    if (channel.readyState === "open") {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const originalOnOpen = channel.onopen;

      const timeout = setTimeout(() => {
        channel.onopen = originalOnOpen;
        resolve(false);
      }, timeoutMs);

      channel.onopen = (event?: Event) => {
        if (originalOnOpen) {
          originalOnOpen.call(channel, event as any);
        }
        clearTimeout(timeout);
        channel.onopen = originalOnOpen;
        resolve(true);
      };
    });
  }

  /**
   * Reacts to ICE connection state transitions and updates transport state.
   */
  private handleIceConnectionStateChange(): void {
    if (!this.peerConnection) {
      return;
    }

    const iceState = this.peerConnection.iceConnectionState;
    this.logger.debug("ICE connection state changed", { state: iceState });

    switch (iceState) {
      case "connected":
      case "completed":
        if (this.connectionState === WebRTCConnectionState.Connecting) {
          this.setConnectionState(WebRTCConnectionState.Connected);
        }
        break;
      case "disconnected":
        this.setConnectionState(WebRTCConnectionState.Reconnecting);
        break;
      case "failed":
        this.setConnectionState(WebRTCConnectionState.Failed);
        break;
      case "closed":
        this.setConnectionState(WebRTCConnectionState.Closed);
        break;
    }
  }

  /**
   * Handles remote track events by exposing the remote audio stream.
   * @param event Track event emitted by the peer connection.
   */
  private handleRemoteTrack(event: RTCTrackEvent): void {
    const [stream] = event.streams;
    this.remoteStream = stream;

    this.logger.debug("Remote track received", { trackId: event.track.id });

    this.emitEvent({
      type: "audioTrackAdded",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        track: event.track,
        stream,
        isRemote: true,
      },
    });
  }

  /**
   * Handles a remotely created data channel by attaching it to the transport.
   * @param channel Data channel provided by the remote peer.
   */
  private handleDataChannelReceived(channel: RTCDataChannel): void {
    this.logger.debug("Data channel received from remote", {
      label: channel.label,
    });
    this.attachDataChannel(channel, "remote");
  }

  /**
   * Processes inbound data channel messages from the remote peer.
   * @param event Message event containing serialized realtime payload.
   */
  private handleDataChannelMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as RealtimeEvent;

      this.logger.debug("Data channel message received", {
        type: message.type,
      });

      this.emitEvent({
        type: "dataChannelMessage",
        connectionId: this.connectionId,
        timestamp: new Date(),
        data: {
          message,
          channel: (event.currentTarget ?? this.dataChannel) as RTCDataChannel,
        },
      });
    } catch (error: any) {
      this.logger.error("Failed to parse data channel message", {
        error: error.message,
      });
    }
  }

  /**
   * Merges existing and updated track registration options.
   * @param existing Previously stored registration details.
   * @param updates New values to overlay on the existing configuration.
   * @returns Combined registration options when available.
   */
  private mergeRegistrationOptions(
    existing?: AudioTrackRegistrationOptions,
    updates?: AudioTrackRegistrationOptions,
  ): AudioTrackRegistrationOptions | undefined {
    if (!existing && !updates) {
      return updates ?? existing;
    }

    const merged: AudioTrackRegistrationOptions = {
      ...(existing ?? {}),
      ...(updates ?? {}),
      processedStream:
        updates?.processedStream ?? existing?.processedStream ?? undefined,
      sourceStream:
        updates?.sourceStream ?? existing?.sourceStream ?? undefined,
      audioContext:
        updates?.audioContext ?? existing?.audioContext ?? undefined,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(updates?.metadata ?? {}),
      },
    };

    return merged;
  }

  /**
   * Determines whether a media stream already contains the provided track.
   * @param stream Media stream to inspect.
   * @param track Track to look for within the stream.
   * @returns True when the stream includes the track.
   */
  private streamContainsTrack(
    stream: MediaStream,
    track: MediaStreamTrack,
  ): boolean {
    return stream.getTracks().some((candidate) => candidate.id === track.id);
  }

  /**
   * Adds a track to a stream if it is not already present.
   * @param stream Stream that should contain the track.
   * @param track Track to guarantee within the stream.
   */
  private ensureStreamContainsTrack(
    stream: MediaStream,
    track: MediaStreamTrack,
  ): void {
    if (!this.streamContainsTrack(stream, track)) {
      stream.addTrack(track);
    }
  }

  /**
   * Emits a local audio track event with the associated metadata.
   * @param type Event type being emitted.
   * @param track Track associated with the event.
   * @param options Optional registration information for the track.
   */
  private emitLocalTrackEvent(
    type: "audioTrackAdded" | "audioTrackRemoved",
    track: MediaStreamTrack,
    options?: AudioTrackRegistrationOptions,
  ): void {
    const processedStream =
      options?.processedStream &&
      this.streamContainsTrack(options.processedStream, track)
        ? options.processedStream
        : undefined;

    const sourceStream =
      options?.sourceStream &&
      this.streamContainsTrack(options.sourceStream, track)
        ? options.sourceStream
        : undefined;

    const stream = processedStream ?? sourceStream ?? new MediaStream([track]);

    this.emitEvent({
      type,
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        track,
        stream,
        isRemote: false,
        processedStream,
        sourceStream,
        metadata: options?.metadata,
      },
    });
  }

  /**
   * Sends the initial session update event through the data channel.
   */
  private async sendInitialSessionUpdate(): Promise<void> {
    if (!this.config) {
      return;
    }

    const sessionUpdate = this.composeSessionUpdateEvent(this.config);

    try {
      await this.sendDataChannelMessage(sessionUpdate);
      this.logger.debug("Initial session update sent");
    } catch (error: any) {
      this.logger.error("Failed to send initial session update", {
        error: error.message,
      });
    }
  }

  /**
   * Composes a session update event based on the provided configuration.
   * @param config Complete WebRTC configuration.
   * @returns Session update event to deliver to the realtime service.
   */
  private composeSessionUpdateEvent(config: WebRTCConfig): SessionUpdateEvent {
    const sessionPayload = this.buildSessionPayload(config.sessionConfig);

    if (!sessionPayload.modalities) {
      sessionPayload.modalities = ["audio", "text"];
    }

    if (!sessionPayload.input_audio_format) {
      sessionPayload.input_audio_format = config.audioConfig.format;
    }

    if (!sessionPayload.output_modalities) {
      sessionPayload.output_modalities = ["audio", "text"];
    }

    return {
      type: "session.update",
      session: sessionPayload,
    };
  }

  /**
   * Builds the realtime session payload from the session configuration.
   * @param sessionConfig Session configuration supplied by the caller.
   * @returns Session payload describing modalities and audio formats.
   */
  private buildSessionPayload(
    sessionConfig: WebRTCSessionConfiguration,
  ): SessionUpdateEvent["session"] {
    const payload: SessionUpdateEvent["session"] = {
      modalities: ["audio", "text"],
      output_modalities: ["audio", "text"],
      input_audio_format: sessionConfig.inputAudioFormat,
      output_audio_format: sessionConfig.outputAudioFormat,
    };

    if (sessionConfig.voice) {
      payload.voice = sessionConfig.voice;
    }

    if (sessionConfig.instructions) {
      payload.instructions = sessionConfig.instructions;
    }

    if (sessionConfig.locale) {
      payload.locale = sessionConfig.locale;
    }

    if (sessionConfig.transcriptionModel) {
      payload.input_audio_transcription = {
        ...(payload.input_audio_transcription ?? {}),
        model: sessionConfig.transcriptionModel,
      };
    }

    if (sessionConfig.turnDetection) {
      payload.turn_detection = this.mapTurnDetectionConfig(
        sessionConfig.turnDetection,
      );
    }

    return payload;
  }

  /**
   * Maps turn detection configuration into the schema expected by the API.
   * @param turnDetection Turn detection configuration from settings.
   * @returns Normalized turn detection payload for realtime sessions.
   */
  private mapTurnDetectionConfig(
    turnDetection: NonNullable<WebRTCSessionConfiguration["turnDetection"]>,
  ): NonNullable<SessionUpdateEvent["session"]["turn_detection"]> {
    return {
      type: turnDetection.type,
      threshold: turnDetection.threshold,
      prefix_padding_ms: turnDetection.prefixPaddingMs,
      silence_duration_ms: turnDetection.silenceDurationMs,
      create_response: turnDetection.createResponse,
      interrupt_response: turnDetection.interruptResponse,
      eagerness: turnDetection.eagerness,
    };
  }

  /**
   * Waits for the ICE connection to reach a connected state.
   * @param timeoutMs Timeout applied to the wait operation.
   * @returns Resolves when a connected state has been reached.
   * @throws {@link WebRTCErrorImpl} when connection fails or times out.
   */
  private async waitForConnection(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();

      const timeout = setTimeout(() => {
        const durationMs = Date.now() - startedAt;
        reject(
          new WebRTCErrorImpl({
            code: WebRTCErrorCode.NetworkTimeout,
            message: `ICE connection was not established within ${timeoutMs}ms`,
            recoverable: true,
            timestamp: new Date(),
            details: {
              durationMs,
              iceState: this.peerConnection?.iceConnectionState,
            },
          }),
        );
      }, timeoutMs);

      const checkConnection = () => {
        const state = this.peerConnection?.iceConnectionState;

        if (state === "connected" || state === "completed") {
          clearTimeout(timeout);
          resolve();
          return;
        }

        if (state === "failed") {
          clearTimeout(timeout);
          reject(
            new WebRTCErrorImpl({
              code: WebRTCErrorCode.IceConnectionFailed,
              message: "ICE connection failed during negotiation.",
              recoverable: true,
              timestamp: new Date(),
              details: { iceState: state },
            }),
          );
          return;
        }

        setTimeout(checkConnection, 100);
      };

      checkConnection();
    });
  }

  /**
   * Updates the tracked connection state and emits a state change event.
   * @param newState State value to record.
   */
  private setConnectionState(newState: WebRTCConnectionState): void {
    const previousState = this.connectionState;
    this.connectionState = newState;

    this.logger.debug("Connection state changed", {
      from: previousState,
      to: newState,
    });

    this.emitEvent({
      type: "connectionStateChanged",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        previousState,
        currentState: newState,
      },
    });
  }

  /**
   * Emits an event to all registered listeners with error isolation.
   * @param event Event payload to broadcast.
   */
  private emitEvent(event: WebRTCEvent): void {
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error: any) {
          this.logger.error("Event handler failed", {
            eventType: event.type,
            error: error.message,
          });
        }
      }
    }
  }

  /**
   * Constructs a {@link ConnectionResult} snapshot for callers.
   * @param success Indicates whether the operation succeeded.
   * @param error Optional error describing failure details.
   * @returns Structured connection result for callers.
   */
  private createConnectionResult(
    success: boolean,
    error?: WebRTCErrorImpl,
  ): ConnectionResult {
    return {
      success,
      connectionId: this.connectionId,
      connectionState: this.connectionState,
      audioTracks: Array.from(this.localTracks),
      remoteStream: this.remoteStream || undefined,
      dataChannel: this.dataChannel || undefined,
      error,
    };
  }

  /**
   * Generates a unique connection identifier for diagnostic correlation.
   * @returns Randomized connection identifier string.
   */
  private generateConnectionId(): string {
    return `webrtc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Classifies an error into a {@link WebRTCErrorCode} value.
   * @param error Error object thrown during WebRTC operations.
   * @returns Matching error code based on heuristics and known types.
   */
  private classifyError(error: any): WebRTCErrorCode {
    if (error instanceof WebRTCErrorImpl) {
      return error.code;
    }

    const candidateCode = (error as { code?: string })?.code;
    switch (candidateCode) {
      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.SdpNegotiationFailed:
      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.DataChannelFailed:
      case WebRTCErrorCode.AudioTrackFailed:
      case WebRTCErrorCode.NetworkTimeout:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
        return candidateCode;
      default:
        break;
    }

    if (error.name === "NotAllowedError") {
      return WebRTCErrorCode.AuthenticationFailed;
    }

    if (error.message?.includes("SDP")) {
      return WebRTCErrorCode.SdpNegotiationFailed;
    }

    if (
      error.message?.includes("ICE") ||
      error.message?.includes("connection")
    ) {
      return WebRTCErrorCode.IceConnectionFailed;
    }

    if (error.message?.includes("timeout")) {
      return WebRTCErrorCode.NetworkTimeout;
    }

    return WebRTCErrorCode.ConfigurationInvalid;
  }

  /**
   * Determines whether an error is considered recoverable.
   * @param error Error instance to classify for recovery handling.
   * @returns True when the error supports recovery strategies.
   */
  private isRecoverableError(error: any): boolean {
    const code = this.classifyError(error);

    switch (code) {
      case WebRTCErrorCode.NetworkTimeout:
      case WebRTCErrorCode.IceConnectionFailed:
      case WebRTCErrorCode.DataChannelFailed:
        return true;

      case WebRTCErrorCode.AuthenticationFailed:
      case WebRTCErrorCode.RegionNotSupported:
      case WebRTCErrorCode.ConfigurationInvalid:
        return false;

      default:
        return false;
    }
  }

  /**
   * Starts periodic collection of WebRTC statistics from the peer connection.
   */
  private startStatisticsMonitoring(): void {
    this.stopStatisticsMonitoring();
    this.statsIntervalMs = 5000;

    this.statsInterval = setInterval(async () => {
      if (!this.peerConnection || this.statsCollectionInProgress) {
        return;
      }

      this.statsCollectionInProgress = true;

      try {
        const stats = await this.peerConnection.getStats();
        this.processStatistics(stats);
      } catch (error: any) {
        this.logger.warn("Failed to get connection statistics", {
          error: error?.message ?? error,
        });
      } finally {
        this.statsCollectionInProgress = false;
      }
    }, this.statsIntervalMs);
  }

  /**
   * Stops the periodic statistics monitoring task if active.
   */
  private stopStatisticsMonitoring(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.statsCollectionInProgress = false;
  }

  /**
   * Processes an RTC statistics report and emits diagnostics events.
   * @param stats Statistics report retrieved from the peer connection.
   */
  private processStatistics(stats: RTCStatsReport): void {
    const statistics = this.computeConnectionStatistics(stats);
    const previousQuality =
      this.lastConnectionQuality ?? statistics.connectionQuality;

    this.logger.debug("WebRTC statistics sample", {
      connectionId: this.connectionId,
      statistics,
    });

    this.lastConnectionQuality = statistics.connectionQuality;

    this.emitConnectionDiagnostics({ statistics });

    this.emitEvent({
      type: "connectionQualityChanged",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        previousQuality,
        currentQuality: statistics.connectionQuality,
        statistics,
      },
    });
  }

  /**
   * Computes the current connection statistics snapshot.
   * @param statsReport Optional raw stats report from the peer connection.
   * @returns Structured {@link ConnectionStatistics} snapshot.
   */
  private computeConnectionStatistics(
    statsReport?: RTCStatsReport,
  ): ConnectionStatistics {
    const snapshot: ConnectionStatistics = {
      connectionId: this.connectionId,
      connectionDurationMs: this.connectionStartTime
        ? Date.now() - this.connectionStartTime
        : 0,
      audioPacketsSent: 0,
      audioPacketsReceived: 0,
      audioBytesSent: 0,
      audioBytesReceived: 0,
      packetsLost: 0,
      jitter: 0,
      dataChannelState:
        this.dataChannel?.readyState ?? ("closed" as RTCDataChannelState),
      iceConnectionState:
        this.peerConnection?.iceConnectionState ??
        ("closed" as RTCIceConnectionState),
      connectionQuality: this.calculateConnectionQuality(),
      currentRoundTripTime: undefined,
      negotiationLatencyMs: this.lastNegotiationDurationMs ?? undefined,
      statsIntervalMs: this.statsIntervalMs,
      timestamp: Date.now(),
    };

    if (statsReport) {
      statsReport.forEach((report) => {
        const kind = (report as any).kind ?? (report as any).mediaType;

        switch (report.type) {
          case "outbound-rtp":
            if (kind === "audio") {
              const outbound = report as RTCOutboundRtpStreamStats & {
                roundTripTime?: number;
              };
              snapshot.audioPacketsSent += outbound.packetsSent ?? 0;
              snapshot.audioBytesSent += outbound.bytesSent ?? 0;

              if (typeof outbound.roundTripTime === "number") {
                snapshot.currentRoundTripTime = Math.round(
                  outbound.roundTripTime * 1000,
                );
              }
            }
            break;
          case "inbound-rtp":
            if (kind === "audio") {
              const inbound = report as RTCInboundRtpStreamStats;
              snapshot.audioPacketsReceived += inbound.packetsReceived ?? 0;
              snapshot.audioBytesReceived += inbound.bytesReceived ?? 0;
              snapshot.packetsLost += inbound.packetsLost ?? 0;

              if (typeof inbound.jitter === "number") {
                snapshot.jitter = Math.max(
                  snapshot.jitter,
                  Math.round(inbound.jitter * 1000),
                );
              }
            }
            break;
          case "remote-inbound-rtp":
            if (kind === "audio") {
              const remoteInbound = report as Record<string, unknown> & {
                roundTripTime?: number;
              };

              if (typeof remoteInbound.roundTripTime === "number") {
                snapshot.currentRoundTripTime = Math.round(
                  remoteInbound.roundTripTime * 1000,
                );
              }
            }
            break;
          case "candidate-pair":
            if ((report as any).state === "succeeded") {
              const candidatePair = report as RTCIceCandidatePairStats & {
                currentRoundTripTime?: number;
              };

              if (typeof candidatePair.currentRoundTripTime === "number") {
                snapshot.currentRoundTripTime = Math.round(
                  candidatePair.currentRoundTripTime * 1000,
                );
              }
            }
            break;
          default:
            break;
        }
      });
    }

    this.latestConnectionStatistics = snapshot;
    return snapshot;
  }

  /**
   * Emits connection diagnostic events with the latest statistics and metadata.
   * @param options Diagnostic options including statistics or negotiation data.
   */
  private emitConnectionDiagnostics(options: {
    statistics?: ConnectionStatistics;
    negotiation?: {
      durationMs: number;
      timeoutMs: number;
      timedOut: boolean;
      errorCode?: WebRTCErrorCode;
    };
  }): void {
    const statistics = options.statistics ?? this.computeConnectionStatistics();
    this.latestConnectionStatistics = statistics;

    this.emitEvent({
      type: "connectionDiagnostics",
      connectionId: this.connectionId,
      timestamp: new Date(),
      data: {
        statistics,
        statsIntervalMs: this.statsIntervalMs,
        negotiation: options.negotiation,
      },
    });
  }

  /**
   * Calculates qualitative connection health based on ICE state.
   * @returns Connection quality classification.
   */
  private calculateConnectionQuality(): ConnectionQuality {
    if (!this.peerConnection) {
      return ConnectionQuality.Failed;
    }

    const iceState = this.peerConnection.iceConnectionState;

    switch (iceState) {
      case "connected":
      case "completed":
        return ConnectionQuality.Excellent;
      case "checking":
        return ConnectionQuality.Good;
      case "disconnected":
        return ConnectionQuality.Poor;
      case "failed":
      case "closed":
        return ConnectionQuality.Failed;
      default:
        return ConnectionQuality.Fair;
    }
  }

  /**
   * Throws if the transport has not yet been initialized.
   * @throws Error when {@link initialize} has not been called.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "WebRTCTransport not initialized. Call initialize() first.",
      );
    }
  }
}

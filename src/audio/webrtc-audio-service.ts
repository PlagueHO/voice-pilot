import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import type { AggregatedResourceTracker } from "../core/disposal/orphan-resource-tracker";
import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import { SessionManager } from "../session/session-manager";
import type { EphemeralKeyInfo } from "../types/ephemeral";
import type {
    RealtimeEvent,
    ResponseCreateEvent,
    ResponseCreatedEvent,
    ResponseDoneEvent,
    ResponseInterruptedEvent,
    SessionUpdateEvent,
} from "../types/realtime-events";
import type { AudioPipelineIntegration } from "../types/service-integration";
import type {
    AudioConfiguration,
    ConnectionStatistics,
    WebRTCConfig,
} from "../types/webrtc";
import {
    ConnectionDiagnosticsEvent,
    ConnectionQuality,
    DataChannelStateChangedEvent,
    RecoveryStrategy,
    WebRTCConnectionState,
    WebRTCErrorCode,
    WebRTCErrorImpl,
} from "../types/webrtc";
import { sharedAudioContextProvider } from "./audio-context-provider";
import { AudioTrackManager } from "./audio-track-manager";
import type { ConnectionRecoveryEvent } from "./connection-recovery-manager";
import { extractTranscriptText } from "./realtime-transcript-utils";
import { RealtimeTurnEvent } from "./turn-detection-coordinator";
import { WebRTCConfigFactory } from "./webrtc-config-factory";
import { WebRTCErrorHandler } from "./webrtc-error-handler";
import { WebRTCTransportImpl } from "./webrtc-transport";

type RecoveryTelemetryEvent =
  | {
      type: "reconnectAttempt";
      strategy: RecoveryStrategy;
      attempt: number;
      delayMs: number;
    }
  | {
      type: "reconnectSucceeded";
      strategy: RecoveryStrategy;
      attempt: number;
      durationMs: number;
    }
  | {
      type: "reconnectFailed";
      strategy: RecoveryStrategy;
      attempt: number;
      durationMs: number;
      error?: unknown;
    }
  | {
      type: "fallbackStateChanged";
      fallbackActive: boolean;
      queuedMessages: number;
      reason?: string;
    }
  | {
      type: "connectionDiagnostics";
      statistics: ConnectionStatistics;
      statsIntervalMs: number;
      negotiation?: {
        durationMs: number;
        timeoutMs: number;
        timedOut: boolean;
        errorCode?: WebRTCErrorCode;
      };
    };

/**
 * High-level audio service that orchestrates WebRTC transport with existing extension services
 * Provides a clean interface for voice session management while integrating with:
 * - EphemeralKeyService for authentication
 * - SessionManager for lifecycle coordination
 * - ConfigurationManager for settings
 * - Logging for diagnostics
 */
export class WebRTCAudioService implements ServiceInitializable {
  private initialized = false;
  private logger: Logger;

  // Core components
  private transport: WebRTCTransportImpl;
  private configFactory: WebRTCConfigFactory;
  private audioManager: AudioTrackManager;
  private errorHandler: WebRTCErrorHandler;

  // Service dependencies
  private ephemeralKeyService?: EphemeralKeyServiceImpl;
  private configurationManager?: ConfigurationManager;
  private sessionManager?: SessionManager;

  // Audio session state
  private isSessionActive = false;
  private currentMicrophoneTrack?: MediaStreamTrack;
  private currentAudioConfig?: AudioConfiguration;
  private activeRealtimeConfig?: WebRTCConfig;
  private audioPipelineIntegration?: AudioPipelineIntegration;
  private usingPipelineInputTrack = false;
  private lastRemoteStream: MediaStream | null = null;
  private readonly sessionStateObservers = new Set<
    (state: WebRTCConnectionState) => void
  >();
  private recoveryObserverDisposable?: { dispose: () => void };
  private readonly telemetryObservers = new Set<
    (event: RecoveryTelemetryEvent) => void
  >();
  private credentialStatus?: EphemeralKeyInfo;
  private readonly credentialObservers = new Set<
    (info: EphemeralKeyInfo) => Promise<void> | void
  >();
  private keyRenewalSubscription?: { dispose: () => void };
  private keyExpirationSubscription?: { dispose: () => void };
  private readonly sessionPreferences: {
    voice?: string;
    instructions?: string;
  } = {};
  private responsePending = false;
  private activeResponseId?: string;

  // Event callbacks
  private onSessionStateChangedCallback?: (state: string) => Promise<void>;
  private onTranscriptReceivedCallback?: (transcript: string) => Promise<void>;
  private onAudioReceivedCallback?: (audioData: Buffer) => Promise<void>;
  private onErrorCallback?: (error: Error) => Promise<void>;
  private onTurnEventCallback?: (
    event: RealtimeTurnEvent,
  ) => Promise<void> | void;

  constructor(
    ephemeralKeyService?: EphemeralKeyServiceImpl,
    configurationManager?: ConfigurationManager,
    sessionManager?: SessionManager,
    logger?: Logger,
    resourceTracker?: AggregatedResourceTracker,
  ) {
    this.logger = logger || new Logger("WebRTCAudioService");
    this.ephemeralKeyService = ephemeralKeyService;
    this.configurationManager = configurationManager;
    this.sessionManager = sessionManager;


    if (this.ephemeralKeyService) {
      this.attachEphemeralKeyObservers(this.ephemeralKeyService);
    }

    // Initialize components
    this.transport = new WebRTCTransportImpl(this.logger);
    this.transport.setResourceTracker(resourceTracker);
    this.configFactory = new WebRTCConfigFactory(this.logger);
    this.audioManager = new AudioTrackManager(
      this.logger,
      sharedAudioContextProvider,
      resourceTracker,
    );
    this.errorHandler = new WebRTCErrorHandler(this.logger);
    this.recoveryObserverDisposable = this.errorHandler.onRecoveryEvent(
      (event) => {
        this.handleRecoveryTelemetry(event);
      },
    );

    this.setupEventHandlers();
  }

  setResourceTracker(tracker?: AggregatedResourceTracker): void {
    this.transport.setResourceTracker(tracker);
    this.audioManager.setResourceTracker(tracker);
  }

  /**
   * Initializes underlying transport, audio, and error handling components.
   *
   * @remarks
   * This method is idempotent; repeated calls after a successful initialization
   * are no-ops. All dependent services must be initialized before invoking
   * this method.
   *
   * @throws Error if mandatory dependencies are unavailable or component
   * initialization fails.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info("Initializing WebRTC Audio Service");

    try {
      // Validate dependencies
      this.validateDependencies();

      // Initialize components
      await this.transport.initialize();
      await this.audioManager.initialize();

      // Set up error handling
      this.configureErrorHandling();

      this.initialized = true;
      this.logger.info("WebRTC Audio Service initialized successfully");
    } catch (error: any) {
      this.logger.error("Failed to initialize WebRTC Audio Service", {
        error: error.message,
      });
      throw new Error(
        `WebRTC Audio Service initialization failed: ${error.message}`,
      );
    }
  }

  /**
   * Indicates whether the service completed initialization.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Releases resources, stops active sessions, and disposes managed components.
   *
   * @remarks
   * After disposal the service can be re-initialized by calling
   * {@link initialize}. Active sessions are stopped before tearing down
   * transports to avoid resource leaks.
   */
  dispose(): void {
    this.logger.info("Disposing WebRTC Audio Service");

    // Stop any active session
    if (this.isSessionActive) {
      this.stopSession();
    }

    // Dispose components
    this.transport.dispose();
    this.audioManager.dispose();
    void sharedAudioContextProvider.close().catch((error: any) => {
      this.logger.warn("Failed to close shared AudioContext", {
        error: error?.message,
      });
    });

    this.currentAudioConfig = undefined;
    this.recoveryObserverDisposable?.dispose();
    this.recoveryObserverDisposable = undefined;
    this.telemetryObservers.clear();
    this.keyRenewalSubscription?.dispose();
    this.keyExpirationSubscription?.dispose();
    this.keyRenewalSubscription = undefined;
    this.keyExpirationSubscription = undefined;
    this.credentialObservers.clear();
    this.credentialStatus = undefined;
    this.errorHandler.dispose();

    this.initialized = false;
    this.logger.info("WebRTC Audio Service disposed");
  }

  /**
   * Start a WebRTC voice session
   */
  async startSession(): Promise<void> {
    this.ensureInitialized();

    if (this.isSessionActive) {
      this.logger.warn("Session already active");
      return;
    }

    try {
      this.logger.info("Starting WebRTC voice session");

      // Validate services are available
      if (!this.ephemeralKeyService || !this.configurationManager) {
        throw new Error("Required services not available for session start");
      }

      // Create WebRTC configuration
      const config = await this.configFactory.createConfig(
        this.configurationManager,
        this.ephemeralKeyService,
      );

      this.updateCredentialStatus(config.authentication.keyInfo);
      this.activeRealtimeConfig = config;
      this.applySessionPreferencesToConfig(config);

      this.audioManager.setAudioConfiguration(config.audioConfig);
      this.currentAudioConfig = config.audioConfig;
      await this.prepareAudioContext(config.audioConfig);

      // Establish WebRTC connection
      const connectionResult = await this.transport.establishConnection(config);
      if (!connectionResult.success) {
        throw new Error(
          `Failed to establish WebRTC connection: ${connectionResult.error?.message}`,
        );
      }

      let microphoneTrack: MediaStreamTrack | undefined;

      if (this.audioPipelineIntegration) {
        try {
          microphoneTrack =
            await this.audioPipelineIntegration.onAudioInputRequired();
          this.usingPipelineInputTrack = !!microphoneTrack;
        } catch (error: any) {
          this.logger.warn("Audio pipeline failed to provide input track", {
            error: error?.message,
          });
          this.usingPipelineInputTrack = false;
        }
      }

      if (!microphoneTrack) {
        microphoneTrack = await this.audioManager.captureMicrophone();
        this.usingPipelineInputTrack = false;
        await this.audioManager.addTrackToTransport(
          this.transport,
          microphoneTrack,
        );
      } else {
        await this.transport.addAudioTrack(microphoneTrack, {
          metadata: { source: "audio-pipeline" },
        });
      }

      this.currentMicrophoneTrack = microphoneTrack;

      // Handle remote audio stream
      const remoteStream = this.transport.getRemoteAudioStream();
      if (remoteStream) {
        this.lastRemoteStream = remoteStream;
        if (this.audioPipelineIntegration) {
          void this.audioPipelineIntegration
            .onAudioOutputReceived(remoteStream)
            .catch((error) => {
              this.logger.warn("Audio pipeline output handler failed", {
                error: error?.message ?? error,
              });
            });
        } else {
          this.audioManager.handleRemoteStream(remoteStream);
        }
      }

      this.isSessionActive = true;
      this.onSessionStateChangedCallback?.("active");

      this.logger.info("WebRTC voice session started successfully");
    } catch (error: any) {
      this.logger.error("Failed to start WebRTC session", {
        error: error.message,
      });
      await this.suspendAudioContext();
      this.currentAudioConfig = undefined;
      this.activeRealtimeConfig = undefined;
      this.resetPendingResponseState("session-start-failed");
      this.onErrorCallback?.(error);
      throw error;
    }
  }

  /**
   * Stop the current voice session
   */
  async stopSession(): Promise<void> {
    if (!this.isSessionActive) {
      this.logger.warn("No active session to stop");
      return;
    }

    try {
      this.logger.info("Stopping WebRTC voice session");

      // Stop audio capture
      if (this.currentMicrophoneTrack) {
        if (this.usingPipelineInputTrack) {
          try {
            await this.transport.removeAudioTrack(this.currentMicrophoneTrack);
          } catch (error: any) {
            this.logger.warn("Failed to remove pipeline-provided track", {
              error: error?.message,
            });
          }
          if (this.currentMicrophoneTrack.readyState === "live") {
            this.currentMicrophoneTrack.stop();
          }
        } else {
          this.audioManager.stopTrack(this.currentMicrophoneTrack.id);
        }
        this.currentMicrophoneTrack = undefined;
        this.usingPipelineInputTrack = false;
      }

      // Close WebRTC connection
      await this.transport.closeConnection();

      this.lastRemoteStream = null;
      await this.suspendAudioContext();

      this.isSessionActive = false;
      this.resetPendingResponseState("session-stopped");
      this.activeRealtimeConfig = undefined;
      this.onSessionStateChangedCallback?.("inactive");

      this.logger.info("WebRTC voice session stopped");
    } catch (error: any) {
      this.logger.error("Error stopping session", { error: error.message });
      await this.suspendAudioContext();
      this.onErrorCallback?.(error);
    }
  }

  /**
   * Send text message through data channel
   */
  async sendTextMessage(text: string): Promise<void> {
    this.ensureActiveSession();

    try {
      const payload = text?.trim();
      if (!payload) {
        throw new Error(
          "Cannot send an empty text message to the realtime service",
        );
      }

      this.assertNoPendingResponse();

      const sessionUpdate = this.buildSessionUpdateEvent();
      if (sessionUpdate) {
        await this.transport.sendDataChannelMessage(sessionUpdate);
      }

      const conversationItem = this.buildConversationItemEvent(payload);
      await this.transport.sendDataChannelMessage(conversationItem);

      const responseCreate = this.buildResponseCreateEvent();
      await this.transport.sendDataChannelMessage(responseCreate);

      this.recordResponsePending();

      this.logger.debug("Text message dispatched to realtime service", {
        text: payload,
      });
    } catch (error: any) {
      this.logger.error("Failed to send text message", {
        error: error.message,
      });
      this.resetPendingResponseState("response-create-failed");
      throw error;
    }
  }

  /**
   * Get session status information
   */
  getSessionStatus(): {
    isActive: boolean;
    connectionState: WebRTCConnectionState;
    connectionQuality: ConnectionQuality;
    hasAudio: boolean;
    statistics: any;
    fallbackActive: boolean;
    dataChannelState: RTCDataChannelState | "unavailable";
  } {
    return {
      isActive: this.isSessionActive,
      connectionState: this.transport.getConnectionState(),
      connectionQuality:
        this.transport.getConnectionStatistics().connectionQuality,
      hasAudio: !!this.currentMicrophoneTrack,
      statistics: this.transport.getConnectionStatistics(),
      fallbackActive: this.transport.isDataChannelFallbackActive(),
      dataChannelState: this.transport.getDataChannelState(),
    };
  }

  /**
   * Mute/unmute microphone
   */
  setMicrophoneMuted(muted: boolean): void {
    if (this.currentMicrophoneTrack) {
      this.audioManager.setTrackMuted(this.currentMicrophoneTrack.id, muted);
      this.logger.debug("Microphone mute state changed", { muted });
    }
  }

  /**
   * Switch audio input device
   */
  async switchAudioDevice(deviceId: string): Promise<void> {
    this.ensureActiveSession();

    try {
      this.currentMicrophoneTrack = await this.audioManager.switchAudioDevice(
        deviceId,
        this.transport,
      );

      this.logger.info("Audio device switched", { deviceId });
    } catch (error: any) {
      this.logger.error("Failed to switch audio device", {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get available audio devices
   */
  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    return this.audioManager.getAudioInputDevices();
  }

  // Event handler setters
  /**
   * Registers a callback invoked whenever the session state transitions.
   *
   * @param callback - Async handler receiving the new session state string.
   */
  onSessionStateChanged(callback: (state: string) => Promise<void>): void {
    this.onSessionStateChangedCallback = callback;
  }

  /**
   * Registers a callback notified when transcript text is received from the
   * realtime data channel.
   *
   * @param callback - Async handler that processes the latest transcript.
   */
  onTranscriptReceived(callback: (transcript: string) => Promise<void>): void {
    this.onTranscriptReceivedCallback = callback;
  }

  /**
   * Registers a callback to receive decoded audio payloads streamed from the
   * realtime service.
   *
   * @param callback - Async handler invoked with PCM audio buffers.
   */
  onAudioReceived(callback: (audioData: Buffer) => Promise<void>): void {
    this.onAudioReceivedCallback = callback;
  }

  /**
   * Registers a callback that receives surfaced errors encountered during the
   * WebRTC session lifecycle.
   *
   * @param callback - Async handler invoked with error instances.
   */
  onError(callback: (error: Error) => Promise<void>): void {
    this.onErrorCallback = callback;
  }

  /**
   * Registers a callback for realtime turn-detection events originating from
   * the server.
   *
   * @param callback - Handler that receives turn events and may return a
   * promise for async follow-up work.
   */
  onTurnEvent(
    callback: (event: RealtimeTurnEvent) => Promise<void> | void,
  ): void {
    this.onTurnEventCallback = callback;
  }

  /**
   * Integrates an external audio pipeline for providing microphone input or
   * consuming remote audio output.
   *
   * @param integration - Object implementing the audio pipeline contract.
   * @returns Disposable that removes the integration when invoked.
   */
  registerAudioPipelineIntegration(integration: AudioPipelineIntegration): {
    dispose: () => void;
  } {
    this.audioPipelineIntegration = integration;

    const statistics = this.transport.getConnectionStatistics();
    void integration
      .onAudioQualityChanged(statistics.connectionQuality)
      .catch((error) => {
        this.logger.warn("Audio pipeline quality handler failed", {
          error: error?.message ?? error,
        });
      });

    if (this.lastRemoteStream) {
      void integration
        .onAudioOutputReceived(this.lastRemoteStream)
        .catch((error) => {
          this.logger.warn("Audio pipeline output handler failed", {
            error: error?.message ?? error,
          });
        });
    }

    return {
      dispose: () => {
        if (this.audioPipelineIntegration === integration) {
          this.audioPipelineIntegration = undefined;
        }
      },
    };
  }

  async updateSessionPreferences(preferences: {
    voice?: string | null;
    instructions?: string | null;
  }): Promise<void> {
    const changes: Array<"voice" | "instructions"> = [];

    if (Object.prototype.hasOwnProperty.call(preferences, "voice")) {
      const normalized = this.normalizePreferenceInput(preferences.voice);
      if (normalized !== this.sessionPreferences.voice) {
        this.sessionPreferences.voice = normalized;
        changes.push("voice");
      }
    }

    if (Object.prototype.hasOwnProperty.call(preferences, "instructions")) {
      const normalized = this.normalizePreferenceInput(
        preferences.instructions,
      );
      if (normalized !== this.sessionPreferences.instructions) {
        this.sessionPreferences.instructions = normalized;
        changes.push("instructions");
      }
    }

    if (changes.length === 0) {
      return;
    }

    if (this.activeRealtimeConfig) {
      if (changes.includes("voice")) {
        this.activeRealtimeConfig.sessionConfig.voice =
          this.sessionPreferences.voice;
      }

      if (changes.includes("instructions")) {
        this.activeRealtimeConfig.sessionConfig.instructions =
          this.sessionPreferences.instructions;
      }
    }

    if (!this.isSessionActive) {
      this.logger.debug("Session preferences updated while inactive", {
        changes,
      });
      return;
    }

    const sessionUpdate = this.buildSessionUpdateEvent();
    if (!sessionUpdate) {
      this.logger.debug("Skipped session preference push; no active config", {
        changes,
      });
      return;
    }

    try {
      await this.transport.sendDataChannelMessage(sessionUpdate);
      this.logger.debug("Realtime session preferences updated", {
        changes,
      });
    } catch (error: any) {
      this.logger.warn("Failed to propagate session preference update", {
        error: error?.message ?? error,
        changes,
      });
      throw error;
    }
  }

  /**
   * Adds an observer notified about connection state transitions.
   *
   * @param observer - Callback receiving the latest {@link WebRTCConnectionState}.
   * @returns Disposable that unregisters the observer.
   */
  addSessionStateObserver(observer: (state: WebRTCConnectionState) => void): {
    dispose: () => void;
  } {
    this.sessionStateObservers.add(observer);
    observer(this.transport.getConnectionState());

    return {
      dispose: () => {
        this.sessionStateObservers.delete(observer);
      },
    };
  }

  /**
   * Adds an observer to receive telemetry events emitted during recovery and
   * diagnostics flows.
   *
   * @param observer - Callback that handles {@link RecoveryTelemetryEvent}.
   * @returns Disposable that unregisters the observer.
   */
  addTelemetryObserver(observer: (event: RecoveryTelemetryEvent) => void): {
    dispose: () => void;
  } {
    this.telemetryObservers.add(observer);
    return {
      dispose: () => this.telemetryObservers.delete(observer),
    };
  }

  // Private implementation methods
  private setupEventHandlers(): void {
    // Transport connection state changes
    this.transport.addEventListener("connectionStateChanged", async (event) => {
      this.logger.debug("Transport connection state changed", {
        state: event.data.currentState,
      });

      this.notifySessionStateObservers(event.data.currentState);

      // Handle connection failures
      if (event.data.currentState === WebRTCConnectionState.Failed) {
        await this.handleConnectionFailure();
      }
    });

    // Data channel messages
    this.transport.addEventListener("dataChannelMessage", async (event) => {
      await this.handleDataChannelMessage(event.data.message);
    });

    // Connection quality changes
    this.transport.addEventListener(
      "connectionQualityChanged",
      async (event) => {
        this.audioManager.adjustAudioQuality(event.data.currentQuality);
        if (this.audioPipelineIntegration) {
          void this.audioPipelineIntegration
            .onAudioQualityChanged(event.data.currentQuality)
            .catch((error) => {
              this.logger.warn("Audio pipeline quality handler failed", {
                error: error?.message ?? error,
              });
            });
        }
      },
    );

    this.transport.addEventListener("connectionDiagnostics", (event) => {
      this.handleConnectionDiagnostics(event as ConnectionDiagnosticsEvent);
    });

    this.transport.addEventListener("audioTrackAdded", async (event) => {
      if (!event.data.isRemote) {
        return;
      }

      this.lastRemoteStream = event.data.stream;

      if (this.audioPipelineIntegration) {
        void this.audioPipelineIntegration
          .onAudioOutputReceived(event.data.stream)
          .catch((error) => {
            this.logger.warn("Audio pipeline output handler failed", {
              error: error?.message ?? error,
            });
          });
      } else {
        this.audioManager.handleRemoteStream(event.data.stream);
      }
    });

    this.transport.addEventListener("audioTrackRemoved", async (event) => {
      if (!event.data.isRemote) {
        return;
      }
      if (this.lastRemoteStream === event.data.stream) {
        this.lastRemoteStream = null;
      }
    });

    this.transport.addEventListener("fallbackStateChanged", (event: any) => {
      this.handleFallbackTelemetry(event as DataChannelStateChangedEvent);
    });

    // Transport errors
    this.transport.addEventListener("error", async (event) => {
      await this.handleTransportError(event.data);
    });
  }

  private handleRecoveryTelemetry(event: ConnectionRecoveryEvent): void {
    switch (event.type) {
      case "attempt":
        this.logger.info("Recovery attempt scheduled", {
          strategy: event.strategy,
          attempt: event.attempt,
          delayMs: event.delayMs,
        });
        this.emitTelemetry({
          type: "reconnectAttempt",
          strategy: event.strategy,
          attempt: event.attempt,
          delayMs: event.delayMs,
        });
        break;
      case "success":
        this.logger.info("Recovery succeeded", {
          strategy: event.strategy,
          attempt: event.attempt,
          durationMs: event.durationMs,
        });
        this.emitTelemetry({
          type: "reconnectSucceeded",
          strategy: event.strategy,
          attempt: event.attempt,
          durationMs: event.durationMs,
        });
        break;
      case "failure":
        this.logger.warn("Recovery attempt failed", {
          strategy: event.strategy,
          attempt: event.attempt,
          durationMs: event.durationMs,
          error:
            event.error && typeof event.error === "object"
              ? (event.error as any).message
              : event.error,
        });
        this.emitTelemetry({
          type: "reconnectFailed",
          strategy: event.strategy,
          attempt: event.attempt,
          durationMs: event.durationMs,
          error: event.error,
        });
        break;
      default:
        ((unhandled: never) => {
          this.logger.debug("Unhandled recovery telemetry event", {
            event: unhandled,
          });
        })(event);
    }
  }

  private handleFallbackTelemetry(event: DataChannelStateChangedEvent): void {
    this.logger.info("Fallback state changed", {
      fallbackActive: event.data.fallbackActive,
      queuedMessages: event.data.queuedMessages,
      reason: event.data.reason,
    });

    this.emitTelemetry({
      type: "fallbackStateChanged",
      fallbackActive: event.data.fallbackActive,
      queuedMessages: event.data.queuedMessages,
      reason: event.data.reason,
    });
  }

  private emitTelemetry(event: RecoveryTelemetryEvent): void {
    for (const observer of Array.from(this.telemetryObservers)) {
      try {
        observer(event);
      } catch (error: any) {
        this.logger.warn("Telemetry observer failed", {
          error: error?.message ?? error,
          event,
        });
      }
    }
  }

  getCredentialStatus(): EphemeralKeyInfo | undefined {
    if (!this.credentialStatus) {
      return undefined;
    }

    const now = Date.now();
    const expiresAt = new Date(this.credentialStatus.expiresAt);
    const refreshAt = new Date(this.credentialStatus.refreshAt);

    return {
      ...this.credentialStatus,
      issuedAt: new Date(this.credentialStatus.issuedAt),
      expiresAt,
      refreshAt,
      isValid: expiresAt.getTime() > now,
      secondsRemaining: Math.max(
        0,
        Math.floor((expiresAt.getTime() - now) / 1000),
      ),
      secondsUntilRefresh: Math.max(
        0,
        Math.floor((refreshAt.getTime() - now) / 1000),
      ),
    };
  }

  onCredentialStatusUpdated(
    handler: (info: EphemeralKeyInfo) => Promise<void> | void,
  ): { dispose: () => void } {
    this.credentialObservers.add(handler);

    if (this.credentialStatus) {
      try {
        const result = handler({
          ...this.credentialStatus,
          issuedAt: new Date(this.credentialStatus.issuedAt),
          expiresAt: new Date(this.credentialStatus.expiresAt),
          refreshAt: new Date(this.credentialStatus.refreshAt),
        });
        if (result instanceof Promise) {
          void result.catch((error: any) => {
            this.logger.warn("Credential status observer failed", {
              error: error?.message ?? error,
            });
          });
        }
      } catch (error: any) {
        this.logger.warn("Credential status observer failed", {
          error: error?.message ?? error,
        });
      }
    }

    return {
      dispose: () => {
        this.credentialObservers.delete(handler);
      },
    };
  }

  private attachEphemeralKeyObservers(service: EphemeralKeyServiceImpl): void {
    this.keyRenewalSubscription?.dispose();
    this.keyExpirationSubscription?.dispose();

    this.keyRenewalSubscription = service.onKeyRenewed(async () => {
      const latest = service.getCurrentKey();
      if (latest) {
        this.updateCredentialStatus(latest);
      }
    });

    this.keyExpirationSubscription = service.onKeyExpired(async (info) => {
      const expiredSnapshot: EphemeralKeyInfo = {
        ...info,
        isValid: false,
        secondsRemaining: 0,
        secondsUntilRefresh: 0,
      };
      this.updateCredentialStatus(expiredSnapshot);
    });

    const current = service.getCurrentKey();
    if (current) {
      this.updateCredentialStatus(current);
    }
  }

  private updateCredentialStatus(info: EphemeralKeyInfo): void {
    const now = Date.now();
    const normalized: EphemeralKeyInfo = {
      ...info,
      issuedAt: new Date(info.issuedAt),
      expiresAt: new Date(info.expiresAt),
      refreshAt: new Date(info.refreshAt),
      isValid: info.expiresAt.getTime() > now,
      secondsRemaining: Math.max(
        0,
        Math.floor((info.expiresAt.getTime() - now) / 1000),
      ),
      secondsUntilRefresh: Math.max(
        0,
        Math.floor((info.refreshAt.getTime() - now) / 1000),
      ),
    };

    this.credentialStatus = normalized;

    for (const observer of Array.from(this.credentialObservers)) {
      try {
        const result = observer({
          ...normalized,
          issuedAt: new Date(normalized.issuedAt),
          expiresAt: new Date(normalized.expiresAt),
          refreshAt: new Date(normalized.refreshAt),
        });
        if (result instanceof Promise) {
          void result.catch((error: any) => {
            this.logger.warn("Credential status observer failed", {
              error: error?.message ?? error,
            });
          });
        }
      } catch (error: any) {
        this.logger.warn("Credential status observer failed", {
          error: error?.message ?? error,
        });
      }
    }
  }

  private handleConnectionDiagnostics(event: ConnectionDiagnosticsEvent): void {
    this.logger.debug("Connection diagnostics sample", {
      intervalMs: event.data.statsIntervalMs,
      negotiation: event.data.negotiation,
      statistics: event.data.statistics,
    });

    this.emitTelemetry({
      type: "connectionDiagnostics",
      statistics: event.data.statistics,
      statsIntervalMs: event.data.statsIntervalMs,
      negotiation: event.data.negotiation,
    });
  }

  private configureErrorHandling(): void {
    // Configure error callbacks
    this.errorHandler.onAuthenticationError(async (error) => {
      this.logger.warn("Authentication error, requesting key renewal", {
        error: error.code,
      });

      if (this.ephemeralKeyService) {
        try {
          await this.ephemeralKeyService.renewKey();
          // Attempt to restart session with new key
          await this.restartSessionWithNewKey();
        } catch (renewError: any) {
          this.logger.error("Failed to renew key", {
            error: renewError.message,
          });
          this.onErrorCallback?.(renewError);
        }
      }
    });

    this.errorHandler.onConnectionError(async (error) => {
      this.logger.warn("Connection error detected", { error: error.code });
      await this.handleConnectionFailure();
    });

    this.errorHandler.onFatalError(async (error) => {
      this.logger.error("Fatal error, stopping session", { error: error.code });
      await this.stopSession();
      this.onErrorCallback?.(error);
    });
  }

  private async prepareAudioContext(
    audioConfig: AudioConfiguration,
  ): Promise<void> {
    if (!audioConfig.audioContextProvider.resumeOnActivation) {
      return;
    }

    try {
      await sharedAudioContextProvider.resume();
    } catch (error: any) {
      if (audioConfig.audioContextProvider.requiresUserGesture) {
        this.logger.warn("AudioContext resume requires user gesture", {
          error: error?.message,
        });
      } else {
        this.logger.error("Failed to resume shared AudioContext", {
          error: error?.message,
        });
        throw error;
      }
    }
  }

  private async suspendAudioContext(): Promise<void> {
    if (!this.currentAudioConfig?.audioContextProvider.resumeOnActivation) {
      return;
    }

    try {
      await sharedAudioContextProvider.suspend();
    } catch (error: any) {
      this.logger.warn("Failed to suspend shared AudioContext", {
        error: error?.message,
      });
    }
  }

  private async handleDataChannelMessage(
    message: RealtimeEvent,
  ): Promise<void> {
    this.logger.debug("Received data channel message", { type: message.type });

    try {
      switch (message.type) {
        case "session.updated":
          this.handleSessionUpdated(message as SessionUpdateEvent);
          break;

        case "response.created":
          this.handleResponseCreated(message as ResponseCreatedEvent);
          break;

        case "response.done":
          this.forwardRealtimeTranscriptEvent(message);
          this.handleResponseDone(message as ResponseDoneEvent);
          break;

        case "response.interrupted":
          this.handleResponseInterrupted(message as ResponseInterruptedEvent);
          break;

        case "response.audio.delta":
        case "response.output_audio.delta":
          if (this.onAudioReceivedCallback && "delta" in message) {
            const audioBuffer = Buffer.from(message.delta as string, "base64");
            await this.onAudioReceivedCallback(audioBuffer);
          }
          break;

        case "response.text.delta":
        case "response.output_text.delta":
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
        case "response.output_audio_transcription.delta":
        case "conversation.item.audio_transcription.delta":
          this.forwardRealtimeTranscriptEvent(message);
          if (this.onTranscriptReceivedCallback) {
            const transcript = extractTranscriptText(message);
            if (transcript !== undefined) {
              await this.onTranscriptReceivedCallback(transcript);
            } else {
              this.logger.debug("Transcript delta missing textual payload", {
                type: message.type,
              });
            }
          }
          break;

        case "response.text.done":
        case "response.output_text.done":
        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
        case "response.output_audio_transcription.done":
          this.forwardRealtimeTranscriptEvent(message);
          if (this.onTranscriptReceivedCallback) {
            const transcript = extractTranscriptText(message);
            if (transcript !== undefined) {
              await this.onTranscriptReceivedCallback(transcript);
            }
          }
          break;

        case "input_audio_buffer.speech_started":
          await this.emitTurnEvent({
            type: "speech-start",
            timestamp: Date.now(),
            serverEvent: message,
          });
          break;

        case "input_audio_buffer.speech_stopped":
          await this.emitTurnEvent({
            type: "speech-stop",
            timestamp: Date.now(),
            serverEvent: message,
          });
          break;

        case "error":
          this.logger.error("Received error from data channel", { message });
          if ("error" in message) {
            this.onErrorCallback?.(new Error(message.error as string));
          }
          break;

        default:
          this.logger.debug("Unhandled message type", { type: message.type });
          break;
      }
    } catch (error: any) {
      this.logger.error("Error handling data channel message", {
        error: error.message,
      });
    }
  }

  private handleSessionUpdated(event: SessionUpdateEvent): void {
    if (!event.session) {
      return;
    }

    if (typeof event.session.voice === "string") {
      this.sessionPreferences.voice = this.normalizePreferenceInput(
        event.session.voice,
      );
    }

    if (typeof event.session.instructions === "string") {
      this.sessionPreferences.instructions = this.normalizePreferenceInput(
        event.session.instructions,
      );
    }

    if (this.activeRealtimeConfig) {
      this.activeRealtimeConfig.sessionConfig.voice =
        this.sessionPreferences.voice;
      this.activeRealtimeConfig.sessionConfig.instructions =
        this.sessionPreferences.instructions;
    }
  }

  private handleResponseCreated(event: ResponseCreatedEvent): void {
    if (!event.response?.id) {
      return;
    }
    this.activeResponseId = event.response.id;
    this.responsePending = true;
  }

  private handleResponseDone(event: ResponseDoneEvent): void {
    if (!event.response?.id) {
      this.resetPendingResponseState("response-done-missing-id");
      return;
    }

    if (
      (this.activeResponseId && event.response.id === this.activeResponseId) ||
      (!this.activeResponseId && this.responsePending)
    ) {
      this.resetPendingResponseState("response-done");
    }
  }

  private handleResponseInterrupted(event: ResponseInterruptedEvent): void {
    if (event.response_id && event.response_id === this.activeResponseId) {
      this.resetPendingResponseState("response-interrupted");
      return;
    }

    if (!event.response_id && this.responsePending) {
      this.resetPendingResponseState("response-interrupted-untracked");
    }
  }

  private forwardRealtimeTranscriptEvent(event: RealtimeEvent): void {
    if (!this.sessionManager) {
      return;
    }

    const target = this.sessionManager as {
      handleRealtimeTranscriptEvent?: (evt: RealtimeEvent) => void;
    };

    if (typeof target.handleRealtimeTranscriptEvent !== "function") {
      return;
    }

    try {
      target.handleRealtimeTranscriptEvent(event);
    } catch (error: any) {
      this.logger.warn("Failed to forward realtime transcript event", {
        error: error?.message ?? error,
        type: event.type,
      });
    }
  }

  private async emitTurnEvent(event: RealtimeTurnEvent): Promise<void> {
    if (!this.onTurnEventCallback) {
      return;
    }
    try {
      const result = this.onTurnEventCallback(event);
      if (result && typeof (result as Promise<void>).then === "function") {
        await result;
      }
    } catch (error: any) {
      this.logger.error("Turn detection listener failed", {
        error: error?.message || error,
        type: event.type,
      });
    }
  }

  private async handleTransportError(error: WebRTCErrorImpl): Promise<void> {
    this.logger.warn("Transport error occurred", { error: error.code });

    if (!this.configurationManager) {
      this.logger.error(
        "Cannot handle transport error - no configuration manager",
      );
      return;
    }

    try {
      const config = await this.configFactory.createConfig(
        this.configurationManager,
        this.ephemeralKeyService!,
      );

      this.activeRealtimeConfig = config;
      this.applySessionPreferencesToConfig(config);

      await this.errorHandler.handleError(error, this.transport, config);
    } catch (handlingError: any) {
      this.logger.error("Failed to handle transport error", {
        error: handlingError.message,
      });
      this.onErrorCallback?.(handlingError);
    }
  }

  private async handleConnectionFailure(): Promise<void> {
    this.logger.warn("Handling connection failure");

    if (this.isSessionActive) {
      try {
        // Attempt to restart the session
        await this.restartSession();
      } catch (error: any) {
        this.logger.error(
          "Failed to restart session after connection failure",
          { error: error.message },
        );
        await this.stopSession();
        this.onErrorCallback?.(error);
      }
    }
  }

  private async restartSession(): Promise<void> {
    this.logger.info("Restarting WebRTC session");

    const wasActive = this.isSessionActive;
    await this.stopSession();

    if (wasActive) {
      await this.startSession();
    }
  }

  private async restartSessionWithNewKey(): Promise<void> {
    this.logger.info("Restarting session with new ephemeral key");

    if (!this.configurationManager || !this.ephemeralKeyService) {
      throw new Error("Required services not available for session restart");
    }

    // Create new configuration with renewed key
    const config = await this.configFactory.updateConfigWithNewKey(
      await this.configFactory.createConfig(
        this.configurationManager,
        this.ephemeralKeyService,
      ),
      this.ephemeralKeyService,
    );

    this.updateCredentialStatus(config.authentication.keyInfo);
    this.activeRealtimeConfig = config;
    this.applySessionPreferencesToConfig(config);

    // Re-establish connection
    const result = await this.transport.establishConnection(config);
    if (!result.success) {
      throw new Error(`Failed to restart session: ${result.error?.message}`);
    }

    this.logger.info("Session restarted with new key");
  }

  private normalizePreferenceInput(
    value: string | null | undefined,
  ): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private applySessionPreferencesToConfig(config: WebRTCConfig): void {
    const sessionConfig = config.sessionConfig;

    if (this.sessionPreferences.voice === undefined) {
      this.sessionPreferences.voice = this.normalizePreferenceInput(
        sessionConfig.voice,
      );
      sessionConfig.voice = this.sessionPreferences.voice;
    } else {
      sessionConfig.voice = this.sessionPreferences.voice;
    }

    if (this.sessionPreferences.instructions === undefined) {
      this.sessionPreferences.instructions = this.normalizePreferenceInput(
        sessionConfig.instructions,
      );
      sessionConfig.instructions = this.sessionPreferences.instructions;
    } else {
      sessionConfig.instructions = this.sessionPreferences.instructions;
    }
  }

  private buildSessionUpdateEvent(): SessionUpdateEvent | undefined {
    const config = this.activeRealtimeConfig;
    if (!config) {
      return undefined;
    }

    const sessionConfig = config.sessionConfig;

    const sessionPayload: SessionUpdateEvent["session"] = {
      modalities: ["audio", "text"],
      output_modalities: ["audio", "text"],
      input_audio_format: config.audioConfig.format,
      output_audio_format:
        sessionConfig.outputAudioFormat ?? config.audioConfig.format,
    };

    if (sessionConfig.voice) {
      sessionPayload.voice = sessionConfig.voice;
    }

    if (sessionConfig.instructions) {
      sessionPayload.instructions = sessionConfig.instructions;
    }

    if (sessionConfig.locale) {
      sessionPayload.locale = sessionConfig.locale;
    }

    if (sessionConfig.transcriptionModel) {
      sessionPayload.input_audio_transcription = {
        model: sessionConfig.transcriptionModel,
      };
    }

    if (sessionConfig.turnDetection) {
      sessionPayload.turn_detection = this.mapTurnDetectionConfiguration(
        sessionConfig.turnDetection,
      );
    }

    return {
      type: "session.update",
      session: sessionPayload,
    };
  }

  private mapTurnDetectionConfiguration(
    source: NonNullable<WebRTCConfig["sessionConfig"]["turnDetection"]>,
  ): NonNullable<SessionUpdateEvent["session"]["turn_detection"]> {
    return {
      type: source.type,
      threshold: source.threshold,
      prefix_padding_ms: source.prefixPaddingMs,
      silence_duration_ms: source.silenceDurationMs,
      create_response: source.createResponse,
      interrupt_response: source.interruptResponse,
      eagerness: source.eagerness,
    };
  }

  private buildConversationItemEvent(text: string): RealtimeEvent {
    return {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    };
  }

  private buildResponseCreateEvent(): ResponseCreateEvent {
    const responsePayload: NonNullable<ResponseCreateEvent["response"]> = {
      modalities: ["audio", "text"],
      output_modalities: ["audio", "text"],
    };

    if (this.sessionPreferences.voice) {
      responsePayload.voice = this.sessionPreferences.voice;
    }

    if (this.sessionPreferences.instructions) {
      responsePayload.instructions = this.sessionPreferences.instructions;
    }

    return {
      type: "response.create",
      response: responsePayload,
    };
  }

  private recordResponsePending(): void {
    this.responsePending = true;
    this.activeResponseId = undefined;
  }

  private assertNoPendingResponse(): void {
    if (!this.responsePending) {
      return;
    }

    throw new Error(
      "A response is already pending from the realtime service; awaiting completion before dispatching another request.",
    );
  }

  private resetPendingResponseState(reason: string): void {
    if (this.responsePending || this.activeResponseId) {
      this.logger.debug("Resetting response lifecycle state", { reason });
    }
    this.responsePending = false;
    this.activeResponseId = undefined;
  }

  private validateDependencies(): void {
    if (!this.ephemeralKeyService?.isInitialized()) {
      throw new Error("EphemeralKeyService must be initialized");
    }

    if (!this.configurationManager?.isInitialized()) {
      throw new Error("ConfigurationManager must be initialized");
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "WebRTC Audio Service not initialized. Call initialize() first.",
      );
    }
  }

  private ensureActiveSession(): void {
    this.ensureInitialized();

    if (!this.isSessionActive) {
      throw new Error("No active voice session. Call startSession() first.");
    }
  }

  private notifySessionStateObservers(state: WebRTCConnectionState): void {
    for (const observer of Array.from(this.sessionStateObservers)) {
      try {
        observer(state);
      } catch (error: any) {
        this.logger.warn("Session state observer failed", {
          error: error?.message ?? error,
        });
      }
    }
  }
}

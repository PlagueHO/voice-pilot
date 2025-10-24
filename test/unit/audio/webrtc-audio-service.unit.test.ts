import { sharedAudioContextProvider } from "../../../src/audio/audio-context-provider";
import { WebRTCAudioService } from "../../../src/audio/webrtc-audio-service";
import { Logger } from "../../../src/core/logger";
import type { EphemeralKeyInfo } from "../../../src/types/ephemeral";
import type {
    RealtimeEvent,
    ResponseCreateEvent,
    SessionUpdateEvent,
} from "../../../src/types/realtime-events";
import type {
    AudioPipelineIntegration,
} from "../../../src/types/service-integration";
import {
    ConnectionQuality,
    WebRTCConnectionState,
    WebRTCErrorCode,
    WebRTCErrorImpl,
    type ConnectionStatistics,
    type WebRTCConfig,
} from "../../../src/types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { afterEach, beforeEach, suite, test } from "../../mocha-globals";

type EventHandler = (event: { data: any }) => void | Promise<void>;

interface HarnessOptions {
  ephemeralInitialized?: boolean;
  configInitialized?: boolean;
  config?: WebRTCConfig;
  sessionActive?: boolean;
}

interface ProviderStub {
  resumeCalls: number;
  suspendCalls: number;
  closeCalls: number;
  restore(): void;
}

class EphemeralKeyServiceStub {
  public initialized: boolean;
  public renewCalls = 0;
  public currentKey?: EphemeralKeyInfo;
  private renewHandlers = new Set<() => Promise<void>>();
  private expireHandlers = new Set<(info: EphemeralKeyInfo) => Promise<void>>();

  constructor(initialized = true) {
    this.initialized = initialized;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCurrentKey(): EphemeralKeyInfo | undefined {
    return this.currentKey;
  }

  setCurrentKey(info: EphemeralKeyInfo): void {
    this.currentKey = info;
  }

  async renewKey(): Promise<void> {
    this.renewCalls += 1;
  }

  onKeyRenewed(handler: () => Promise<void>): { dispose: () => void } {
    this.renewHandlers.add(handler);
    return {
      dispose: () => {
        this.renewHandlers.delete(handler);
      },
    };
  }

  onKeyExpired(handler: (info: EphemeralKeyInfo) => Promise<void>): {
    dispose: () => void;
  } {
    this.expireHandlers.add(handler);
    return {
      dispose: () => {
        this.expireHandlers.delete(handler);
      },
    };
  }

  async triggerRenewHandlers(): Promise<void> {
    for (const handler of Array.from(this.renewHandlers)) {
      await handler();
    }
  }

  async triggerExpireHandlers(info: EphemeralKeyInfo): Promise<void> {
    for (const handler of Array.from(this.expireHandlers)) {
      await handler(info);
    }
  }
}

class ConfigurationManagerStub {
  private initializedFlag: boolean;

  constructor(initialized = true) {
    this.initializedFlag = initialized;
  }

  isInitialized(): boolean {
    return this.initializedFlag;
  }
}

class SessionManagerStub {
  public events: RealtimeEvent[] = [];

  handleRealtimeTranscriptEvent(event: RealtimeEvent): void {
    this.events.push(event);
  }
}

class TransportMock {
  public initializeCalls = 0;
  public establishCalls: WebRTCConfig[] = [];
  public closeCalls = 0;
  public addTrackCalls: Array<{
    track: MediaStreamTrack;
    options?: Record<string, unknown>;
  }> = [];
  public removeTrackCalls: MediaStreamTrack[] = [];
  public messages: RealtimeEvent[] = [];
  public publishedRecoveryEvents: any[] = [];
  public listeners = new Map<string, Set<EventHandler>>();
  public connectionState: WebRTCConnectionState =
    WebRTCConnectionState.Disconnected;
  public fallbackActive = false;
  public dataChannelState: RTCDataChannelState | "unavailable" = "open";
  public remoteStream: MediaStream | null = null;
  public statistics: ConnectionStatistics = {
    connectionId: "mock-connection",
    connectionDurationMs: 0,
    audioPacketsSent: 0,
    audioPacketsReceived: 0,
    audioBytesSent: 0,
    audioBytesReceived: 0,
    packetsLost: 0,
    jitter: 0,
    dataChannelState: "open",
    iceConnectionState: "connected",
    connectionQuality: ConnectionQuality.Good,
  };

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  async establishConnection(config: WebRTCConfig): Promise<{
    success: boolean;
    connectionId: string;
    connectionState: WebRTCConnectionState;
    audioTracks: MediaStreamTrack[];
    remoteStream?: MediaStream | null;
  }> {
    this.establishCalls.push(config);
    this.connectionState = WebRTCConnectionState.Connected;
    return {
      success: true,
      connectionId: "mock-connection",
      connectionState: this.connectionState,
      audioTracks: [],
      remoteStream: this.remoteStream,
    };
  }

  async closeConnection(): Promise<void> {
    this.closeCalls += 1;
    this.connectionState = WebRTCConnectionState.Closed;
  }

  async restartIce(): Promise<boolean> {
    return true;
  }

  async recreateDataChannel(): Promise<RTCDataChannel | null> {
    return null;
  }

  getConnectionState(): WebRTCConnectionState {
    return this.connectionState;
  }

  getConnectionStatistics(): ConnectionStatistics {
    return this.statistics;
  }

  getDataChannelState(): RTCDataChannelState | "unavailable" {
    return this.dataChannelState;
  }

  isDataChannelFallbackActive(): boolean {
    return this.fallbackActive;
  }

  publishRecoveryEvent(event: any): void {
    this.publishedRecoveryEvents.push(event);
  }

  dispose(): void {
    this.connectionState = WebRTCConnectionState.Closed;
  }

  async addAudioTrack(
    track: MediaStreamTrack,
    options?: Record<string, unknown>,
  ): Promise<void> {
    this.addTrackCalls.push({ track, options });
  }

  async removeAudioTrack(track: MediaStreamTrack): Promise<void> {
    this.removeTrackCalls.push(track);
  }

  getRemoteAudioStream(): MediaStream | null {
    return this.remoteStream;
  }

  getAudioContext(): AudioContext | null {
    return null;
  }

  async sendDataChannelMessage(message: RealtimeEvent): Promise<void> {
    this.messages.push(message);
  }

  addEventListener(type: string, handler: EventHandler): void {
    const bucket = this.listeners.get(type) ?? new Set<EventHandler>();
    bucket.add(handler);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, handler: EventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(type: string, data: any): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of Array.from(handlers)) {
      handler({ data });
    }
  }
}

class AudioManagerMock {
  public initializeCalls = 0;
  public disposeCalls = 0;
  public capturedTrack?: MediaStreamTrack;
  public captureCalls = 0;
  public addToTransportCalls: Array<{
    transport: TransportMock;
    track: MediaStreamTrack;
  }> = [];
  public stopTrackCalls: string[] = [];
  public remoteStreams: MediaStream[] = [];
  public lastConfig?: WebRTCConfig["audioConfig"];
  public lastQuality?: ConnectionQuality;

  async initialize(): Promise<void> {
    this.initializeCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }

  setAudioConfiguration(config: WebRTCConfig["audioConfig"]): void {
    this.lastConfig = config;
  }

  async captureMicrophone(): Promise<MediaStreamTrack> {
    this.captureCalls += 1;
    this.capturedTrack = createTrack("captured-track");
    return this.capturedTrack;
  }

  async addTrackToTransport(
    transport: TransportMock,
    track: MediaStreamTrack,
  ): Promise<void> {
    this.addToTransportCalls.push({ transport, track });
  }

  stopTrack(trackId: string): void {
    this.stopTrackCalls.push(trackId);
  }

  handleRemoteStream(stream: MediaStream): void {
    this.remoteStreams.push(stream);
  }

  async switchAudioDevice(
    deviceId: string,
    transport: TransportMock,
  ): Promise<MediaStreamTrack> {
    const replacement = createTrack(`device-${deviceId}`);
    await transport.addAudioTrack(replacement, { source: "switch" });
    return replacement;
  }

  async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    return [
      {
        deviceId: "mock-device",
        groupId: "group",
        kind: "audioinput",
        label: "Mock Device",
        toJSON: () => ({}),
      } as MediaDeviceInfo,
    ];
  }

  adjustAudioQuality(quality: ConnectionQuality): void {
    this.lastQuality = quality;
  }
}

class ConfigFactoryStub {
  public readonly config: WebRTCConfig;
  public createCalls: Array<{
    configManager: ConfigurationManagerStub;
    keyService: EphemeralKeyServiceStub;
  }> = [];
  public updateCalls: Array<{
    config: WebRTCConfig;
    keyService: EphemeralKeyServiceStub;
  }> = [];

  constructor(config?: WebRTCConfig) {
    this.config = config ?? createMockConfig();
  }

  async createConfig(
    configManager: ConfigurationManagerStub,
    keyService: EphemeralKeyServiceStub,
  ): Promise<WebRTCConfig> {
    this.createCalls.push({ configManager, keyService });
    return this.config;
  }

  async updateConfigWithNewKey(
    config: WebRTCConfig,
    keyService: EphemeralKeyServiceStub,
  ): Promise<WebRTCConfig> {
    this.updateCalls.push({ config, keyService });
    return config;
  }
}

class ErrorHandlerStub {
  public recoveryHandlers = new Set<(event: any) => void>();
  public authenticationHandlers = new Set<
    (error: WebRTCErrorImpl) => Promise<void>
  >();
  public connectionHandlers = new Set<
    (error: WebRTCErrorImpl) => Promise<void>
  >();
  public fatalHandlers = new Set<(error: WebRTCErrorImpl) => Promise<void>>();
  public handleErrorCalls: Array<{
    error: WebRTCErrorImpl;
    transport: TransportMock;
    config: WebRTCConfig;
  }> = [];
  public disposed = false;

  onRecoveryEvent(handler: (event: any) => void): { dispose: () => void } {
    this.recoveryHandlers.add(handler);
    return {
      dispose: () => this.recoveryHandlers.delete(handler),
    };
  }

  onAuthenticationError(
    handler: (error: WebRTCErrorImpl) => Promise<void>,
  ): { dispose: () => void } {
    this.authenticationHandlers.add(handler);
    return {
      dispose: () => this.authenticationHandlers.delete(handler),
    };
  }

  onConnectionError(
    handler: (error: WebRTCErrorImpl) => Promise<void>,
  ): { dispose: () => void } {
    this.connectionHandlers.add(handler);
    return {
      dispose: () => this.connectionHandlers.delete(handler),
    };
  }

  onFatalError(
    handler: (error: WebRTCErrorImpl) => Promise<void>,
  ): { dispose: () => void } {
    this.fatalHandlers.add(handler);
    return {
      dispose: () => this.fatalHandlers.delete(handler),
    };
  }

  async handleError(
    error: WebRTCErrorImpl,
    transport: TransportMock,
    config: WebRTCConfig,
  ): Promise<void> {
    this.handleErrorCalls.push({ error, transport, config });
  }

  async triggerAuthenticationError(error: WebRTCErrorImpl): Promise<void> {
    for (const handler of Array.from(this.authenticationHandlers)) {
      await handler(error);
    }
  }

  dispose(): void {
    this.disposed = true;
  }

  emitRecovery(event: any): void {
    for (const handler of Array.from(this.recoveryHandlers)) {
      handler(event);
    }
  }
}

class AudioPipelineStub implements AudioPipelineIntegration {
  public readonly inputRequests: number[] = [];
  public readonly outputStreams: MediaStream[] = [];
  public readonly qualityUpdates: ConnectionQuality[] = [];
  private readonly failInput: boolean;
  private readonly providedTrack?: MediaStreamTrack;

  constructor(options: { failInput?: boolean; track?: MediaStreamTrack } = {}) {
    this.failInput = options.failInput ?? false;
    this.providedTrack = options.track ?? createTrack("pipeline-track");
  }

  async onAudioInputRequired(): Promise<MediaStreamTrack> {
    this.inputRequests.push(Date.now());
    if (this.failInput) {
      throw new Error("pipeline unavailable");
    }
    return this.providedTrack!;
  }

  async onAudioOutputReceived(stream: MediaStream): Promise<void> {
    this.outputStreams.push(stream);
  }

  async onAudioQualityChanged(quality: ConnectionQuality): Promise<void> {
    this.qualityUpdates.push(quality);
  }
}

function createTrack(id: string): MediaStreamTrack {
  const track: any = {
    id,
    kind: "audio",
    label: id,
    enabled: true,
    muted: false,
    readyState: "live",
    stop() {
      track.readyState = "ended";
    },
    addEventListener() {
      /* noop */
    },
    removeEventListener() {
      /* noop */
    },
  };
  return track as MediaStreamTrack;
}

function createStream(id: string): MediaStream {
  const stream: any = {
    id,
    active: true,
    getAudioTracks() {
      return [];
    },
    getTracks() {
      return [];
    },
    addTrack() {
      /* noop */
    },
    removeTrack() {
      /* noop */
    },
  };
  return stream as MediaStream;
}

function createMockConfig(): WebRTCConfig {
  return {
    endpoint: {
      region: "eastus2",
      url: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
      deployment: "gpt-4o-realtime-preview",
      apiVersion: "2025-08-28",
    },
    authentication: {
      ephemeralKey: "ephemeral",
      expiresAt: new Date(Date.now() + 60000),
      keyInfo: {
        key: "ephemeral",
        sessionId: "session-id",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        isValid: true,
        secondsRemaining: 60,
        refreshAt: new Date(Date.now() + 30000),
        secondsUntilRefresh: 30,
        ttlSeconds: 60,
        refreshIntervalSeconds: 30,
      },
    },
    audioConfig: {
      sampleRate: 24000,
      codecProfileId: "pcm16-24k-mono",
      format: "pcm16",
      channels: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: "interactive",
        resumeOnActivation: true,
        requiresUserGesture: false,
      },
      workletModuleUrls: [],
    },
    sessionConfig: {
      locale: "en-US",
      voice: undefined,
      instructions: undefined,
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
      transcriptionModel: "whisper-1",
      turnDetection: {
        type: "server_vad",
        threshold: 0.5,
        prefixPaddingMs: 300,
        silenceDurationMs: 200,
        createResponse: true,
        interruptResponse: true,
        eagerness: "auto",
      },
    },
    dataChannelConfig: {
      channelName: "realtime-channel",
      ordered: true,
    },
    connectionConfig: {
      iceServers: [],
      reconnectAttempts: 3,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 5000,
    },
  };
}

function createHarness(options: HarnessOptions = {}) {
  const logger = new Logger("WebRTCTestHarness");
  logger.setLevel("error");

  const ephemeral = new EphemeralKeyServiceStub(
    options.ephemeralInitialized ?? true,
  );
  const configManager = new ConfigurationManagerStub(
    options.configInitialized ?? true,
  );
  const sessionManager = new SessionManagerStub();
  const service = new WebRTCAudioService(
    ephemeral as any,
    configManager as any,
    sessionManager as any,
    logger,
  );

  const transport = new TransportMock();
  const audioManager = new AudioManagerMock();
  const configFactory = new ConfigFactoryStub(options.config);
  const errorHandler = new ErrorHandlerStub();

  (service as any).transport = transport;
  (service as any).audioManager = audioManager;
  (service as any).configFactory = configFactory;
  (service as any).errorHandler.dispose?.();
  (service as any).errorHandler = errorHandler;
  (service as any).recoveryObserverDisposable?.dispose?.();
  (service as any).recoveryObserverDisposable = errorHandler.onRecoveryEvent(
    (event) => {
      (service as any).handleRecoveryTelemetry(event);
    },
  );
  (service as any).setupEventHandlers();

  if (options.sessionActive) {
    (service as any).initialized = true;
    (service as any).isSessionActive = true;
    (service as any).activeRealtimeConfig = configFactory.config;
    (service as any).applySessionPreferencesToConfig(configFactory.config);
  }

  return {
    service,
    logger,
    transport,
    audioManager,
    configFactory,
    errorHandler,
    ephemeral,
    configManager,
    sessionManager,
  };
}

function stubSharedAudioContext(): ProviderStub {
  const originalResume = sharedAudioContextProvider.resume;
  const originalSuspend = sharedAudioContextProvider.suspend;
  const originalClose = sharedAudioContextProvider.close;

  const stub = {
    resumeCalls: 0,
    suspendCalls: 0,
    closeCalls: 0,
    restore() {
      sharedAudioContextProvider.resume = originalResume;
      sharedAudioContextProvider.suspend = originalSuspend;
      sharedAudioContextProvider.close = originalClose;
    },
  } as ProviderStub;

  sharedAudioContextProvider.resume = async () => {
    stub.resumeCalls += 1;
  };

  sharedAudioContextProvider.suspend = async () => {
    stub.suspendCalls += 1;
  };

  sharedAudioContextProvider.close = async () => {
    stub.closeCalls += 1;
  };

  return stub;
}

suite("Unit: WebRTCAudioService realtime orchestration", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness({ sessionActive: true });
  });

  afterEach(() => {
    harness.service.dispose();
    harness.logger.dispose();
  });

  test("sends session update, conversation item, and response create in order", async () => {
    await harness.service.sendTextMessage("Hello there");

    expect(harness.transport.messages.map((event) => event.type)).to.deep.equal([
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);

    const sessionUpdate = harness.transport
      .messages[0] as SessionUpdateEvent;
    expect(sessionUpdate.session.modalities).to.deep.equal(["audio", "text"]);
    expect(sessionUpdate.session.output_modalities).to.deep.equal(["audio", "text"]);

    const responseCreate = harness.transport
      .messages[2] as ResponseCreateEvent;
    expect(responseCreate.response?.modalities).to.deep.equal(["audio", "text"]);
    expect(responseCreate.response?.output_modalities).to.deep.equal(["audio", "text"]);
  });

  test("prevents duplicate response.create dispatch while a response is pending", async () => {
    await harness.service.sendTextMessage("First turn");

    await expect(harness.service.sendTextMessage("Second turn")).to.be.rejectedWith(/already pending/);

    await (harness.service as any).handleDataChannelMessage({
      type: "response.created",
      response: {
        id: "resp_1",
        object: "realtime.response",
        status: "in_progress",
        output: [],
      },
    });

    await (harness.service as any).handleDataChannelMessage({
      type: "response.done",
      response: {
        id: "resp_1",
        object: "realtime.response",
        status: "completed",
        output: [],
      },
    });

    harness.transport.messages.length = 0;
    await harness.service.sendTextMessage("Second turn");
    expect(harness.transport.messages[0].type).to.equal("session.update");
  });

  test("pushes updated voice and instructions through session.update", async () => {
    await harness.service.updateSessionPreferences({
      voice: "phoebe",
      instructions: "Keep answers brief",
    });

    harness.transport.messages.length = 0;

    await harness.service.sendTextMessage("Configure session");

    const sessionUpdate = harness.transport
      .messages[0] as SessionUpdateEvent;
    expect(sessionUpdate.session.voice).to.equal("phoebe");
    expect(sessionUpdate.session.instructions).to.equal("Keep answers brief");

    const responseCreate = harness.transport
      .messages[2] as ResponseCreateEvent;
    expect(responseCreate.response?.voice).to.equal("phoebe");
    expect(responseCreate.response?.instructions).to.equal("Keep answers brief");
  });

  test("invokes transcript callback for completion events", async () => {
    const transcripts: string[] = [];
    (harness.service as any).onTranscriptReceived((text: string) => {
      transcripts.push(text);
      return Promise.resolve();
    });

    await (harness.service as any).handleDataChannelMessage({
      type: "response.output_text.done",
      text: "All set",
    });

    expect(transcripts).to.deep.equal(["All set"]);
    expect(harness.sessionManager.events.length).to.equal(1);
  });

  test("tracks credential metadata snapshots", async () => {
    const snapshots: EphemeralKeyInfo[] = [];
    harness.service.onCredentialStatusUpdated(async (info) => {
      snapshots.push(info);
    });

    const now = Date.now();
    (harness.service as any).updateCredentialStatus({
      key: "test-ephemeral",
      sessionId: "session-credential",
      issuedAt: new Date(now),
      expiresAt: new Date(now + 60000),
      isValid: true,
      secondsRemaining: 60,
      refreshAt: new Date(now + 45000),
      secondsUntilRefresh: 45,
      ttlSeconds: 60,
      refreshIntervalSeconds: 45,
    });

    await new Promise((resolve) => setImmediate(resolve));

    const status = harness.service.getCredentialStatus();
    expect(status).to.exist;
    expect(status?.sessionId).to.equal("session-credential");
    expect(status!.secondsRemaining <= 60).to.be.true;
    expect(snapshots.length).to.equal(1);
  });
});

suite("Unit: WebRTCAudioService lifecycle management", () => {
  let providerStub: ProviderStub;
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    providerStub = stubSharedAudioContext();
    harness = createHarness();
  });

  afterEach(() => {
    harness.service.dispose();
    harness.logger.dispose();
    providerStub.restore();
  });

  test("initializes transport and audio manager when dependencies are ready", async () => {
    await harness.service.initialize();

    expect(harness.service.isInitialized()).to.be.true;
    expect(harness.transport.initializeCalls).to.equal(1);
    expect(harness.audioManager.initializeCalls).to.equal(1);
  });

  test("throws when required services are not initialized", async () => {
    harness.ephemeral.initialized = false;
    await expect(harness.service.initialize()).to.be.rejectedWith(
      /EphemeralKeyService must be initialized/,
    );
  });

  test("starts a session using pipeline track and routes remote audio to integration", async () => {
    await harness.service.initialize();

    const pipeline = new AudioPipelineStub({ track: createTrack("pipeline") });
    harness.transport.remoteStream = createStream("remote-stream");
    harness.transport.statistics.connectionQuality = ConnectionQuality.Excellent;

    harness.service.registerAudioPipelineIntegration(pipeline);

    const states: string[] = [];
    harness.service.onSessionStateChanged(async (state) => {
      states.push(state);
    });

    await harness.service.startSession();

  expect(harness.transport.establishCalls.length).to.equal(1);
  expect(harness.audioManager.captureCalls).to.equal(0);
  expect(harness.transport.addTrackCalls.length).to.equal(1);
    const addOptions = harness.transport.addTrackCalls[0].options as any;
  expect(addOptions?.metadata?.source).to.equal("audio-pipeline");
  expect(pipeline.inputRequests.length).to.equal(1);
  expect(states).to.deep.equal(["active"]);
  expect(pipeline.outputStreams[0]).to.equal(harness.transport.remoteStream);
  expect(providerStub.resumeCalls).to.equal(1);

    harness.transport.emit("connectionQualityChanged", {
      currentQuality: ConnectionQuality.Poor,
    });

    expect(harness.audioManager.lastQuality).to.equal(ConnectionQuality.Poor);
    expect(pipeline.qualityUpdates.at(-1)).to.equal(ConnectionQuality.Poor);
  });

  test("falls back to audio capture when pipeline input fails and stops cleanly", async () => {
    await harness.service.initialize();

    const pipeline = new AudioPipelineStub({ failInput: true });
    harness.service.registerAudioPipelineIntegration(pipeline);
    harness.transport.remoteStream = createStream("fallback-remote");

    await harness.service.startSession();

  expect(harness.audioManager.captureCalls).to.equal(1);
  expect(harness.audioManager.addToTransportCalls.length).to.equal(1);

    await harness.service.stopSession();

    expect(harness.transport.closeCalls).to.equal(1);
    expect(harness.audioManager.stopTrackCalls.length).to.equal(1);
    expect(harness.service.getSessionStatus().isActive).to.be.false;
    expect(providerStub.suspendCalls).to.equal(1);
  });

  test("handles transport errors via config factory and error handler", async () => {
    await harness.service.initialize();

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.NetworkTimeout,
      message: "timeout",
      recoverable: true,
      timestamp: new Date(),
    });

    await (harness.service as any).handleTransportError(error);

    expect(harness.configFactory.createCalls.length).to.equal(1);
    expect(harness.errorHandler.handleErrorCalls.length).to.equal(1);
    expect(harness.errorHandler.handleErrorCalls[0].error.code).to.equal(
      WebRTCErrorCode.NetworkTimeout,
    );
  });

  test("renews ephemeral key when authentication error is surfaced", async () => {
    await harness.service.initialize();

    (harness.service as any).isSessionActive = true;
    (harness.service as any).activeRealtimeConfig = harness.configFactory.config;

    const error = new WebRTCErrorImpl({
      code: WebRTCErrorCode.AuthenticationFailed,
      message: "auth",
      recoverable: true,
      timestamp: new Date(),
    });

    await harness.errorHandler.triggerAuthenticationError(error);

    expect(harness.ephemeral.renewCalls).to.equal(1);
    expect(harness.configFactory.createCalls.length >= 1).to.be.true;
    expect(harness.transport.establishCalls.length >= 1).to.be.true;
  });

  test("emits telemetry events to registered observers", async () => {
    await harness.service.initialize();

    const events: any[] = [];
    const disposable = harness.service.addTelemetryObserver((event) => {
      events.push(event);
    });

    harness.errorHandler.emitRecovery({
      type: "attempt",
      strategy: "ice",
      attempt: 1,
      delayMs: 100,
    });

    harness.transport.emit("fallbackStateChanged", {
      fallbackActive: true,
      queuedMessages: 2,
      reason: "manual",
    });

    harness.transport.emit("connectionDiagnostics", {
      statsIntervalMs: 1000,
      statistics: harness.transport.statistics,
      negotiation: { durationMs: 50, timeoutMs: 5000, timedOut: false },
    });

    expect(events.map((event) => event.type)).to.deep.equal([
      "reconnectAttempt",
      "fallbackStateChanged",
      "connectionDiagnostics",
    ]);

    disposable.dispose();
  });
});

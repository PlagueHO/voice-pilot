"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_context_provider_1 = require("../../src/../audio/audio-context-provider");
const webrtc_audio_service_1 = require("../../src/../audio/webrtc-audio-service");
const logger_1 = require("../../src/../core/logger");
const webrtc_1 = require("../../src/../types/webrtc");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
class EphemeralKeyServiceStub {
    initialized;
    renewCalls = 0;
    currentKey;
    renewHandlers = new Set();
    expireHandlers = new Set();
    constructor(initialized = true) {
        this.initialized = initialized;
    }
    isInitialized() {
        return this.initialized;
    }
    getCurrentKey() {
        return this.currentKey;
    }
    setCurrentKey(info) {
        this.currentKey = info;
    }
    async renewKey() {
        this.renewCalls += 1;
    }
    onKeyRenewed(handler) {
        this.renewHandlers.add(handler);
        return {
            dispose: () => {
                this.renewHandlers.delete(handler);
            },
        };
    }
    onKeyExpired(handler) {
        this.expireHandlers.add(handler);
        return {
            dispose: () => {
                this.expireHandlers.delete(handler);
            },
        };
    }
    async triggerRenewHandlers() {
        for (const handler of Array.from(this.renewHandlers)) {
            await handler();
        }
    }
    async triggerExpireHandlers(info) {
        for (const handler of Array.from(this.expireHandlers)) {
            await handler(info);
        }
    }
}
class ConfigurationManagerStub {
    initializedFlag;
    constructor(initialized = true) {
        this.initializedFlag = initialized;
    }
    isInitialized() {
        return this.initializedFlag;
    }
}
class SessionManagerStub {
    events = [];
    handleRealtimeTranscriptEvent(event) {
        this.events.push(event);
    }
}
class TransportMock {
    initializeCalls = 0;
    establishCalls = [];
    closeCalls = 0;
    addTrackCalls = [];
    removeTrackCalls = [];
    messages = [];
    publishedRecoveryEvents = [];
    listeners = new Map();
    connectionState = webrtc_1.WebRTCConnectionState.Disconnected;
    fallbackActive = false;
    dataChannelState = "open";
    remoteStream = null;
    statistics = {
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
        connectionQuality: webrtc_1.ConnectionQuality.Good,
    };
    async initialize() {
        this.initializeCalls += 1;
    }
    async establishConnection(config) {
        this.establishCalls.push(config);
        this.connectionState = webrtc_1.WebRTCConnectionState.Connected;
        return {
            success: true,
            connectionId: "mock-connection",
            connectionState: this.connectionState,
            audioTracks: [],
            remoteStream: this.remoteStream,
        };
    }
    async closeConnection() {
        this.closeCalls += 1;
        this.connectionState = webrtc_1.WebRTCConnectionState.Closed;
    }
    async restartIce() {
        return true;
    }
    async recreateDataChannel() {
        return null;
    }
    getConnectionState() {
        return this.connectionState;
    }
    getConnectionStatistics() {
        return this.statistics;
    }
    getDataChannelState() {
        return this.dataChannelState;
    }
    isDataChannelFallbackActive() {
        return this.fallbackActive;
    }
    publishRecoveryEvent(event) {
        this.publishedRecoveryEvents.push(event);
    }
    dispose() {
        this.connectionState = webrtc_1.WebRTCConnectionState.Closed;
    }
    async addAudioTrack(track, options) {
        this.addTrackCalls.push({ track, options });
    }
    async removeAudioTrack(track) {
        this.removeTrackCalls.push(track);
    }
    getRemoteAudioStream() {
        return this.remoteStream;
    }
    getAudioContext() {
        return null;
    }
    async sendDataChannelMessage(message) {
        this.messages.push(message);
    }
    addEventListener(type, handler) {
        const bucket = this.listeners.get(type) ?? new Set();
        bucket.add(handler);
        this.listeners.set(type, bucket);
    }
    removeEventListener(type, handler) {
        this.listeners.get(type)?.delete(handler);
    }
    emit(type, data) {
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
    initializeCalls = 0;
    disposeCalls = 0;
    capturedTrack;
    captureCalls = 0;
    addToTransportCalls = [];
    stopTrackCalls = [];
    remoteStreams = [];
    lastConfig;
    lastQuality;
    async initialize() {
        this.initializeCalls += 1;
    }
    dispose() {
        this.disposeCalls += 1;
    }
    setAudioConfiguration(config) {
        this.lastConfig = config;
    }
    async captureMicrophone() {
        this.captureCalls += 1;
        this.capturedTrack = createTrack("captured-track");
        return this.capturedTrack;
    }
    async addTrackToTransport(transport, track) {
        this.addToTransportCalls.push({ transport, track });
    }
    stopTrack(trackId) {
        this.stopTrackCalls.push(trackId);
    }
    handleRemoteStream(stream) {
        this.remoteStreams.push(stream);
    }
    async switchAudioDevice(deviceId, transport) {
        const replacement = createTrack(`device-${deviceId}`);
        await transport.addAudioTrack(replacement, { source: "switch" });
        return replacement;
    }
    async getAudioInputDevices() {
        return [
            {
                deviceId: "mock-device",
                groupId: "group",
                kind: "audioinput",
                label: "Mock Device",
                toJSON: () => ({}),
            },
        ];
    }
    adjustAudioQuality(quality) {
        this.lastQuality = quality;
    }
}
class ConfigFactoryStub {
    config;
    createCalls = [];
    updateCalls = [];
    constructor(config) {
        this.config = config ?? createMockConfig();
    }
    async createConfig(configManager, keyService) {
        this.createCalls.push({ configManager, keyService });
        return this.config;
    }
    async updateConfigWithNewKey(config, keyService) {
        this.updateCalls.push({ config, keyService });
        return config;
    }
}
class ErrorHandlerStub {
    recoveryHandlers = new Set();
    authenticationHandlers = new Set();
    connectionHandlers = new Set();
    fatalHandlers = new Set();
    handleErrorCalls = [];
    disposed = false;
    onRecoveryEvent(handler) {
        this.recoveryHandlers.add(handler);
        return {
            dispose: () => this.recoveryHandlers.delete(handler),
        };
    }
    onAuthenticationError(handler) {
        this.authenticationHandlers.add(handler);
        return {
            dispose: () => this.authenticationHandlers.delete(handler),
        };
    }
    onConnectionError(handler) {
        this.connectionHandlers.add(handler);
        return {
            dispose: () => this.connectionHandlers.delete(handler),
        };
    }
    onFatalError(handler) {
        this.fatalHandlers.add(handler);
        return {
            dispose: () => this.fatalHandlers.delete(handler),
        };
    }
    async handleError(error, transport, config) {
        this.handleErrorCalls.push({ error, transport, config });
    }
    async triggerAuthenticationError(error) {
        for (const handler of Array.from(this.authenticationHandlers)) {
            await handler(error);
        }
    }
    dispose() {
        this.disposed = true;
    }
    emitRecovery(event) {
        for (const handler of Array.from(this.recoveryHandlers)) {
            handler(event);
        }
    }
}
class AudioPipelineStub {
    inputRequests = [];
    outputStreams = [];
    qualityUpdates = [];
    failInput;
    providedTrack;
    constructor(options = {}) {
        this.failInput = options.failInput ?? false;
        this.providedTrack = options.track ?? createTrack("pipeline-track");
    }
    async onAudioInputRequired() {
        this.inputRequests.push(Date.now());
        if (this.failInput) {
            throw new Error("pipeline unavailable");
        }
        return this.providedTrack;
    }
    async onAudioOutputReceived(stream) {
        this.outputStreams.push(stream);
    }
    async onAudioQualityChanged(quality) {
        this.qualityUpdates.push(quality);
    }
}
function createTrack(id) {
    const track = {
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
    return track;
}
function createStream(id) {
    const stream = {
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
    return stream;
}
function createMockConfig() {
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
function createHarness(options = {}) {
    const logger = new logger_1.Logger("WebRTCTestHarness");
    logger.setLevel("error");
    const ephemeral = new EphemeralKeyServiceStub(options.ephemeralInitialized ?? true);
    const configManager = new ConfigurationManagerStub(options.configInitialized ?? true);
    const sessionManager = new SessionManagerStub();
    const service = new webrtc_audio_service_1.WebRTCAudioService(ephemeral, configManager, sessionManager, logger);
    const transport = new TransportMock();
    const audioManager = new AudioManagerMock();
    const configFactory = new ConfigFactoryStub(options.config);
    const errorHandler = new ErrorHandlerStub();
    service.transport = transport;
    service.audioManager = audioManager;
    service.configFactory = configFactory;
    service.errorHandler.dispose?.();
    service.errorHandler = errorHandler;
    service.recoveryObserverDisposable?.dispose?.();
    service.recoveryObserverDisposable = errorHandler.onRecoveryEvent((event) => {
        service.handleRecoveryTelemetry(event);
    });
    service.setupEventHandlers();
    if (options.sessionActive) {
        service.initialized = true;
        service.isSessionActive = true;
        service.activeRealtimeConfig = configFactory.config;
        service.applySessionPreferencesToConfig(configFactory.config);
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
function stubSharedAudioContext() {
    const originalResume = audio_context_provider_1.sharedAudioContextProvider.resume;
    const originalSuspend = audio_context_provider_1.sharedAudioContextProvider.suspend;
    const originalClose = audio_context_provider_1.sharedAudioContextProvider.close;
    const stub = {
        resumeCalls: 0,
        suspendCalls: 0,
        closeCalls: 0,
        restore() {
            audio_context_provider_1.sharedAudioContextProvider.resume = originalResume;
            audio_context_provider_1.sharedAudioContextProvider.suspend = originalSuspend;
            audio_context_provider_1.sharedAudioContextProvider.close = originalClose;
        },
    };
    audio_context_provider_1.sharedAudioContextProvider.resume = async () => {
        stub.resumeCalls += 1;
    };
    audio_context_provider_1.sharedAudioContextProvider.suspend = async () => {
        stub.suspendCalls += 1;
    };
    audio_context_provider_1.sharedAudioContextProvider.close = async () => {
        stub.closeCalls += 1;
    };
    return stub;
}
(0, mocha_globals_1.suite)("Unit: WebRTCAudioService realtime orchestration", () => {
    let harness;
    (0, mocha_globals_1.beforeEach)(() => {
        harness = createHarness({ sessionActive: true });
    });
    (0, mocha_globals_1.afterEach)(() => {
        harness.service.dispose();
        harness.logger.dispose();
    });
    (0, mocha_globals_1.test)("sends session update, conversation item, and response create in order", async () => {
        await harness.service.sendTextMessage("Hello there");
        (0, chai_setup_1.expect)(harness.transport.messages.map((event) => event.type)).to.deep.equal([
            "session.update",
            "conversation.item.create",
            "response.create",
        ]);
        const sessionUpdate = harness.transport
            .messages[0];
        (0, chai_setup_1.expect)(sessionUpdate.session.modalities).to.deep.equal(["audio", "text"]);
        (0, chai_setup_1.expect)(sessionUpdate.session.output_modalities).to.deep.equal(["audio", "text"]);
        const responseCreate = harness.transport
            .messages[2];
        (0, chai_setup_1.expect)(responseCreate.response?.modalities).to.deep.equal(["audio", "text"]);
        (0, chai_setup_1.expect)(responseCreate.response?.output_modalities).to.deep.equal(["audio", "text"]);
    });
    (0, mocha_globals_1.test)("prevents duplicate response.create dispatch while a response is pending", async () => {
        await harness.service.sendTextMessage("First turn");
        await (0, chai_setup_1.expect)(harness.service.sendTextMessage("Second turn")).to.be.rejectedWith(/already pending/);
        await harness.service.handleDataChannelMessage({
            type: "response.created",
            response: {
                id: "resp_1",
                object: "realtime.response",
                status: "in_progress",
                output: [],
            },
        });
        await harness.service.handleDataChannelMessage({
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
        (0, chai_setup_1.expect)(harness.transport.messages[0].type).to.equal("session.update");
    });
    (0, mocha_globals_1.test)("pushes updated voice and instructions through session.update", async () => {
        await harness.service.updateSessionPreferences({
            voice: "phoebe",
            instructions: "Keep answers brief",
        });
        harness.transport.messages.length = 0;
        await harness.service.sendTextMessage("Configure session");
        const sessionUpdate = harness.transport
            .messages[0];
        (0, chai_setup_1.expect)(sessionUpdate.session.voice).to.equal("phoebe");
        (0, chai_setup_1.expect)(sessionUpdate.session.instructions).to.equal("Keep answers brief");
        const responseCreate = harness.transport
            .messages[2];
        (0, chai_setup_1.expect)(responseCreate.response?.voice).to.equal("phoebe");
        (0, chai_setup_1.expect)(responseCreate.response?.instructions).to.equal("Keep answers brief");
    });
    (0, mocha_globals_1.test)("invokes transcript callback for completion events", async () => {
        const transcripts = [];
        harness.service.onTranscriptReceived((text) => {
            transcripts.push(text);
            return Promise.resolve();
        });
        await harness.service.handleDataChannelMessage({
            type: "response.output_text.done",
            text: "All set",
        });
        (0, chai_setup_1.expect)(transcripts).to.deep.equal(["All set"]);
        (0, chai_setup_1.expect)(harness.sessionManager.events.length).to.equal(1);
    });
    (0, mocha_globals_1.test)("tracks credential metadata snapshots", async () => {
        const snapshots = [];
        harness.service.onCredentialStatusUpdated(async (info) => {
            snapshots.push(info);
        });
        const now = Date.now();
        harness.service.updateCredentialStatus({
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
        (0, chai_setup_1.expect)(status).to.exist;
        (0, chai_setup_1.expect)(status?.sessionId).to.equal("session-credential");
        (0, chai_setup_1.expect)(status.secondsRemaining <= 60).to.be.true;
        (0, chai_setup_1.expect)(snapshots.length).to.equal(1);
    });
});
(0, mocha_globals_1.suite)("Unit: WebRTCAudioService lifecycle management", () => {
    let providerStub;
    let harness;
    (0, mocha_globals_1.beforeEach)(() => {
        providerStub = stubSharedAudioContext();
        harness = createHarness();
    });
    (0, mocha_globals_1.afterEach)(() => {
        harness.service.dispose();
        harness.logger.dispose();
        providerStub.restore();
    });
    (0, mocha_globals_1.test)("initializes transport and audio manager when dependencies are ready", async () => {
        await harness.service.initialize();
        (0, chai_setup_1.expect)(harness.service.isInitialized()).to.be.true;
        (0, chai_setup_1.expect)(harness.transport.initializeCalls).to.equal(1);
        (0, chai_setup_1.expect)(harness.audioManager.initializeCalls).to.equal(1);
    });
    (0, mocha_globals_1.test)("throws when required services are not initialized", async () => {
        harness.ephemeral.initialized = false;
        await (0, chai_setup_1.expect)(harness.service.initialize()).to.be.rejectedWith(/EphemeralKeyService must be initialized/);
    });
    (0, mocha_globals_1.test)("starts a session using pipeline track and routes remote audio to integration", async () => {
        await harness.service.initialize();
        const pipeline = new AudioPipelineStub({ track: createTrack("pipeline") });
        harness.transport.remoteStream = createStream("remote-stream");
        harness.transport.statistics.connectionQuality = webrtc_1.ConnectionQuality.Excellent;
        harness.service.registerAudioPipelineIntegration(pipeline);
        const states = [];
        harness.service.onSessionStateChanged(async (state) => {
            states.push(state);
        });
        await harness.service.startSession();
        (0, chai_setup_1.expect)(harness.transport.establishCalls.length).to.equal(1);
        (0, chai_setup_1.expect)(harness.audioManager.captureCalls).to.equal(0);
        (0, chai_setup_1.expect)(harness.transport.addTrackCalls.length).to.equal(1);
        const addOptions = harness.transport.addTrackCalls[0].options;
        (0, chai_setup_1.expect)(addOptions?.metadata?.source).to.equal("audio-pipeline");
        (0, chai_setup_1.expect)(pipeline.inputRequests.length).to.equal(1);
        (0, chai_setup_1.expect)(states).to.deep.equal(["active"]);
        (0, chai_setup_1.expect)(pipeline.outputStreams[0]).to.equal(harness.transport.remoteStream);
        (0, chai_setup_1.expect)(providerStub.resumeCalls).to.equal(1);
        harness.transport.emit("connectionQualityChanged", {
            currentQuality: webrtc_1.ConnectionQuality.Poor,
        });
        (0, chai_setup_1.expect)(harness.audioManager.lastQuality).to.equal(webrtc_1.ConnectionQuality.Poor);
        (0, chai_setup_1.expect)(pipeline.qualityUpdates.at(-1)).to.equal(webrtc_1.ConnectionQuality.Poor);
    });
    (0, mocha_globals_1.test)("falls back to audio capture when pipeline input fails and stops cleanly", async () => {
        await harness.service.initialize();
        const pipeline = new AudioPipelineStub({ failInput: true });
        harness.service.registerAudioPipelineIntegration(pipeline);
        harness.transport.remoteStream = createStream("fallback-remote");
        await harness.service.startSession();
        (0, chai_setup_1.expect)(harness.audioManager.captureCalls).to.equal(1);
        (0, chai_setup_1.expect)(harness.audioManager.addToTransportCalls.length).to.equal(1);
        await harness.service.stopSession();
        (0, chai_setup_1.expect)(harness.transport.closeCalls).to.equal(1);
        (0, chai_setup_1.expect)(harness.audioManager.stopTrackCalls.length).to.equal(1);
        (0, chai_setup_1.expect)(harness.service.getSessionStatus().isActive).to.be.false;
        (0, chai_setup_1.expect)(providerStub.suspendCalls).to.equal(1);
    });
    (0, mocha_globals_1.test)("handles transport errors via config factory and error handler", async () => {
        await harness.service.initialize();
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.NetworkTimeout,
            message: "timeout",
            recoverable: true,
            timestamp: new Date(),
        });
        await harness.service.handleTransportError(error);
        (0, chai_setup_1.expect)(harness.configFactory.createCalls.length).to.equal(1);
        (0, chai_setup_1.expect)(harness.errorHandler.handleErrorCalls.length).to.equal(1);
        (0, chai_setup_1.expect)(harness.errorHandler.handleErrorCalls[0].error.code).to.equal(webrtc_1.WebRTCErrorCode.NetworkTimeout);
    });
    (0, mocha_globals_1.test)("renews ephemeral key when authentication error is surfaced", async () => {
        await harness.service.initialize();
        harness.service.isSessionActive = true;
        harness.service.activeRealtimeConfig = harness.configFactory.config;
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.AuthenticationFailed,
            message: "auth",
            recoverable: true,
            timestamp: new Date(),
        });
        await harness.errorHandler.triggerAuthenticationError(error);
        (0, chai_setup_1.expect)(harness.ephemeral.renewCalls).to.equal(1);
        (0, chai_setup_1.expect)(harness.configFactory.createCalls.length >= 1).to.be.true;
        (0, chai_setup_1.expect)(harness.transport.establishCalls.length >= 1).to.be.true;
    });
    (0, mocha_globals_1.test)("emits telemetry events to registered observers", async () => {
        await harness.service.initialize();
        const events = [];
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
        (0, chai_setup_1.expect)(events.map((event) => event.type)).to.deep.equal([
            "reconnectAttempt",
            "fallbackStateChanged",
            "connectionDiagnostics",
        ]);
        disposable.dispose();
    });
});
//# sourceMappingURL=webrtc-audio-service.unit.test.js.map
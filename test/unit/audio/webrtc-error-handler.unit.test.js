"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webrtc_error_handler_1 = require("../../src/../audio/webrtc-error-handler");
const webrtc_1 = require("../../src/../types/webrtc");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createTestLogger() {
    const entries = [];
    const logger = {
        debug: (message, data) => {
            entries.push({ level: "debug", message, data });
        },
        info: (message, data) => {
            entries.push({ level: "info", message, data });
        },
        warn: (message, data) => {
            entries.push({ level: "warn", message, data });
        },
        error: (message, data) => {
            entries.push({ level: "error", message, data });
        },
        setLevel: () => {
            /* noop */
        },
        dispose: () => {
            /* noop */
        },
        recordGateTaskOutcome: async () => {
            /* noop */
        },
    };
    return { logger, entries };
}
class RecoveryManagerTestDouble {
    configureCalls = [];
    handleCalls = [];
    nextResults = [];
    observers = [];
    disposed = false;
    configure(options) {
        this.configureCalls.push(options);
    }
    addObserver(observer) {
        this.observers.push(observer);
        return {
            dispose: () => {
                this.observers = this.observers.filter((entry) => entry !== observer);
            },
        };
    }
    async handleConnectionFailure(transport, config, error) {
        this.handleCalls.push({ transport, config, error });
        if (this.nextResults.length > 0) {
            return this.nextResults.shift();
        }
        return true;
    }
    emit(event) {
        for (const observer of [...this.observers]) {
            observer(event);
        }
    }
    clearObservers() {
        this.observers = [];
    }
}
class WebRTCTransportStub {
    recoveryEvents = [];
    async establishConnection(config) {
        return {
            success: true,
            connectionId: "test",
            connectionState: webrtc_1.WebRTCConnectionState.Connected,
            audioTracks: [],
        };
    }
    async closeConnection() {
        /* noop */
    }
    async restartIce(config) {
        return true;
    }
    async recreateDataChannel(config) {
        return null;
    }
    getConnectionState() {
        return webrtc_1.WebRTCConnectionState.Connected;
    }
    getConnectionStatistics() {
        return {
            connectionId: "test",
            connectionDurationMs: 0,
            audioPacketsSent: 0,
            audioPacketsReceived: 0,
            audioBytesSent: 0,
            audioBytesReceived: 0,
            currentRoundTripTime: 0,
            packetsLost: 0,
            jitter: 0,
            dataChannelState: "open",
            iceConnectionState: "connected",
            connectionQuality: webrtc_1.ConnectionQuality.Good,
        };
    }
    getDataChannelState() {
        return "open";
    }
    isDataChannelFallbackActive() {
        return false;
    }
    publishRecoveryEvent(event) {
        this.recoveryEvents.push(event);
    }
    async addAudioTrack(track, options) {
        /* noop */
    }
    async replaceAudioTrack(oldTrack, newTrack, options) {
        /* noop */
    }
    async removeAudioTrack(track) {
        /* noop */
    }
    getRemoteAudioStream() {
        return null;
    }
    getAudioContext() {
        return null;
    }
    async sendDataChannelMessage(message) {
        /* noop */
    }
    addEventListener(type, handler) {
        /* noop */
    }
    removeEventListener(type, handler) {
        /* noop */
    }
}
function createConfig() {
    const expiresAt = new Date(Date.now() + 60000);
    const refreshAt = new Date(Date.now() + 30000);
    return {
        endpoint: {
            region: "eastus2",
            url: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
            deployment: "gpt-4o-realtime-preview",
            apiVersion: "2025-08-28",
        },
        authentication: {
            ephemeralKey: "ephemeral-key",
            expiresAt,
            keyInfo: {
                key: "ephemeral-key",
                sessionId: "session",
                issuedAt: new Date(),
                expiresAt,
                isValid: true,
                secondsRemaining: 60,
                refreshAt,
                secondsUntilRefresh: 30,
                ttlSeconds: 60,
                refreshIntervalSeconds: 45,
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
                requiresUserGesture: true,
            },
            workletModuleUrls: [],
        },
        sessionConfig: {
            voice: "alloy",
            locale: "en-US",
            inputAudioFormat: "pcm16",
            outputAudioFormat: "pcm16",
            transcriptionModel: "whisper-1",
            turnDetection: undefined,
        },
        dataChannelConfig: {
            channelName: "realtime-channel",
            ordered: true,
            maxRetransmits: 3,
        },
        connectionConfig: {
            reconnectAttempts: 3,
            reconnectDelayMs: 1000,
            connectionTimeoutMs: 5000,
        },
    };
}
function createHandlerHarness() {
    const { logger, entries } = createTestLogger();
    const handler = new webrtc_error_handler_1.WebRTCErrorHandler(logger);
    const originalSubscription = handler.recoverySubscription;
    originalSubscription.dispose();
    const recoveryManager = new RecoveryManagerTestDouble();
    handler.recoveryManager = recoveryManager;
    const forwarder = (event) => {
        handler.notifyRecoveryObservers(event);
    };
    const subscription = recoveryManager.addObserver(forwarder);
    handler.recoverySubscription = {
        dispose: () => {
            recoveryManager.disposed = true;
            subscription.dispose();
            recoveryManager.clearObservers();
        },
    };
    return { handler, recoveryManager, entries, logger };
}
function buildError(code, options = {}) {
    return new webrtc_1.WebRTCErrorImpl({
        code: code,
        message: options.message ?? "test-error",
        recoverable: options.recoverable ?? false,
        details: options.details,
        timestamp: options.timestamp ?? new Date(),
    });
}
(0, mocha_globals_1.suite)("WebRTCErrorHandler", () => {
    (0, mocha_globals_1.test)("classifies errors based on known patterns", () => {
        const { handler } = createHandlerHarness();
        (0, chai_setup_1.expect)(handler.classifyError({ name: "NotAllowedError" })).to.equal(webrtc_1.WebRTCErrorCode.AuthenticationFailed);
        (0, chai_setup_1.expect)(handler.classifyError({ name: "DevicesNotFoundError" })).to.equal(webrtc_1.WebRTCErrorCode.AudioTrackFailed);
        (0, chai_setup_1.expect)(handler.classifyError({ message: "data channel closed" })).to.equal(webrtc_1.WebRTCErrorCode.DataChannelFailed);
        (0, chai_setup_1.expect)(handler.classifyError({ message: "ICE connection lost" })).to.equal(webrtc_1.WebRTCErrorCode.IceConnectionFailed);
        (0, chai_setup_1.expect)(handler.classifyError({ message: "region unsupported" })).to.equal(webrtc_1.WebRTCErrorCode.RegionNotSupported);
    });
    (0, mocha_globals_1.test)("wraps unknown errors with recoverable flags inferred from classification", () => {
        const { handler } = createHandlerHarness();
        const dataChannelError = handler.createWebRTCError({
            message: "data channel failure",
        });
        (0, chai_setup_1.expect)(dataChannelError.code).to.equal(webrtc_1.WebRTCErrorCode.DataChannelFailed);
        (0, chai_setup_1.expect)(dataChannelError.recoverable).to.be.true;
        const authError = handler.createWebRTCError({
            name: "NotAllowedError",
            message: "permission denied",
        });
        (0, chai_setup_1.expect)(authError.code).to.equal(webrtc_1.WebRTCErrorCode.AuthenticationFailed);
        (0, chai_setup_1.expect)(authError.recoverable).to.be.false;
    });
    (0, mocha_globals_1.test)("invokes authentication callback when credentials fail", async () => {
        const { handler, recoveryManager } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        recoveryManager.nextResults = [true];
        let invoked = 0;
        handler.onAuthenticationError(async (error) => {
            invoked += 1;
            (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.AuthenticationFailed);
        });
        await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.AuthenticationFailed), transport, config);
        (0, chai_setup_1.expect)(invoked).to.equal(1);
        (0, chai_setup_1.expect)(recoveryManager.handleCalls).to.have.lengthOf(0);
    });
    (0, mocha_globals_1.test)("attempts recovery and raises connection callback when recovery fails", async () => {
        const { handler, recoveryManager } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        recoveryManager.nextResults = [false];
        let callbackCount = 0;
        handler.onConnectionError(async (error) => {
            callbackCount += 1;
            (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.NetworkTimeout);
        });
        await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.NetworkTimeout, { recoverable: true }), transport, config);
        (0, chai_setup_1.expect)(recoveryManager.handleCalls).to.have.lengthOf(1);
        (0, chai_setup_1.expect)(callbackCount).to.equal(1);
    });
    (0, mocha_globals_1.test)("suppresses connection callback when data channel recovery succeeds", async () => {
        const { handler, recoveryManager } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        recoveryManager.nextResults = [true];
        let callbackCount = 0;
        handler.onConnectionError(async () => {
            callbackCount += 1;
        });
        await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.DataChannelFailed, { recoverable: true }), transport, config);
        (0, chai_setup_1.expect)(recoveryManager.handleCalls).to.have.lengthOf(1);
        (0, chai_setup_1.expect)(callbackCount).to.equal(0);
    });
    (0, mocha_globals_1.test)("escalates fatal errors via the registered callback", async () => {
        const { handler } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        let fatalCount = 0;
        handler.onFatalError(async (error) => {
            fatalCount += 1;
            (0, chai_setup_1.expect)(error.code).to.equal(webrtc_1.WebRTCErrorCode.ConfigurationInvalid);
        });
        await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.ConfigurationInvalid), transport, config);
        (0, chai_setup_1.expect)(fatalCount).to.equal(1);
    });
    (0, mocha_globals_1.test)("routes unknown recoverable errors through the recovery manager", async () => {
        const { handler, recoveryManager } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        recoveryManager.nextResults = [true];
        await handler.handleError(buildError("CUSTOM_ERROR", { recoverable: true }), transport, config);
        (0, chai_setup_1.expect)(recoveryManager.handleCalls).to.have.lengthOf(1);
    });
    (0, mocha_globals_1.test)("forwards recovery events to observers", () => {
        const { handler, recoveryManager } = createHandlerHarness();
        const received = [];
        const disposable = handler.onRecoveryEvent((event) => {
            received.push(event);
        });
        const event = {
            type: "attempt",
            attempt: 1,
            strategy: "full_reconnect",
            delayMs: 100,
        };
        recoveryManager.emit(event);
        (0, chai_setup_1.expect)(received).to.have.lengthOf(1);
        (0, chai_setup_1.expect)(received[0]).to.equal(event);
        disposable.dispose();
        recoveryManager.emit(event);
        (0, chai_setup_1.expect)(received).to.have.lengthOf(1);
    });
    (0, mocha_globals_1.test)("collects error statistics including recency and counts", async () => {
        const { handler } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        const baseline = Date.now();
        const originalNow = Date.now;
        Date.now = () => baseline;
        try {
            await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.NetworkTimeout, {
                recoverable: true,
                timestamp: new Date(baseline - 60000),
            }), transport, config);
            await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.AuthenticationFailed, {
                timestamp: new Date(baseline - 7200000),
            }), transport, config);
        }
        finally {
            Date.now = originalNow;
        }
        const stats = handler.getErrorStatistics();
        (0, chai_setup_1.expect)(stats.totalErrors).to.equal(2);
        (0, chai_setup_1.expect)(stats.recentErrors).to.equal(1);
        (0, chai_setup_1.expect)(stats.errorsByCode[webrtc_1.WebRTCErrorCode.NetworkTimeout]).to.equal(1);
        (0, chai_setup_1.expect)(stats.errorsByCode[webrtc_1.WebRTCErrorCode.AuthenticationFailed]).to.equal(1);
        (0, chai_setup_1.expect)(stats.lastError).to.exist;
        (0, chai_setup_1.expect)(stats.averageErrorsPerHour).to.equal(1);
    });
    (0, mocha_globals_1.test)("configures recovery strategy options", () => {
        const { handler, recoveryManager } = createHandlerHarness();
        handler.configureRecovery({ maxAttempts: 5, baseDelayMs: 250 });
        (0, chai_setup_1.expect)(recoveryManager.configureCalls).to.have.lengthOf(1);
        (0, chai_setup_1.expect)(recoveryManager.configureCalls[0]).to.deep.equal({
            maxAttempts: 5,
            baseDelayMs: 250,
        });
    });
    (0, mocha_globals_1.test)("disposes recovery subscription and observers", () => {
        const { handler, recoveryManager } = createHandlerHarness();
        handler.dispose();
        (0, chai_setup_1.expect)(recoveryManager.disposed).to.be.true;
        (0, chai_setup_1.expect)(recoveryManager.observers).to.have.lengthOf(0);
    });
    (0, mocha_globals_1.test)("logs each handled error with structured metadata", async () => {
        const { handler, entries } = createHandlerHarness();
        const transport = new WebRTCTransportStub();
        const config = createConfig();
        await handler.handleError(buildError(webrtc_1.WebRTCErrorCode.AudioTrackFailed), transport, config);
        const log = entries.find((entry) => entry.message.includes("WebRTC Error"));
        (0, chai_setup_1.expect)(log, "expected log entry for handled error").to.exist;
        (0, chai_setup_1.expect)(log?.data?.code).to.equal(webrtc_1.WebRTCErrorCode.AudioTrackFailed);
    });
});
//# sourceMappingURL=webrtc-error-handler.unit.test.js.map
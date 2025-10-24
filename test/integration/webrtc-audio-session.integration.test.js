"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const webrtc_audio_service_1 = require("../../src/audio/webrtc-audio-service");
const webrtc_config_factory_1 = require("../../src/audio/webrtc-config-factory");
const webrtc_1 = require("../../src/types/webrtc");
function createTestLogger() {
    const noop = () => {
        /* no-op */
    };
    return {
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        setLevel: noop,
        dispose: noop,
    };
}
class IntegrationStubTransport {
    registry = new Map();
    published = [];
    restartIceCalls = 0;
    fallbackActive = false;
    queuedMessages = 0;
    restartPlan;
    constructor(restartPlan) {
        this.restartPlan = restartPlan;
    }
    async establishConnection(_config) {
        return {
            success: true,
            connectionId: "stub",
            connectionState: webrtc_1.WebRTCConnectionState.Connected,
            audioTracks: [],
            remoteStream: undefined,
            dataChannel: undefined,
        };
    }
    async closeConnection() {
        /* no-op */
    }
    dispose() {
        /* no-op */
    }
    async restartIce(_config) {
        const result = this.restartPlan[this.restartIceCalls] ?? true;
        this.restartIceCalls += 1;
        return result;
    }
    async recreateDataChannel(_config) {
        return null;
    }
    getConnectionState() {
        return webrtc_1.WebRTCConnectionState.Connected;
    }
    getConnectionStatistics() {
        return {
            connectionId: "stub",
            connectionDurationMs: 0,
            audioPacketsSent: 0,
            audioPacketsReceived: 0,
            audioBytesSent: 0,
            audioBytesReceived: 0,
            packetsLost: 0,
            jitter: 0,
            dataChannelState: this.fallbackActive ? "connecting" : "open",
            iceConnectionState: "connected",
            connectionQuality: webrtc_1.ConnectionQuality.Good,
        };
    }
    getDataChannelState() {
        return this.fallbackActive ? "connecting" : "open";
    }
    isDataChannelFallbackActive() {
        return this.fallbackActive;
    }
    publishRecoveryEvent(event) {
        this.published.push(event);
        this.emit({
            type: event.type,
            connectionId: "stub",
            timestamp: new Date(),
            data: event.type === "reconnectAttempt"
                ? {
                    strategy: event.strategy,
                    attempt: event.attempt,
                    delayMs: event.delayMs,
                }
                : {
                    strategy: event.strategy,
                    attempt: event.attempt,
                    durationMs: event.durationMs,
                    error: event.type === "reconnectFailed" ? event.error : undefined,
                },
        });
    }
    addAudioTrack(_track, _options) {
        return Promise.resolve();
    }
    removeAudioTrack(_track) {
        return Promise.resolve();
    }
    getRemoteAudioStream() {
        return null;
    }
    getAudioContext() {
        return null;
    }
    sendDataChannelMessage(_message) {
        return Promise.resolve();
    }
    addEventListener(type, handler) {
        if (!this.registry.has(type)) {
            this.registry.set(type, new Set());
        }
        this.registry.get(type).add(handler);
    }
    removeEventListener(type, handler) {
        this.registry.get(type)?.delete(handler);
    }
    simulateFallback(active, queued, reason) {
        this.fallbackActive = active;
        this.queuedMessages = queued;
        this.emit({
            type: "fallbackStateChanged",
            connectionId: "stub",
            timestamp: new Date(),
            data: {
                state: this.getDataChannelState(),
                fallbackActive: active,
                queuedMessages: queued,
                reason,
            },
        });
    }
    simulateConnectionDiagnostics(negotiation, overrides) {
        const statistics = {
            ...this.getConnectionStatistics(),
            ...overrides,
        };
        this.emit({
            type: "connectionDiagnostics",
            connectionId: "stub",
            timestamp: new Date(),
            data: {
                statistics,
                statsIntervalMs: 5000,
                negotiation,
            },
        });
    }
    simulateNegotiationTimeout(durationMs) {
        this.simulateConnectionDiagnostics({
            durationMs,
            timeoutMs: 5000,
            timedOut: true,
            errorCode: webrtc_1.WebRTCErrorCode.SdpNegotiationFailed,
        });
    }
    emit(event) {
        const listeners = this.registry.get(event.type);
        if (!listeners) {
            return;
        }
        for (const handler of listeners) {
            handler(event);
        }
    }
}
const mocha_globals_1 = require("../mocha-globals");
(0, mocha_globals_1.suite)("Integration: WebRTC audio service recovery", () => {
    const logger = createTestLogger();
    const configFactory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
    const config = configFactory.createTestConfig();
    let service;
    let transport;
    let telemetry;
    (0, mocha_globals_1.beforeEach)(() => {
        service = new webrtc_audio_service_1.WebRTCAudioService(undefined, undefined, undefined, logger);
        transport = new IntegrationStubTransport([false, false, true]);
        service.transport = transport;
        service.setupEventHandlers();
        telemetry = [];
        service.addTelemetryObserver((event) => telemetry.push(event));
    });
    (0, mocha_globals_1.afterEach)(() => {
        telemetry.length = 0;
        service.dispose();
    });
    (0, mocha_globals_1.test)("retries ICE restart until success and reports telemetry", async () => {
        transport.simulateNegotiationTimeout(5200);
        const diagnosticsEvent = telemetry.find((event) => event.type === "connectionDiagnostics");
        (0, chai_1.expect)(diagnosticsEvent, "Diagnostics telemetry should be emitted").to.exist;
        (0, chai_1.expect)(diagnosticsEvent?.negotiation?.timedOut).to.be.true;
        (0, chai_1.expect)(diagnosticsEvent?.negotiation?.errorCode).to.equal(webrtc_1.WebRTCErrorCode.SdpNegotiationFailed);
        const errorHandler = service.errorHandler;
        errorHandler.configureRecovery({ baseDelayMs: 0, maxAttempts: 3 });
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.IceConnectionFailed,
            message: "Simulated ICE failure",
            recoverable: true,
            timestamp: new Date(),
        });
        await errorHandler.handleError(error, transport, config);
        (0, chai_1.expect)(transport.restartIceCalls).to.equal(3);
        const eventTypes = telemetry.map((event) => event.type);
        (0, chai_1.expect)(eventTypes.slice(0, 7)).to.deep.equal([
            "connectionDiagnostics",
            "reconnectAttempt",
            "reconnectFailed",
            "reconnectAttempt",
            "reconnectFailed",
            "reconnectAttempt",
            "reconnectSucceeded",
        ]);
        transport.simulateFallback(true, 2, "Data channel closed");
        await new Promise((resolve) => setImmediate(resolve));
        const lastEvent = telemetry[telemetry.length - 1];
        (0, chai_1.expect)(lastEvent.type).to.equal("fallbackStateChanged");
        (0, chai_1.expect)(lastEvent.fallbackActive).to.be.true;
        (0, chai_1.expect)(lastEvent.queuedMessages).to.equal(2);
        (0, chai_1.expect)(service.getSessionStatus().fallbackActive).to.be.true;
        transport.simulateFallback(false, 0, "Data channel restored");
        await new Promise((resolve) => setImmediate(resolve));
        const finalEvent = telemetry[telemetry.length - 1];
        (0, chai_1.expect)(finalEvent.type).to.equal("fallbackStateChanged");
        (0, chai_1.expect)(finalEvent.fallbackActive).to.be.false;
    });
});
//# sourceMappingURL=webrtc-audio-session.integration.test.js.map
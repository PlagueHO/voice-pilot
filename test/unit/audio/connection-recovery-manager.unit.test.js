"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const connection_recovery_manager_1 = require("../../src/../audio/connection-recovery-manager");
const webrtc_config_factory_1 = require("../../src/../audio/webrtc-config-factory");
const webrtc_transport_1 = require("../../src/../audio/webrtc-transport");
const webrtc_1 = require("../../src/../types/webrtc");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
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
class StubTransport {
    published = [];
    events = new Map();
    restartIceCalls = 0;
    recreateCalls = 0;
    fallbackActive = false;
    dataChannelState = "unavailable";
    restartSequence;
    constructor(restartSequence) {
        this.restartSequence = restartSequence;
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
    async restartIce(_config) {
        const result = this.restartSequence[this.restartIceCalls] ?? true;
        this.restartIceCalls += 1;
        return result;
    }
    async recreateDataChannel(_config) {
        this.recreateCalls += 1;
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
            dataChannelState: "open",
            iceConnectionState: "connected",
            connectionQuality: webrtc_1.ConnectionQuality.Good,
        };
    }
    getDataChannelState() {
        return this.dataChannelState;
    }
    isDataChannelFallbackActive() {
        return this.fallbackActive;
    }
    getRemoteAudioStream() {
        return null;
    }
    getAudioContext() {
        return null;
    }
    publishRecoveryEvent(event) {
        this.published.push(event);
        const handlerSet = this.events.get(event.type);
        if (handlerSet) {
            const payload = {
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
            };
            for (const handler of handlerSet) {
                handler(payload);
            }
        }
    }
    addAudioTrack(_track, _options) {
        throw new Error("Not implemented");
    }
    removeAudioTrack(_track) {
        throw new Error("Not implemented");
    }
    sendDataChannelMessage(_message) {
        throw new Error("Not implemented");
    }
    addEventListener(type, handler) {
        if (!this.events.has(type)) {
            this.events.set(type, new Set());
        }
        this.events.get(type).add(handler);
    }
    removeEventListener(type, handler) {
        this.events.get(type)?.delete(handler);
    }
    replaceAudioTrack;
}
(0, mocha_globals_1.suite)("Unit: ConnectionRecoveryManager", () => {
    const logger = createTestLogger();
    const configFactory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
    const config = configFactory.createTestConfig();
    (0, mocha_globals_1.test)("restarts ICE with exponential backoff and publishes telemetry", async () => {
        const manager = new connection_recovery_manager_1.ConnectionRecoveryManager(logger);
        manager.configure({ baseDelayMs: 0, maxAttempts: 5, backoffMultiplier: 2 });
        const events = [];
        manager.addObserver((event) => {
            if (event.type === "attempt" || event.type === "success") {
                events.push(event.strategy);
            }
        });
        const transport = new StubTransport([false, false, true]);
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.IceConnectionFailed,
            message: "ICE failed",
            recoverable: true,
            timestamp: new Date(),
        });
        const recovered = await manager.handleConnectionFailure(transport, config, error);
        (0, chai_setup_1.expect)(recovered).to.be.true;
        (0, chai_setup_1.expect)(transport.restartIceCalls).to.equal(3);
        (0, chai_setup_1.expect)(events.length).to.equal(4);
        (0, chai_setup_1.expect)(events.every((strategy) => strategy === "restart_ice")).to.be.true;
        (0, chai_setup_1.expect)(transport.published.filter((e) => e.type === "reconnectAttempt").length).to.equal(3);
        (0, chai_setup_1.expect)(transport.published.some((e) => e.type === "reconnectSucceeded")).to.be.true;
    });
    (0, mocha_globals_1.test)("attempts data channel recreation and emits failure telemetry", async () => {
        const manager = new connection_recovery_manager_1.ConnectionRecoveryManager(logger);
        manager.configure({ baseDelayMs: 0, maxAttempts: 1 });
        const transport = new StubTransport([false]);
        transport.recreateDataChannel = async () => {
            transport.recreateCalls += 1;
            return null;
        };
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.DataChannelFailed,
            message: "Channel closed",
            recoverable: true,
            timestamp: new Date(),
        });
        const recovered = await manager.handleConnectionFailure(transport, config, error);
        (0, chai_setup_1.expect)(recovered).to.be.false;
        (0, chai_setup_1.expect)(transport.recreateCalls).to.equal(1);
        (0, chai_setup_1.expect)(transport.published.some((event) => event.type === "reconnectFailed")).to.be.true;
    });
    (0, mocha_globals_1.test)("applies exponential backoff and updates recovery stats", async () => {
        const manager = new connection_recovery_manager_1.ConnectionRecoveryManager(logger);
        manager.configure({ baseDelayMs: 10, maxAttempts: 3, backoffMultiplier: 2 });
        const transport = new StubTransport([false, false, true]);
        const error = new webrtc_1.WebRTCErrorImpl({
            code: webrtc_1.WebRTCErrorCode.IceConnectionFailed,
            message: "ICE failed",
            recoverable: true,
            timestamp: new Date(),
        });
        const recordedDelays = [];
        const originalDelay = manager.delay;
        const originalRandom = Math.random;
        manager.delay = async (ms) => {
            recordedDelays.push(ms);
        };
        Math.random = () => 0;
        try {
            const recovered = await manager.handleConnectionFailure(transport, config, error);
            (0, chai_setup_1.expect)(recovered).to.be.true;
            (0, chai_setup_1.expect)(recordedDelays).to.deep.equal([10, 20]);
            const stats = manager.getRecoveryStats();
            (0, chai_setup_1.expect)(stats.isRecovering).to.be.false;
            (0, chai_setup_1.expect)(stats.currentAttempt).to.equal(0);
            (0, chai_setup_1.expect)(stats.successiveFailures).to.equal(0);
            (0, chai_setup_1.expect)(stats.totalRecoveryAttempts >= 1).to.be.true;
            (0, chai_setup_1.expect)(stats.lastConnectionTime > 0).to.be.true;
            const attemptEvents = transport.published.filter((event) => event.type === "reconnectAttempt");
            const successEvents = transport.published.filter((event) => event.type === "reconnectSucceeded");
            (0, chai_setup_1.expect)(attemptEvents.length).to.equal(3);
            (0, chai_setup_1.expect)(successEvents.length).to.equal(1);
        }
        finally {
            manager.delay = originalDelay;
            Math.random = originalRandom;
        }
    });
});
(0, mocha_globals_1.suite)("Unit: WebRTCTransportImpl fallback queue", () => {
    const logger = createTestLogger();
    function createEventlessTransport() {
        return new webrtc_transport_1.WebRTCTransportImpl(logger);
    }
    function createFakeDataChannel() {
        const sent = [];
        const channel = {
            readyState: "connecting",
            label: "test",
            ordered: true,
            binaryType: "arraybuffer",
            bufferedAmount: 0,
            bufferedAmountLowThreshold: 0,
            id: 1,
            maxPacketLifeTime: null,
            maxRetransmits: null,
            negotiated: true,
            protocol: "",
            close: () => {
                channel.readyState = "closed";
                if (typeof channel.onclose === "function") {
                    channel.onclose(undefined);
                }
            },
            send: (payload) => {
                sent.push(payload);
            },
            get sentMessages() {
                return sent;
            },
            onopen: null,
            onclose: null,
            onerror: null,
            onmessage: null,
        };
        return channel;
    }
    (0, mocha_globals_1.test)("queues messages when data channel unavailable and flushes after reopen", async () => {
        const transport = createEventlessTransport();
        await transport.sendDataChannelMessage({ type: "test.event" });
        const pending = transport.pendingDataChannelMessages;
        (0, chai_setup_1.expect)(pending.length).to.equal(1);
        (0, chai_setup_1.expect)(transport.isDataChannelFallbackActive()).to.be.true;
        const fakeChannel = createFakeDataChannel();
        const attach = transport.attachDataChannel.bind(transport);
        attach(fakeChannel, "local");
        fakeChannel.readyState = "open";
        if (typeof fakeChannel.onopen === "function") {
            fakeChannel.onopen(undefined);
        }
        await new Promise((resolve) => setImmediate(resolve));
        (0, chai_setup_1.expect)(pending.length).to.equal(0);
        (0, chai_setup_1.expect)(fakeChannel.sentMessages.length).to.equal(1);
        (0, chai_setup_1.expect)(transport.isDataChannelFallbackActive()).to.be.false;
        await transport.sendDataChannelMessage({ type: "after.open" });
        (0, chai_setup_1.expect)(fakeChannel.sentMessages.length).to.equal(2);
    });
});
//# sourceMappingURL=connection-recovery-manager.unit.test.js.map
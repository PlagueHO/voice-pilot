"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webrtc_transport_1 = require("../../src/../audio/webrtc-transport");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createTestLogger() {
    const entries = [];
    const loggerStub = {
        info: (message, data) => {
            entries.push({ level: "info", message, data });
        },
        warn: (message, data) => {
            entries.push({ level: "warn", message, data });
        },
        error: (message, data) => {
            entries.push({ level: "error", message, data });
        },
        debug: (message, data) => {
            entries.push({ level: "debug", message, data });
        },
        setLevel: () => {
            /* noop */
        },
        dispose: () => {
            /* noop */
        },
    };
    return { logger: loggerStub, entries };
}
function createBaseKeyInfo() {
    const now = new Date();
    const refreshAt = new Date(now.getTime() + 30_000);
    return {
        key: "test-key",
        sessionId: "session-id",
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
        isValid: true,
        secondsRemaining: 60,
        refreshAt,
        secondsUntilRefresh: 30,
        ttlSeconds: 60,
        refreshIntervalSeconds: 30,
    };
}
function createConfig(overrides = {}) {
    const baseKeyInfo = createBaseKeyInfo();
    const baseConfig = {
        endpoint: {
            region: "eastus2",
            url: "https://example.azure.com/realtime",
            deployment: "gpt-realtime",
            apiVersion: "2025-08-28",
        },
        authentication: {
            ephemeralKey: "ephemeral-key",
            expiresAt: new Date(Date.now() + 60_000),
            keyInfo: baseKeyInfo,
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
            inputAudioFormat: "pcm16",
            outputAudioFormat: "pcm16",
        },
    };
    const mergedConfig = {
        ...baseConfig,
        ...overrides,
        endpoint: {
            ...baseConfig.endpoint,
            ...overrides.endpoint,
        },
        authentication: {
            ...baseConfig.authentication,
            ...overrides.authentication,
            keyInfo: {
                ...baseConfig.authentication.keyInfo,
                ...overrides.authentication?.keyInfo,
            },
        },
        audioConfig: {
            ...baseConfig.audioConfig,
            ...overrides.audioConfig,
        },
        sessionConfig: {
            ...baseConfig.sessionConfig,
            ...overrides.sessionConfig,
        },
    };
    return mergedConfig;
}
(0, mocha_globals_1.suite)("Unit: WebRTCTransportImpl configuration helpers", () => {
    (0, mocha_globals_1.test)("composeSessionUpdateEvent includes session metadata and defaults", () => {
        const { logger } = createTestLogger();
        const transport = new webrtc_transport_1.WebRTCTransportImpl(logger);
        const config = createConfig({
            sessionConfig: {
                voice: "alloy",
                instructions: "Respond concisely",
                locale: "en-GB",
                inputAudioFormat: "pcm24",
                outputAudioFormat: "pcm32",
                transcriptionModel: "whisper-1",
                turnDetection: {
                    type: "server_vad",
                    threshold: 0.42,
                    prefixPaddingMs: 120,
                    silenceDurationMs: 480,
                    createResponse: true,
                    interruptResponse: false,
                    eagerness: "auto",
                },
            },
        });
        const sessionUpdate = transport.composeSessionUpdateEvent(config);
        (0, chai_setup_1.expect)(sessionUpdate.type).to.equal("session.update");
        (0, chai_setup_1.expect)(sessionUpdate.session.modalities).to.deep.equal([
            "audio",
            "text",
        ]);
        (0, chai_setup_1.expect)(sessionUpdate.session.output_modalities).to.deep.equal([
            "audio",
            "text",
        ]);
        (0, chai_setup_1.expect)(sessionUpdate.session.input_audio_format).to.equal("pcm24");
        (0, chai_setup_1.expect)(sessionUpdate.session.output_audio_format).to.equal("pcm32");
        (0, chai_setup_1.expect)(sessionUpdate.session.voice).to.equal("alloy");
        (0, chai_setup_1.expect)(sessionUpdate.session.instructions).to.equal("Respond concisely");
        (0, chai_setup_1.expect)(sessionUpdate.session.locale).to.equal("en-GB");
        (0, chai_setup_1.expect)(sessionUpdate.session.input_audio_transcription?.model).to.equal("whisper-1");
        (0, chai_setup_1.expect)(sessionUpdate.session.turn_detection).to.deep.equal({
            type: "server_vad",
            threshold: 0.42,
            prefix_padding_ms: 120,
            silence_duration_ms: 480,
            create_response: true,
            interrupt_response: false,
            eagerness: "auto",
        });
    });
});
(0, mocha_globals_1.suite)("Unit: WebRTCTransportImpl recovery events", () => {
    (0, mocha_globals_1.test)("publishRecoveryEvent emits structured attempt/success/failure events", () => {
        const { logger } = createTestLogger();
        const transport = new webrtc_transport_1.WebRTCTransportImpl(logger);
        const events = [];
        const captureEvent = (event) => {
            events.push(event);
        };
        transport.addEventListener("reconnectAttempt", captureEvent);
        transport.addEventListener("reconnectSucceeded", captureEvent);
        transport.addEventListener("reconnectFailed", captureEvent);
        const attempt = {
            type: "reconnectAttempt",
            strategy: "restart_ice",
            attempt: 2,
            delayMs: 750,
        };
        const success = {
            type: "reconnectSucceeded",
            strategy: "recreate_datachannel",
            attempt: 1,
            durationMs: 1200,
        };
        const failureError = new Error("failed");
        const failure = {
            type: "reconnectFailed",
            strategy: "restart_ice",
            attempt: 3,
            durationMs: 2100,
            error: failureError,
        };
        transport.publishRecoveryEvent(attempt);
        transport.publishRecoveryEvent(success);
        transport.publishRecoveryEvent(failure);
        (0, chai_setup_1.expect)(events).to.have.length(3);
        const [attemptEvent, successEvent, failureEvent] = events;
        (0, chai_setup_1.expect)(attemptEvent.type).to.equal("reconnectAttempt");
        (0, chai_setup_1.expect)(attemptEvent.data).to.deep.equal({
            strategy: "restart_ice",
            attempt: 2,
            delayMs: 750,
        });
        (0, chai_setup_1.expect)(successEvent.type).to.equal("reconnectSucceeded");
        (0, chai_setup_1.expect)(successEvent.data).to.deep.equal({
            strategy: "recreate_datachannel",
            attempt: 1,
            durationMs: 1200,
            error: undefined,
        });
        (0, chai_setup_1.expect)(failureEvent.type).to.equal("reconnectFailed");
        (0, chai_setup_1.expect)(failureEvent.data).to.deep.equal({
            strategy: "restart_ice",
            attempt: 3,
            durationMs: 2100,
            error: failureError,
        });
    });
});
(0, mocha_globals_1.suite)("Unit: WebRTCTransportImpl data channel queue", () => {
    (0, mocha_globals_1.test)("sendDataChannelMessage enforces queue capacity and emits fallback state", async () => {
        const { logger, entries } = createTestLogger();
        const transport = new webrtc_transport_1.WebRTCTransportImpl(logger);
        const states = [];
        transport.addEventListener("dataChannelStateChanged", (event) => {
            states.push(event);
        });
        transport.maxQueuedMessages = 2;
        await transport.sendDataChannelMessage({ type: "queued.1" });
        await transport.sendDataChannelMessage({ type: "queued.2" });
        await transport.sendDataChannelMessage({ type: "queued.3" });
        const queue = transport.pendingDataChannelMessages;
        (0, chai_setup_1.expect)(queue).to.have.length(2);
        (0, chai_setup_1.expect)(queue[0]?.type).to.equal("queued.2");
        (0, chai_setup_1.expect)(queue[1]?.type).to.equal("queued.3");
        (0, chai_setup_1.expect)(transport.isDataChannelFallbackActive()).to.be.true;
        const dropWarning = entries.find((entry) => entry.level === "warn" &&
            entry.message === "Data channel queue capacity reached; dropping oldest");
        (0, chai_setup_1.expect)(dropWarning).to.not.equal(undefined);
        const fallbackEvent = states.find((event) => event.type === "dataChannelStateChanged" &&
            event.data?.queuedMessages === 2);
        (0, chai_setup_1.expect)(fallbackEvent).to.not.equal(undefined);
        (0, chai_setup_1.expect)(fallbackEvent?.data?.fallbackActive).to.equal(true);
        (0, chai_setup_1.expect)(fallbackEvent?.data?.reason).to.equal("Data channel unavailable, queued message");
    });
});
//# sourceMappingURL=webrtc-transport.unit.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const webrtc_config_factory_1 = require("../../src/../audio/webrtc-config-factory");
const realtime_session_1 = require("../../src/../config/realtime-session");
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
function createRealtimeSession(overrides = {}) {
    const now = Date.now();
    const expiresAt = new Date(now + 60000);
    const refreshAt = new Date(now + 30000);
    return {
        sessionId: "test-session",
        ephemeralKey: "ephemeral-key",
        webrtcUrl: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
        websocketUrl: "wss://eastus2.realtimeapi-preview.ai.azure.com",
        expiresAt,
        issuedAt: new Date(now - 1000),
        refreshAt,
        refreshIntervalMs: 45000,
        keyInfo: {
            key: "ephemeral-key",
            sessionId: "test-session",
            issuedAt: new Date(now - 1000),
            expiresAt,
            isValid: true,
            secondsRemaining: Math.floor((expiresAt.getTime() - now) / 1000),
            refreshAt,
            secondsUntilRefresh: Math.floor((refreshAt.getTime() - now) / 1000),
            ttlSeconds: 60,
            refreshIntervalSeconds: 45,
        },
        ...overrides,
    };
}
function createAzureConfig(overrides = {}) {
    return {
        endpoint: "https://example.openai.azure.com",
        deploymentName: "gpt-4o-realtime-preview",
        region: "eastus2",
        apiVersion: "2025-04-01-preview",
        ...overrides,
    };
}
function createAudioConfig(overrides = {}) {
    return {
        inputDevice: "default",
        outputDevice: "default",
        noiseReduction: true,
        echoCancellation: true,
        sampleRate: 24000,
        sharedContext: {
            autoResume: true,
            requireGesture: true,
            latencyHint: "interactive",
        },
        workletModules: [
            "resource://voicepilot/processors/vad-processor.js",
            "resource://voicepilot/processors/gain-processor.js",
        ],
        turnDetection: {
            type: "server_vad",
            threshold: 0.4,
            prefixPaddingMs: 250,
            silenceDurationMs: 200,
            createResponse: true,
            interruptResponse: true,
            eagerness: "auto",
        },
        tts: {
            transport: "webrtc",
            apiVersion: "2025-04-01-preview",
            fallbackMode: "retry",
            maxInitialLatencyMs: 400,
            voice: {
                name: "alloy",
                locale: "en-US",
                style: "conversational",
                gender: "unspecified",
            },
        },
        ...overrides,
    };
}
function createRealtimeConfig(overrides = {}) {
    return {
        model: "gpt-realtime",
        apiVersion: "2025-08-28",
        transcriptionModel: "whisper-1",
        inputAudioFormat: "pcm16",
        locale: "en-US",
        profanityFilter: "medium",
        interimDebounceMs: 250,
        maxTranscriptHistorySeconds: 120,
        ...overrides,
    };
}
function createConfigManagerStub({ azure: azureOverrides, audio: audioOverrides, realtime: realtimeOverrides, sessionPreferencesOverride, } = {}) {
    const audio = createAudioConfig(audioOverrides);
    const realtime = createRealtimeConfig(realtimeOverrides);
    const azure = createAzureConfig(azureOverrides);
    const baseSession = (0, realtime_session_1.resolveRealtimeSessionPreferences)(realtime, audio);
    const session = {
        ...baseSession,
        ...sessionPreferencesOverride,
    };
    const manager = {
        getAzureOpenAIConfig: () => azure,
        getAzureRealtimeConfig: () => realtime,
        getAudioConfig: () => audio,
        getRealtimeSessionPreferences: () => session,
    };
    return { manager, audio, azure, realtime };
}
class EphemeralKeyServiceStub {
    session;
    constructor(session) {
        this.session = session;
    }
    setSession(session) {
        this.session = session;
    }
    async createRealtimeSession() {
        if (this.session instanceof Error) {
            throw this.session;
        }
        return this.session;
    }
}
(0, mocha_globals_1.suite)("Unit: WebRTCConfigFactory", () => {
    (0, mocha_globals_1.test)("creates a configuration bundle with normalized fields", async () => {
        const { logger, entries } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const { manager } = createConfigManagerStub({
            audio: {
                workletModules: [
                    "resource://voicepilot/processors/vad-processor.js",
                    "resource://voicepilot/processors/vad-processor.js",
                    "resource://voicepilot/processors/gain-processor.js",
                ],
            },
        });
        const session = createRealtimeSession();
        const keyService = new EphemeralKeyServiceStub(session);
        const config = await factory.createConfig(manager, keyService);
        (0, chai_setup_1.expect)(config.endpoint.region).to.equal("eastus2");
        (0, chai_setup_1.expect)(config.endpoint.url).to.equal("https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc");
        (0, chai_setup_1.expect)(config.authentication.ephemeralKey).to.equal(session.ephemeralKey);
        (0, chai_setup_1.expect)(config.audioConfig.sampleRate).to.equal(24000);
        (0, chai_setup_1.expect)(config.audioConfig.codecProfileId).to.equal("pcm16-24k-mono");
        (0, chai_setup_1.expect)(config.audioConfig.workletModuleUrls).to.deep.equal([
            "resource://voicepilot/processors/vad-processor.js",
            "resource://voicepilot/processors/gain-processor.js",
        ]);
        (0, chai_setup_1.expect)(Object.isFrozen(config.audioConfig.workletModuleUrls), "worklet modules should be frozen to prevent mutation").to.be.true;
        (0, chai_setup_1.expect)(config.sessionConfig.voice).to.equal("alloy");
        (0, chai_setup_1.expect)(config.sessionConfig.turnDetection).to.exist;
        (0, chai_setup_1.expect)(config.dataChannelConfig?.channelName).to.equal("realtime-channel");
        (0, chai_setup_1.expect)(config.connectionConfig?.reconnectAttempts).to.equal(3);
        const debugEntry = entries.find((entry) => entry.level === "debug");
        (0, chai_setup_1.expect)(debugEntry, "should emit a debug log when config is created").to.exist;
    });
    (0, mocha_globals_1.test)("maps known Azure regions to supported WebRTC regions", async () => {
        const { logger } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const { manager } = createConfigManagerStub({
            azure: {
                region: "eastus",
            },
        });
        const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
        const config = await factory.createConfig(manager, keyService);
        (0, chai_setup_1.expect)(config.endpoint.region).to.equal("eastus2");
        (0, chai_setup_1.expect)(config.endpoint.url).to.equal("https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc");
    });
    (0, mocha_globals_1.test)("rejects creation when the region is unsupported", async () => {
        const { logger } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const { manager } = createConfigManagerStub({
            azure: {
                region: "antarctica",
            },
        });
        const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
        try {
            await factory.createConfig(manager, keyService);
            chai_setup_1.expect.fail("Expected createConfig to reject for unsupported region");
        }
        catch (error) {
            const webrtcError = error;
            (0, chai_setup_1.expect)(webrtcError).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
            (0, chai_setup_1.expect)(webrtcError.code).to.equal(webrtc_1.WebRTCErrorCode.ConfigurationInvalid);
            (0, chai_setup_1.expect)(webrtcError.message).to.match(/Unsupported region/i);
        }
    });
    (0, mocha_globals_1.test)("fails fast when session expiry window is unsafe", async () => {
        const { logger } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const { manager } = createConfigManagerStub();
        const imminentExpiry = new Date(Date.now() + 5000);
        const keyService = new EphemeralKeyServiceStub(createRealtimeSession({
            expiresAt: imminentExpiry,
            keyInfo: {
                ...createRealtimeSession().keyInfo,
                expiresAt: imminentExpiry,
                secondsRemaining: 5,
            },
        }));
        try {
            await factory.createConfig(manager, keyService);
            chai_setup_1.expect.fail("Expected createConfig to reject when expiry is unsafe");
        }
        catch (error) {
            const webrtcError = error;
            (0, chai_setup_1.expect)(webrtcError).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
            (0, chai_setup_1.expect)(webrtcError.code).to.equal(webrtc_1.WebRTCErrorCode.AuthenticationFailed);
            (0, chai_setup_1.expect)(webrtcError.message).to.match(/expires too soon/i);
        }
    });
    (0, mocha_globals_1.test)("warns when requested sample rate is adjusted for compliance", async () => {
        const { logger, entries } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const { manager } = createConfigManagerStub({
            audio: {
                sampleRate: 16000,
            },
        });
        const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
        const config = await factory.createConfig(manager, keyService);
        (0, chai_setup_1.expect)(config.audioConfig.sampleRate).to.equal(24000);
        const warning = entries.find((entry) => entry.level === "warn");
        (0, chai_setup_1.expect)(warning, "expected warning when sample rate is adjusted").to.exist;
        (0, chai_setup_1.expect)(warning?.message).to.match(/Audio sample rate adjusted/i);
    });
    (0, mocha_globals_1.test)("refreshes authentication material via updateConfigWithNewKey", async () => {
        const { logger } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const originalSession = createRealtimeSession();
        const keyService = new EphemeralKeyServiceStub(originalSession);
        const { manager } = createConfigManagerStub();
        const baseConfig = await factory.createConfig(manager, keyService);
        const refreshedSession = createRealtimeSession({
            sessionId: "refreshed",
            ephemeralKey: "refreshed-key",
            keyInfo: {
                ...originalSession.keyInfo,
                key: "refreshed-key",
                sessionId: "refreshed",
                secondsRemaining: 55,
            },
        });
        keyService.setSession(refreshedSession);
        const updated = await factory.updateConfigWithNewKey(baseConfig, keyService);
        (0, chai_setup_1.expect)(updated).to.not.equal(baseConfig);
        (0, chai_setup_1.expect)(updated.authentication.ephemeralKey).to.equal("refreshed-key");
        (0, chai_setup_1.expect)(baseConfig.authentication.ephemeralKey).to.equal("ephemeral-key");
    });
    (0, mocha_globals_1.test)("surfaces structured errors when key refresh fails", async () => {
        const { logger } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
        const { manager } = createConfigManagerStub();
        const baseConfig = await factory.createConfig(manager, keyService);
        keyService.setSession(new Error("network unavailable"));
        try {
            await factory.updateConfigWithNewKey(baseConfig, keyService);
            chai_setup_1.expect.fail("Expected updateConfigWithNewKey to reject when key refresh fails");
        }
        catch (error) {
            const webrtcError = error;
            (0, chai_setup_1.expect)(webrtcError).to.be.instanceOf(webrtc_1.WebRTCErrorImpl);
            (0, chai_setup_1.expect)(webrtcError.code).to.equal(webrtc_1.WebRTCErrorCode.AuthenticationFailed);
            (0, chai_setup_1.expect)(webrtcError.message).to.match(/Key update failed/i);
        }
    });
    (0, mocha_globals_1.test)("validates configurations and logs failures", () => {
        const { logger, entries } = createTestLogger();
        const factory = new webrtc_config_factory_1.WebRTCConfigFactory(logger);
        const config = factory.createTestConfig();
        (0, chai_setup_1.expect)(factory.validateConfig(config)).to.be.true;
        const expiredConfig = {
            ...config,
            authentication: {
                ...config.authentication,
                expiresAt: new Date(Date.now() - 1000),
            },
        };
        (0, chai_setup_1.expect)(factory.validateConfig(expiredConfig)).to.be.false;
        const errorEntry = entries.find((entry) => entry.level === "error");
        (0, chai_setup_1.expect)(errorEntry, "validation failure should emit error log").to.exist;
        (0, chai_setup_1.expect)(errorEntry?.message).to.match(/validation failed/i);
    });
});
//# sourceMappingURL=webrtc-config-factory.unit.test.js.map
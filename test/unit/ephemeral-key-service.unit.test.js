"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ephemeral_key_service_1 = require("../../src/auth/ephemeral-key-service");
const realtime_session_1 = require("../../src/config/realtime-session");
const logger_1 = require("../../src/core/logger");
const chai_setup_1 = require("../helpers/chai-setup");
const mocha_globals_1 = require("../mocha-globals");
// Minimal mock credential manager implementing only required surface
class MockCredMgr {
    key;
    constructor(key) { this.key = key; }
    isInitialized() { return true; }
    async getAzureOpenAIKey() { return this.key; }
}
class MockConfigMgr {
    cfg;
    realtime;
    audio;
    constructor(cfg, realtime, audio) {
        this.cfg = cfg;
        this.realtime = realtime;
        this.audio = audio;
    }
    isInitialized() { return true; }
    getAzureOpenAIConfig() { return this.cfg; }
    getAzureRealtimeConfig() { return this.realtime; }
    getAudioConfig() { return this.audio; }
    getRealtimeSessionPreferences() {
        return (0, realtime_session_1.resolveRealtimeSessionPreferences)(this.realtime, this.audio);
    }
}
function okSessionResponse() {
    return {
        id: 'sess-1',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: { value: 'ephemeral-key-xyz', expires_at: Math.floor(Date.now() / 1000) + 60 }
    };
}
const baseConfig = {
    endpoint: 'https://unit.openai.azure.com',
    deploymentName: 'gpt-4o-realtime-preview',
    region: 'eastus2',
    apiVersion: '2025-04-01-preview'
};
const baseRealtimeConfig = {
    model: 'gpt-4o-realtime-preview',
    apiVersion: '2025-08-28',
    transcriptionModel: 'whisper-large-v3',
    inputAudioFormat: 'pcm16',
    locale: 'en-US',
    profanityFilter: 'medium',
    interimDebounceMs: 150,
    maxTranscriptHistorySeconds: 120,
};
const baseAudioConfig = {
    inputDevice: 'default',
    outputDevice: 'default',
    noiseReduction: true,
    echoCancellation: true,
    sampleRate: 16000,
    sharedContext: {
        autoResume: true,
        requireGesture: false,
        latencyHint: 'interactive',
    },
    workletModules: [],
    turnDetection: {
        type: 'semantic_vad',
        threshold: 0.5,
        prefixPaddingMs: 120,
        silenceDurationMs: 350,
        createResponse: true,
        interruptResponse: true,
        eagerness: 'auto',
    },
    tts: {
        transport: 'webrtc',
        apiVersion: '2025-08-28',
        fallbackMode: 'retry',
        maxInitialLatencyMs: 750,
        voice: {
            name: 'en-US-AriaNeural',
            locale: 'en-US',
        },
    },
};
(0, mocha_globals_1.suite)('Unit: EphemeralKeyServiceImpl', () => {
    const originalFetch = global.fetch;
    (0, mocha_globals_1.afterEach)(() => { global.fetch = originalFetch; });
    (0, mocha_globals_1.test)('initializes successfully with valid key and session creation', async () => {
        global.fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
        const svc = new ephemeral_key_service_1.EphemeralKeyServiceImpl(new MockCredMgr('abc123'), new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig), new logger_1.Logger('Test'));
        await svc.initialize();
        (0, chai_setup_1.expect)(svc.isInitialized()).to.equal(true);
    });
    (0, mocha_globals_1.test)('fails initialization when authentication test cannot create session', async () => {
        global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized' } }) });
        const svc = new ephemeral_key_service_1.EphemeralKeyServiceImpl(new MockCredMgr('bad'), new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig), new logger_1.Logger('Test'));
        await (0, chai_setup_1.expect)(svc.initialize()).to.be.rejectedWith(/Authentication test failed/i);
    });
    (0, mocha_globals_1.test)('requestEphemeralKey returns error when missing key', async () => {
        global.fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
        const svc = new ephemeral_key_service_1.EphemeralKeyServiceImpl(new MockCredMgr(undefined), new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig), new logger_1.Logger('Test'));
        // Manually set initialized to bypass initialize path for this focused unit check
        svc.initialized = true;
        const result = await svc.requestEphemeralKey();
        (0, chai_setup_1.expect)(result.success).to.equal(false);
        (0, chai_setup_1.expect)(result.error?.code).to.equal('MISSING_CREDENTIALS');
    });
    (0, mocha_globals_1.test)('maps 429 to RATE_LIMITED', async () => {
        global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Too many' } }) });
        const svc = new ephemeral_key_service_1.EphemeralKeyServiceImpl(new MockCredMgr('key'), new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig), new logger_1.Logger('Test'));
        svc.initialized = true;
        const result = await svc.requestEphemeralKey();
        (0, chai_setup_1.expect)(result.success).to.equal(false);
        (0, chai_setup_1.expect)(result.error?.code).to.equal('RATE_LIMITED');
    });
});
//# sourceMappingURL=ephemeral-key-service.unit.test.js.map
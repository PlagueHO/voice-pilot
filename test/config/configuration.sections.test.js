"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const configuration_manager_1 = require("../../src/config/configuration-manager");
const logger_1 = require("../../src/core/logger");
describe('Configuration Sections', () => {
    async function init() {
        const logger = new logger_1.Logger('CfgSect');
        const context = { subscriptions: [], extensionUri: vscode.Uri.parse('file://test'), secrets: { get: async () => undefined } };
        const mgr = new configuration_manager_1.ConfigurationManager(context, logger);
        await mgr.initialize();
        return mgr;
    }
    it('Defaults present for audio', async () => {
        const mgr = await init();
        const audio = mgr.getAudioConfig();
        assert.ok(audio.inputDevice.length > 0, 'inputDevice default');
        assert.ok([16000, 24000, 48000].includes(audio.sampleRate), 'sampleRate enum');
        assert.ok(audio.turnDetection, 'turnDetection default present');
        assert.strictEqual(audio.turnDetection.type, 'server_vad');
        assert.strictEqual(audio.turnDetection.threshold, 0.5);
        assert.strictEqual(audio.turnDetection.prefixPaddingMs, 300);
        assert.strictEqual(audio.turnDetection.silenceDurationMs, 200);
    });
    it('Defaults present for azure realtime', async () => {
        const mgr = await init();
        const azureOpenAI = mgr.getAzureOpenAIConfig();
        assert.strictEqual(azureOpenAI.apiVersion, '2025-04-01-preview');
        const realtime = mgr.getAzureRealtimeConfig();
        assert.strictEqual(realtime.model.length > 0, true, 'model default');
        assert.ok(['pcm16', 'pcm24', 'pcm32'].includes(realtime.inputAudioFormat), 'inputAudioFormat enum');
        assert.strictEqual(realtime.transcriptionModel, 'whisper-1');
        assert.strictEqual(realtime.profanityFilter, 'medium');
        assert.strictEqual(realtime.maxTranscriptHistorySeconds, 120);
    });
    it('resolves realtime session preferences with normalized turn detection', async () => {
        const mgr = await init();
        const prefs = mgr.getRealtimeSessionPreferences();
        assert.strictEqual(prefs.apiVersion, '2025-08-28');
        assert.strictEqual(prefs.voice, 'alloy');
        assert.ok(prefs.turnDetection, 'turn detection payload present');
        assert.strictEqual(prefs.turnDetection?.type, 'server_vad');
        assert.strictEqual(prefs.turnDetection?.prefix_padding_ms, 300);
        assert.strictEqual(prefs.turnDetection?.silence_duration_ms, 200);
        assert.strictEqual(prefs.turnDetection?.create_response, true);
        assert.strictEqual(prefs.turnDetection?.interrupt_response, true);
    });
    it('Performance < 1s', async () => {
        const logger = new logger_1.Logger('CfgPerf');
        const context = { subscriptions: [], extensionUri: vscode.Uri.parse('file://test'), secrets: { get: async () => undefined } };
        const start = Date.now();
        const mgr = new configuration_manager_1.ConfigurationManager(context, logger);
        await mgr.initialize();
        const dur = Date.now() - start;
        assert.ok(dur < 1000, `Initialization exceeded performance constraint: ${dur}`);
        assert.ok(mgr.getDiagnostics(), 'Diagnostics available');
    });
});
//# sourceMappingURL=configuration.sections.test.js.map
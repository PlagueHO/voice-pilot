import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../config/configuration-manager';
import { Logger } from '../../core/logger';

describe('Configuration Sections', () => {
  async function init(): Promise<ConfigurationManager> {
    const logger = new Logger('CfgSect');
    const context: any = { subscriptions: [], extensionUri: vscode.Uri.parse('file://test'), secrets: { get: async () => undefined } };
    const mgr = new ConfigurationManager(context, logger);
    await mgr.initialize();
    return mgr;
  }

  it('Defaults present for audio', async () => {
    const mgr = await init();
    const audio = mgr.getAudioConfig();
    assert.ok(audio.inputDevice.length > 0, 'inputDevice default');
    assert.ok([16000,24000,48000].includes(audio.sampleRate), 'sampleRate enum');
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
    assert.ok(['pcm16','pcm24','pcm32'].includes(realtime.inputAudioFormat), 'inputAudioFormat enum');
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
    const logger = new Logger('CfgPerf');
    const context: any = { subscriptions: [], extensionUri: vscode.Uri.parse('file://test'), secrets: { get: async () => undefined } };
    const start = Date.now();
    const mgr = new ConfigurationManager(context, logger);
    await mgr.initialize();
    const dur = Date.now() - start;
    assert.ok(dur < 1000, `Initialization exceeded performance constraint: ${dur}`);
    assert.ok(mgr.getDiagnostics(), 'Diagnostics available');
  });
});

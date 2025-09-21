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

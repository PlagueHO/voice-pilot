import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { Logger } from '../../core/logger';

suite('Configuration Validation', () => {
  async function createManager(): Promise<ConfigurationManager> {
    const logger = new Logger('CfgTest');
    const context: any = {
      subscriptions: [],
      extensionUri: vscode.Uri.parse('file://test'),
      secrets: { get: async () => undefined }
    };
    const mgr = new ConfigurationManager(context, logger);
    await mgr.initialize();
    return mgr;
  }

  test('Detects invalid endpoint format', async () => {
    const cfg = vscode.workspace.getConfiguration('voicepilot.azureOpenAI');
    await cfg.update('endpoint', 'http://bad-endpoint', vscode.ConfigurationTarget.Global);
    const mgr = await createManager();
    const result = mgr.getDiagnostics();
    assert.ok(result, 'Validation result should exist');
    const hasInvalid = result!.errors.some(e => e.code === 'INVALID_ENDPOINT_FORMAT' || e.code === 'MISSING_ENDPOINT');
    assert.ok(hasInvalid, 'Should flag invalid endpoint');
  });

  test('Valid sensitivity range passes', async () => {
    const commands = vscode.workspace.getConfiguration('voicepilot.commands');
    await commands.update('sensitivity', 0.9, vscode.ConfigurationTarget.Global);
    const mgr = await createManager();
    const result = mgr.getDiagnostics();
    assert.ok(result);
    const sensErrors = result!.errors.filter(e => e.path === 'voicepilot.commands.sensitivity');
    assert.strictEqual(sensErrors.length, 0, 'No sensitivity errors expected for 0.9');
  });
});

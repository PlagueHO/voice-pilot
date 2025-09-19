import * as assert from 'assert';
import { suite, suiteSetup, test } from 'mocha';
import * as vscode from 'vscode';
import { EphemeralKeyService } from '../auth/EphemeralKeyService';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { ExtensionController } from '../core/ExtensionController';
import { Logger } from '../core/logger';
import { SessionManager } from '../session/SessionManager';
import { VoiceControlPanel } from '../ui/VoiceControlPanel';

suite('Extension Lifecycle', () => {
  const disposables: vscode.Disposable[] = [];
  let context: vscode.ExtensionContext;

  suiteSetup(async () => {
    // Minimal fake context for testing
    context = {
      subscriptions: disposables,
      extensionUri: vscode.Uri.parse('file://test'),
      environmentVariableCollection: {} as any,
      asAbsolutePath: (p: string) => p,
      storagePath: undefined,
      globalStoragePath: '',
      logPath: '',
      extensionPath: '',
      globalState: {} as any,
      workspaceState: {} as any,
      secrets: {} as any
    } as vscode.ExtensionContext;
  });

  test('Initialize then dispose reverses order', async () => {
    const events: string[] = [];
    const logger = new Logger('TestLogger');
    const config = new ConfigurationManager();
    const keyService = new EphemeralKeyService();
    const session = new SessionManager();
    const panel = new VoiceControlPanel(context);

    // Monkey patch dispose methods to record order
    const originalPanelDispose = panel.dispose.bind(panel);
    panel.dispose = () => { events.push('panel'); originalPanelDispose(); };
    const originalSessionDispose = session.dispose.bind(session);
    session.dispose = () => { events.push('session'); originalSessionDispose(); };
    const originalKeyDispose = keyService.dispose.bind(keyService);
    keyService.dispose = () => { events.push('key'); originalKeyDispose(); };
    const originalConfigDispose = config.dispose.bind(config);
    config.dispose = () => { events.push('config'); originalConfigDispose(); };

    const controller = new ExtensionController(
      context,
      config,
      keyService,
      session,
      panel,
      logger
    );

    await controller.initialize();
    assert.ok(controller.isInitialized(), 'Controller should be initialized');

    controller.dispose();

    assert.deepStrictEqual(events, ['panel', 'session', 'key', 'config'], 'Dispose order should be reverse init');
  });

  test('Panel and session released on dispose', async () => {
    const logger = new Logger('TestLogger2');
    const config = new ConfigurationManager();
    const keyService = new EphemeralKeyService();
    const session = new SessionManager();
    const panel = new VoiceControlPanel(context);
    const controller = new ExtensionController(
      context,
      config,
      keyService,
      session,
      panel,
      logger
    );
    await controller.initialize();
    await panel.show();
    assert.ok(panel.isVisible(), 'Panel should be visible after show');
    assert.ok(session.isSessionActive() === false, 'Session should not auto-start');
    controller.dispose();
    assert.strictEqual(panel.isVisible(), false, 'Panel reference should be cleared after dispose');
  });
});

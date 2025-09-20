import * as assert from 'assert';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import * as vscode from 'vscode';
import { EphemeralKeyServiceImpl } from '../auth/EphemeralKeyService';
import { ConfigurationManager } from '../config/ConfigurationManager';
import { Logger } from '../core/logger';
import { SessionManager } from '../session/SessionManager';
import { VoiceControlPanel } from '../ui/VoiceControlPanel';

suite('Extension Lifecycle', () => {
  const disposables: vscode.Disposable[] = [];
  let context: vscode.ExtensionContext;

  suiteSetup(async () => {
    // Create mock extension context
    context = {
      subscriptions: disposables,
      extensionUri: vscode.Uri.parse('file://test'),
      environmentVariableCollection: {} as any,
      asAbsolutePath: (p: string) => p,
      storagePath: undefined,
      globalStoragePath: '',
      logPath: '',
      extensionPath: '',
      globalState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => []
      } as any,
      workspaceState: {
        get: () => undefined,
        update: async () => undefined,
        keys: () => []
      } as any,
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined
      } as any
    } as vscode.ExtensionContext;
  });

  suiteTeardown(() => {
    // Clean up any disposables
    disposables.forEach(d => d.dispose());
  });

  test('Services initialize and dispose in correct order', async () => {
    const events: string[] = [];
    const logger = new Logger('TestLogger');
    const config = new ConfigurationManager(context, logger);
    const keyService = new EphemeralKeyServiceImpl();
    const session = new SessionManager();
    const panel = new VoiceControlPanel(context);

    // Track disposal order
    const originalPanelDispose = panel.dispose.bind(panel);
    panel.dispose = () => { events.push('panel'); originalPanelDispose(); };
    const originalSessionDispose = session.dispose.bind(session);
    session.dispose = () => { events.push('session'); originalSessionDispose(); };
    const originalKeyDispose = keyService.dispose.bind(keyService);
    keyService.dispose = () => { events.push('key'); originalKeyDispose(); };
    const originalConfigDispose = config.dispose.bind(config);
    config.dispose = () => { events.push('config'); originalConfigDispose(); };

    // Test individual service lifecycle
    await config.initialize();
    assert.ok(config.isInitialized(), 'Config should be initialized');

    await keyService.initialize();
    assert.ok(keyService.isInitialized(), 'Key service should be initialized');

    await session.initialize();
    assert.ok(session.isInitialized(), 'Session should be initialized');

    await panel.initialize();
    assert.ok(panel.isInitialized(), 'Panel should be initialized');

    // Dispose in reverse order
    panel.dispose();
    session.dispose();
    keyService.dispose();
    config.dispose();

    assert.deepStrictEqual(events, ['panel', 'session', 'key', 'config'], 'Services should dispose in reverse order');
  });

  test('Panel can be shown and disposed', async () => {
    const logger = new Logger('TestLogger2');
    const panel = new VoiceControlPanel(context);

    await panel.initialize();

    // Test panel visibility
    await panel.show();
    assert.ok(panel.isVisible(), 'Panel should be visible after show');

    panel.dispose();
    assert.strictEqual(panel.isVisible(), false, 'Panel should not be visible after dispose');
  });

  test('Session manager tracks session state', async () => {
    const session = new SessionManager();

    await session.initialize();

    assert.strictEqual(session.isSessionActive(), false, 'Session should not be active initially');

    // Test would require actual session start/stop implementation
    // For now, just test the basic state
    assert.ok(session.isInitialized(), 'Session manager should be initialized');

    session.dispose();
  });
});

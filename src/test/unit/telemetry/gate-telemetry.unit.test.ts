import * as vscode from 'vscode';
import { GateTaskTelemetryRecord, GateTelemetryEmitter } from '../../../telemetry/gate-telemetry';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

suite('Unit: GateTelemetryEmitter', () => {
  const workspaceUri = vscode.Uri.parse('file:///tmp/workspace');
  let emitter: GateTelemetryEmitter;
  let writes: Map<string, Uint8Array>;
  let fileSystemStub: Pick<typeof vscode.workspace.fs, 'createDirectory' | 'writeFile' | 'readFile'>;
  let joinPathStub: (base: vscode.Uri, ...segments: string[]) => vscode.Uri;

  beforeEach(() => {
    writes = new Map();
    fileSystemStub = {
      createDirectory: async (_uri: vscode.Uri) => {
        /* no-op */
      },
      writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
        writes.set(uri.path, content);
        writes.set('lastWrite', content);
      },
      readFile: async (uri: vscode.Uri) => {
        const data = writes.get(uri.path);
        if (!data) {
          throw new Error('file not found');
        }
        return data;
      },
    } satisfies Pick<typeof vscode.workspace.fs, 'createDirectory' | 'writeFile' | 'readFile'>;

    joinPathStub = (base: vscode.Uri, ...segments: string[]) => {
      const basePath = typeof base.path === 'string' ? base.path.replace(/\/+$/, '') : '';
      const suffix = segments
        .map((segment) => segment.replace(/^\/+/, ''))
        .filter((segment) => segment.length > 0)
        .join('/');
      const combined = suffix ? `${basePath}/${suffix}` : basePath;
      return { path: combined } as unknown as vscode.Uri;
    };

    emitter = new GateTelemetryEmitter({
      baseUri: workspaceUri,
      fileSystem: fileSystemStub,
      joinPath: joinPathStub,
    });
  });

  afterEach(() => {
    writes.clear();
  });

  test('writes a new report file with a single record', async () => {
    const record: GateTaskTelemetryRecord = {
      task: 'Test Task',
      status: 'pass',
      durationMs: 123,
    };

    await emitter.record(record);

    const key = Array.from(writes.keys()).find(
      (k) => typeof k === 'string' && k.endsWith('gate-report.json'),
    );
    const written = key ? writes.get(key) : writes.get('lastWrite');
    expect(written, 'file should be written').to.not.be.undefined;

    const content = new TextDecoder().decode(written!);
    const parsed = JSON.parse(content) as GateTaskTelemetryRecord[];
    expect(parsed.length).to.equal(1);
    expect(parsed[0].task).to.equal('Test Task');
    expect(parsed[0].status).to.equal('pass');
    expect(parsed[0].durationMs).to.equal(123);
  });

  test('trims entries to maxEntries', async () => {
    emitter = new GateTelemetryEmitter({
      baseUri: workspaceUri,
      maxEntries: 2,
      fileSystem: fileSystemStub,
      joinPath: joinPathStub,
    });
    await emitter.record({ task: 'a', status: 'pass', durationMs: 1 });
    await emitter.record({ task: 'b', status: 'pass', durationMs: 2 });
    await emitter.record({ task: 'c', status: 'pass', durationMs: 3 });

    const key = Array.from(writes.keys()).find(
      (k) => typeof k === 'string' && k.endsWith('gate-report.json'),
    );
    const written = key ? writes.get(key) : writes.get('lastWrite');
    const parsed = JSON.parse(
      new TextDecoder().decode(written!),
    ) as GateTaskTelemetryRecord[];
    expect(parsed.length).to.equal(2);
    expect(parsed[0].task).to.equal('b');
    expect(parsed[1].task).to.equal('c');
  });

  test('sanitizes invalid duration and coverage', async () => {
    await emitter.record({ task: 'x', status: 'fail', durationMs: NaN, coverage: { statements: -5, lines: 12.7 } });
    const key = Array.from(writes.keys()).find(
      (k) => typeof k === 'string' && k.endsWith('gate-report.json'),
    );
    const written = key ? writes.get(key) : writes.get('lastWrite');
    const parsed = JSON.parse(
      new TextDecoder().decode(written!),
    ) as GateTaskTelemetryRecord[];
    expect(parsed[0].durationMs).to.equal(0);
    expect(parsed[0].coverage?.statements).to.equal(0);
    expect(parsed[0].coverage?.lines).to.equal(13);
  });

  test('read returns [] when no file', async () => {
    const result = await emitter.read();
    expect(result).to.deep.equal([]);
  });

});

import * as vscode from 'vscode';
import { GateTaskTelemetryRecord, GateTelemetryEmitter } from '../../../telemetry/gate-telemetry';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

suite('Unit: GateTelemetryEmitter', () => {
  const workspaceUri = vscode.Uri.parse('file:///tmp/workspace');
  let emitter: GateTelemetryEmitter;
  let writes: Map<string, Uint8Array>;
  const originalWorkspaceFsDescriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'fs');
  const originalJoinPathDescriptor = Object.getOwnPropertyDescriptor(vscode.Uri, 'joinPath');

  beforeEach(() => {
    // Ensure joinPath exists on the mocked Uri
    Object.defineProperty(vscode.Uri, 'joinPath', {
      configurable: true,
      value: (base: vscode.Uri, ...parts: string[]) => {
        const joined = `${base.path}/${parts.join('/')}`;
        return vscode.Uri.parse(`file://${joined}`);
      },
    });
    writes = new Map();
    // stub workspace.fs methods
    Object.defineProperty(vscode.workspace, 'fs', {
      configurable: true,
      value: ({
        createDirectory: async (_uri: vscode.Uri) => {},
        writeFile: async (uri: vscode.Uri, content: Uint8Array) => {
          writes.set(uri.path, content);
          // also store a fallback key to avoid relying on exact path formats in the test env
          writes.set('lastWrite', content);
        },
        readFile: async (uri: vscode.Uri) => {
          const data = writes.get(uri.path);
          if (!data) {
            throw new Error('file not found');
          }
          return data;
        },
      }) satisfies Pick<typeof vscode.workspace.fs, 'createDirectory' | 'writeFile' | 'readFile'>,
    });

    emitter = new GateTelemetryEmitter({ baseUri: workspaceUri });
  });

  afterEach(async () => {
    // reset
    if (originalWorkspaceFsDescriptor) {
      Object.defineProperty(vscode.workspace, 'fs', originalWorkspaceFsDescriptor);
    } else {
      delete (vscode.workspace as unknown as Record<string, unknown>).fs;
    }

    if (originalJoinPathDescriptor) {
      Object.defineProperty(vscode.Uri, 'joinPath', originalJoinPathDescriptor);
    } else {
      delete (vscode.Uri as unknown as Record<string, unknown>).joinPath;
    }
  });

  test('writes a new report file with a single record', async () => {
    const record: GateTaskTelemetryRecord = {
      task: 'Test Task',
      status: 'pass',
      durationMs: 123,
    };

    await emitter.record(record);

  const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
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
    emitter = new GateTelemetryEmitter({ baseUri: workspaceUri, maxEntries: 2 });
    await emitter.record({ task: 'a', status: 'pass', durationMs: 1 });
    await emitter.record({ task: 'b', status: 'pass', durationMs: 2 });
    await emitter.record({ task: 'c', status: 'pass', durationMs: 3 });

  const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
  const written = key ? writes.get(key) : writes.get('lastWrite');
  const parsed = JSON.parse(new TextDecoder().decode(written!)) as GateTaskTelemetryRecord[];
    expect(parsed.length).to.equal(2);
    expect(parsed[0].task).to.equal('b');
    expect(parsed[1].task).to.equal('c');
  });

  test('sanitizes invalid duration and coverage', async () => {
    await emitter.record({ task: 'x', status: 'fail', durationMs: NaN, coverage: { statements: -5, lines: 12.7 } });
  const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
  const written = key ? writes.get(key) : writes.get('lastWrite');
  const parsed = JSON.parse(new TextDecoder().decode(written!)) as GateTaskTelemetryRecord[];
    expect(parsed[0].durationMs).to.equal(0);
    expect(parsed[0].coverage?.statements).to.equal(0);
    expect(parsed[0].coverage?.lines).to.equal(13);
  });

  test('read returns [] when no file', async () => {
    const result = await emitter.read();
    expect(result).to.deep.equal([]);
  });

});

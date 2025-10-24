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
const vscode = __importStar(require("vscode"));
const gate_telemetry_1 = require("../../src/../telemetry/gate-telemetry");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)('Unit: GateTelemetryEmitter', () => {
    const workspaceUri = vscode.Uri.parse('file:///tmp/workspace');
    let emitter;
    let writes;
    let fileSystemStub;
    let joinPathStub;
    (0, mocha_globals_1.beforeEach)(() => {
        writes = new Map();
        fileSystemStub = {
            createDirectory: async (_uri) => {
                /* no-op */
            },
            writeFile: async (uri, content) => {
                writes.set(uri.path, content);
                writes.set('lastWrite', content);
            },
            readFile: async (uri) => {
                const data = writes.get(uri.path);
                if (!data) {
                    throw new Error('file not found');
                }
                return data;
            },
        };
        joinPathStub = (base, ...segments) => {
            const basePath = typeof base.path === 'string' ? base.path.replace(/\/+$/, '') : '';
            const suffix = segments
                .map((segment) => segment.replace(/^\/+/, ''))
                .filter((segment) => segment.length > 0)
                .join('/');
            const combined = suffix ? `${basePath}/${suffix}` : basePath;
            return { path: combined };
        };
        emitter = new gate_telemetry_1.GateTelemetryEmitter({
            baseUri: workspaceUri,
            fileSystem: fileSystemStub,
            joinPath: joinPathStub,
        });
    });
    (0, mocha_globals_1.afterEach)(() => {
        writes.clear();
    });
    (0, mocha_globals_1.test)('writes a new report file with a single record', async () => {
        const record = {
            task: 'Test Task',
            status: 'pass',
            durationMs: 123,
        };
        await emitter.record(record);
        const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
        const written = key ? writes.get(key) : writes.get('lastWrite');
        (0, chai_setup_1.expect)(written, 'file should be written').to.not.be.undefined;
        const content = new TextDecoder().decode(written);
        const parsed = JSON.parse(content);
        (0, chai_setup_1.expect)(parsed.length).to.equal(1);
        (0, chai_setup_1.expect)(parsed[0].task).to.equal('Test Task');
        (0, chai_setup_1.expect)(parsed[0].status).to.equal('pass');
        (0, chai_setup_1.expect)(parsed[0].durationMs).to.equal(123);
    });
    (0, mocha_globals_1.test)('trims entries to maxEntries', async () => {
        emitter = new gate_telemetry_1.GateTelemetryEmitter({
            baseUri: workspaceUri,
            maxEntries: 2,
            fileSystem: fileSystemStub,
            joinPath: joinPathStub,
        });
        await emitter.record({ task: 'a', status: 'pass', durationMs: 1 });
        await emitter.record({ task: 'b', status: 'pass', durationMs: 2 });
        await emitter.record({ task: 'c', status: 'pass', durationMs: 3 });
        const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
        const written = key ? writes.get(key) : writes.get('lastWrite');
        const parsed = JSON.parse(new TextDecoder().decode(written));
        (0, chai_setup_1.expect)(parsed.length).to.equal(2);
        (0, chai_setup_1.expect)(parsed[0].task).to.equal('b');
        (0, chai_setup_1.expect)(parsed[1].task).to.equal('c');
    });
    (0, mocha_globals_1.test)('sanitizes invalid duration and coverage', async () => {
        await emitter.record({ task: 'x', status: 'fail', durationMs: NaN, coverage: { statements: -5, lines: 12.7 } });
        const key = Array.from(writes.keys()).find((k) => typeof k === 'string' && k.endsWith('gate-report.json'));
        const written = key ? writes.get(key) : writes.get('lastWrite');
        const parsed = JSON.parse(new TextDecoder().decode(written));
        (0, chai_setup_1.expect)(parsed[0].durationMs).to.equal(0);
        (0, chai_setup_1.expect)(parsed[0].coverage?.statements).to.equal(0);
        (0, chai_setup_1.expect)(parsed[0].coverage?.lines).to.equal(13);
    });
    (0, mocha_globals_1.test)('read returns [] when no file', async () => {
        const result = await emitter.read();
        (0, chai_setup_1.expect)(result).to.deep.equal([]);
    });
});
//# sourceMappingURL=gate-telemetry.unit.test.js.map
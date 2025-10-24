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
describe('Configuration Validation', () => {
    async function createManager() {
        const logger = new logger_1.Logger('CfgTest');
        const context = {
            subscriptions: [],
            extensionUri: vscode.Uri.parse('file://test'),
            secrets: { get: async () => undefined }
        };
        const mgr = new configuration_manager_1.ConfigurationManager(context, logger);
        await mgr.initialize();
        return mgr;
    }
    it('Detects invalid endpoint format', async () => {
        const cfg = vscode.workspace.getConfiguration('voicepilot.azureOpenAI');
        await cfg.update('endpoint', 'http://bad-endpoint', vscode.ConfigurationTarget.Global);
        const mgr = await createManager();
        const result = mgr.getDiagnostics();
        assert.ok(result, 'Validation result should exist');
        const hasInvalid = result.errors.some(e => e.code === 'INVALID_ENDPOINT_FORMAT' || e.code === 'MISSING_ENDPOINT');
        assert.ok(hasInvalid, 'Should flag invalid endpoint');
    });
    it('Valid sensitivity range passes', async () => {
        const commands = vscode.workspace.getConfiguration('voicepilot.commands');
        await commands.update('sensitivity', 0.9, vscode.ConfigurationTarget.Global);
        const mgr = await createManager();
        const result = mgr.getDiagnostics();
        assert.ok(result);
        const sensErrors = result.errors.filter(e => e.path === 'voicepilot.commands.sensitivity');
        assert.strictEqual(sensErrors.length, 0, 'No sensitivity errors expected for 0.9');
    });
});
//# sourceMappingURL=configuration.validator.test.js.map
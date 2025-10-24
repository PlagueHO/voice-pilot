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
const ensure_copilot_1 = require("../../src/helpers/ensure-copilot");
const chai_setup_1 = require("../helpers/chai-setup");
const mocha_globals_1 = require("../mocha-globals");
// Utility to reset mutable vscode mock facets between tests
function resetVscodeMocks() {
    const extensionsApi = vscode.extensions;
    if (extensionsApi && typeof extensionsApi === 'object') {
        extensionsApi.getExtension = () => undefined;
    }
    vscode.window.showInformationMessage = () => Promise.resolve(undefined);
    vscode.window.showErrorMessage = () => Promise.resolve(undefined);
    vscode.commands.executeCommand = () => Promise.resolve(undefined);
}
(0, mocha_globals_1.suite)('Unit: ensure-copilot helper', () => {
    (0, mocha_globals_1.beforeEach)(() => {
        resetVscodeMocks();
    });
    (0, mocha_globals_1.test)('returns true when Copilot Chat is already installed and active', async () => {
        let activated = false;
        vscode.extensions.getExtension = () => ({ isActive: true, activate: () => { activated = true; } });
        const availablePre = (0, ensure_copilot_1.isCopilotChatAvailable)();
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(availablePre, 'Extension should be reported available').to.equal(true);
        (0, chai_setup_1.expect)(result, 'Should resolve true').to.equal(true);
        (0, chai_setup_1.expect)(activated, 'Should not call activate when already active').to.equal(false);
    });
    (0, mocha_globals_1.test)('activates extension when installed but inactive', async () => {
        let activateCalls = 0;
        vscode.extensions.getExtension = () => ({ isActive: false, activate: async () => { activateCalls++; } });
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(result).to.equal(true);
        (0, chai_setup_1.expect)(activateCalls, 'Should activate inactive extension').to.equal(1);
    });
    (0, mocha_globals_1.test)('returns false when activation throws', async () => {
        vscode.extensions.getExtension = () => ({
            isActive: false,
            activate: async () => {
                throw new Error('activation failure');
            },
        });
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(result, 'Should return false when activation fails').to.equal(false);
    });
    (0, mocha_globals_1.test)('prompts and returns false when user declines install', async () => {
        let promptShown = false;
        vscode.window.showInformationMessage = (msg, install, later) => {
            promptShown = true;
            return Promise.resolve(later); // user chooses Later
        };
        let installCalled = false;
        vscode.commands.executeCommand = (cmd) => {
            if (cmd === 'workbench.extensions.installExtension') {
                installCalled = true;
            }
            return Promise.resolve();
        };
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(promptShown, 'Prompt should be shown').to.equal(true);
        (0, chai_setup_1.expect)(installCalled, 'Install should not be triggered').to.equal(false);
        (0, chai_setup_1.expect)(result, 'Result should be false when user declines').to.equal(false);
    });
    (0, mocha_globals_1.test)('installs and reloads when user accepts', async () => {
        const callSeq = [];
        // First information message -> accept install, second -> reload
        let infoCall = 0;
        vscode.window.showInformationMessage = (msg, opt1, opt2) => {
            infoCall++;
            if (infoCall === 1) {
                callSeq.push('prompt-install');
                return Promise.resolve(opt1); // choose Install Copilot Chat
            }
            else {
                callSeq.push('prompt-reload');
                return Promise.resolve('Reload Window');
            }
        };
        let installed = false;
        let reloaded = false;
        vscode.commands.executeCommand = (cmd) => {
            if (cmd === 'workbench.extensions.installExtension') {
                installed = true;
            }
            if (cmd === 'workbench.action.reloadWindow') {
                reloaded = true;
            }
            return Promise.resolve();
        };
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(result, 'Should return true after installation flow').to.equal(true);
        (0, chai_setup_1.expect)(installed, 'Install command should be executed').to.equal(true);
        (0, chai_setup_1.expect)(reloaded, 'Reload command should be executed').to.equal(true);
        (0, chai_setup_1.expect)(callSeq).to.deep.equal(['prompt-install', 'prompt-reload']);
    });
    (0, mocha_globals_1.test)('shows error and returns false when install throws', async () => {
        let errorShown;
        vscode.window.showInformationMessage = () => Promise.resolve('Install Copilot Chat');
        vscode.window.showErrorMessage = (m) => { errorShown = m; return Promise.resolve(undefined); };
        vscode.commands.executeCommand = (cmd) => {
            if (cmd === 'workbench.extensions.installExtension') {
                return Promise.reject(new Error('network failure'));
            }
            return Promise.resolve();
        };
        const result = await (0, ensure_copilot_1.ensureCopilotChatInstalled)();
        (0, chai_setup_1.expect)(result, 'Should return false on install failure').to.equal(false);
        (0, chai_setup_1.expect)(errorShown && /Failed to install Copilot Chat/.test(errorShown), 'Should show install failure error').to.equal(true);
    });
});
//# sourceMappingURL=ensure-copilot.unit.test.js.map
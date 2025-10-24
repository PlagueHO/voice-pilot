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
const extension_controller_1 = require("../../src/core/extension-controller");
const logger_1 = require("../../src/core/logger");
const extension_1 = require("../../src/extension");
const copilot = __importStar(require("../../src/helpers/ensure-copilot"));
const lifecycle_telemetry_1 = require("../../src/telemetry/lifecycle-telemetry");
const statusBarModule = __importStar(require("../../src/ui/status-bar"));
const voice_control_panel_1 = require("../../src/ui/voice-control-panel");
const chai_setup_1 = require("../helpers/chai-setup");
const mocha_globals_1 = require("../mocha-globals");
const extension_context_1 = require("../utils/extension-context");
function createStubRegistry() {
    const restorers = [];
    return {
        stub(target, key, replacement) {
            const original = target[key];
            target[key] = replacement;
            restorers.push(() => {
                target[key] = original;
            });
        },
        async dispose() {
            while (restorers.length > 0) {
                const restore = restorers.pop();
                if (restore) {
                    restore();
                }
            }
        },
    };
}
(0, mocha_globals_1.suite)('Unit: extension activation lifecycle', () => {
    let registry;
    (0, mocha_globals_1.beforeEach)(() => {
        registry = createStubRegistry();
        class StubStatusBar {
            showReady() { }
            showInfo() { }
            showError() { }
            dispose() { }
        }
        registry.stub(statusBarModule, 'StatusBar', StubStatusBar);
    });
    (0, mocha_globals_1.afterEach)(async () => {
        await (0, extension_1.deactivate)();
        await registry.dispose();
    });
    (0, mocha_globals_1.test)('activates extension and updates contexts when Copilot is available', async () => {
        const availability = [];
        registry.stub(voice_control_panel_1.VoiceControlPanel.prototype, 'setCopilotAvailable', function (available) {
            availability.push(available);
        });
        let initializeCalls = 0;
        registry.stub(extension_controller_1.ExtensionController.prototype, 'initialize', async function () {
            initializeCalls += 1;
        });
        let disposeCalls = 0;
        registry.stub(extension_controller_1.ExtensionController.prototype, 'dispose', function () {
            disposeCalls += 1;
        });
        let ensureCalls = 0;
        registry.stub(copilot, 'isCopilotChatAvailable', () => true);
        registry.stub(copilot, 'ensureCopilotChatInstalled', async () => {
            ensureCalls += 1;
            return true;
        });
        const executed = [];
        registry.stub(vscode.commands, 'executeCommand', (command, ...args) => {
            executed.push({ command, args });
            return Promise.resolve(undefined);
        });
        let resetCalled = false;
        registry.stub(lifecycle_telemetry_1.lifecycleTelemetry, 'reset', () => {
            resetCalled = true;
        });
        const nowValues = [0, 1500];
        registry.stub(performance, 'now', () => nowValues.shift() ?? 1500);
        const context = (0, extension_context_1.createExtensionContextStub)();
        await (0, extension_1.activate)(context);
        (0, chai_setup_1.expect)(resetCalled, 'telemetry.reset should be invoked').to.equal(true);
        (0, chai_setup_1.expect)(initializeCalls, 'controller.initialize should be called once').to.equal(1);
        (0, chai_setup_1.expect)(ensureCalls, 'ensure install should not be called when Copilot is already available').to.equal(0);
        (0, chai_setup_1.expect)(availability, 'voice panel should reflect Copilot availability').to.deep.equal([true]);
        (0, chai_setup_1.expect)(executed.some((entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.copilotAvailable' && entry.args[1] === true)).to.equal(true);
        (0, chai_setup_1.expect)(executed.some((entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.activated' && entry.args[1] === true)).to.equal(true);
        (0, chai_setup_1.expect)(context.subscriptions.length >= 2, 'disposables should be registered on the context').to.equal(true);
        await (0, extension_1.deactivate)();
        (0, chai_setup_1.expect)(disposeCalls, 'controller.dispose should be called exactly once during deactivate').to.equal(1);
    });
    (0, mocha_globals_1.test)('warns when activation exceeds the five second threshold', async () => {
        registry.stub(copilot, 'isCopilotChatAvailable', () => true);
        registry.stub(copilot, 'ensureCopilotChatInstalled', async () => true);
        registry.stub(extension_controller_1.ExtensionController.prototype, 'initialize', async () => { });
        registry.stub(extension_controller_1.ExtensionController.prototype, 'dispose', () => { });
        const warns = [];
        registry.stub(logger_1.Logger.prototype, 'warn', function (message, data) {
            warns.push({ message, data });
        });
        registry.stub(vscode.commands, 'executeCommand', () => Promise.resolve(undefined));
        const nowValues = [0, 6005];
        registry.stub(performance, 'now', () => nowValues.shift() ?? 6005);
        const context = (0, extension_context_1.createExtensionContextStub)();
        await (0, extension_1.activate)(context);
        const warning = warns.find((entry) => entry.message === 'Activation exceeded 5s constraint');
        (0, chai_setup_1.expect)(Boolean(warning), 'warning should be logged when activation duration exceeds threshold').to.equal(true);
        (0, chai_setup_1.expect)((warning?.data?.duration ?? 0) > 5000, 'warning payload should include activation duration').to.equal(true);
    });
    (0, mocha_globals_1.test)('falls back when Copilot remains unavailable after prompt', async () => {
        const availability = [];
        registry.stub(voice_control_panel_1.VoiceControlPanel.prototype, 'setCopilotAvailable', function (available) {
            availability.push(available);
        });
        registry.stub(copilot, 'isCopilotChatAvailable', () => false);
        let ensureCalls = 0;
        registry.stub(copilot, 'ensureCopilotChatInstalled', async () => {
            ensureCalls += 1;
            return false;
        });
        registry.stub(extension_controller_1.ExtensionController.prototype, 'initialize', async () => { });
        registry.stub(extension_controller_1.ExtensionController.prototype, 'dispose', () => { });
        const executed = [];
        registry.stub(vscode.commands, 'executeCommand', (command, ...args) => {
            executed.push({ command, args });
            return Promise.resolve(undefined);
        });
        const nowValues = [0, 1200];
        registry.stub(performance, 'now', () => nowValues.shift() ?? 1200);
        const context = (0, extension_context_1.createExtensionContextStub)();
        await (0, extension_1.activate)(context);
        (0, chai_setup_1.expect)(ensureCalls, 'ensure install should be attempted when Copilot is unavailable').to.equal(1);
        (0, chai_setup_1.expect)(availability, 'voice panel should mark Copilot as unavailable').to.deep.equal([false]);
        const availabilityContext = executed.find((entry) => entry.command === 'setContext' && entry.args[0] === 'voicepilot.copilotAvailable');
        (0, chai_setup_1.expect)(Boolean(availabilityContext), 'setContext for copilot availability should be executed').to.equal(true);
        (0, chai_setup_1.expect)(availabilityContext?.args[1]).to.equal(false);
    });
    (0, mocha_globals_1.test)('surfaces errors when controller initialization fails', async () => {
        registry.stub(copilot, 'isCopilotChatAvailable', () => true);
        registry.stub(copilot, 'ensureCopilotChatInstalled', async () => true);
        registry.stub(extension_controller_1.ExtensionController.prototype, 'initialize', async () => {
            throw new Error('controller init failed');
        });
        let disposeCalls = 0;
        registry.stub(extension_controller_1.ExtensionController.prototype, 'dispose', function () {
            disposeCalls += 1;
        });
        const errorMessages = [];
        registry.stub(vscode.window, 'showErrorMessage', (message) => {
            errorMessages.push(message);
            return Promise.resolve(undefined);
        });
        const recorded = [];
        registry.stub(lifecycle_telemetry_1.lifecycleTelemetry, 'record', (event) => {
            recorded.push(event);
        });
        registry.stub(vscode.commands, 'executeCommand', () => Promise.resolve(undefined));
        const nowValues = [0, 800];
        registry.stub(performance, 'now', () => nowValues.shift() ?? 800);
        const context = (0, extension_context_1.createExtensionContextStub)();
        await (0, chai_setup_1.expect)((0, extension_1.activate)(context)).to.be.rejectedWith(/controller init failed/);
        (0, chai_setup_1.expect)(disposeCalls, 'controller.dispose should be invoked after failure').to.equal(1);
        (0, chai_setup_1.expect)(errorMessages.some((msg) => msg.includes('VoicePilot activation failed: controller init failed')), 'user-facing error should be shown').to.equal(true);
        (0, chai_setup_1.expect)(recorded.includes('activation.failed'), 'lifecycle telemetry should record activation failure').to.equal(true);
    });
});
//# sourceMappingURL=extension.activation.unit.test.js.map
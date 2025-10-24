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
const status_bar_1 = require("../../src/../ui/status-bar");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
class StatusBarItemTestDouble {
    id = "voicepilot.status-bar";
    alignment = vscode.StatusBarAlignment.Right;
    priority = undefined;
    name;
    tooltip;
    text = "";
    color;
    backgroundColor;
    command;
    accessibilityInformation;
    showCalls = 0;
    disposeCalls = 0;
    show() {
        this.showCalls += 1;
    }
    hide() { }
    dispose() {
        this.disposeCalls += 1;
    }
}
(0, mocha_globals_1.suite)("Unit: StatusBar", () => {
    let statusBarAlignmentPatched = false;
    let themeColorPatched = false;
    class ThemeColorStub {
        id;
        constructor(id) {
            this.id = id;
        }
    }
    (0, mocha_globals_1.before)(() => {
        if (!vscode.StatusBarAlignment) {
            vscode.StatusBarAlignment = {
                Left: 1,
                Right: 2,
            };
            statusBarAlignmentPatched = true;
        }
        if (!vscode.ThemeColor) {
            vscode.ThemeColor = ThemeColorStub;
            themeColorPatched = true;
        }
    });
    (0, mocha_globals_1.after)(() => {
        if (statusBarAlignmentPatched) {
            delete vscode.StatusBarAlignment;
            statusBarAlignmentPatched = false;
        }
        if (themeColorPatched) {
            delete vscode.ThemeColor;
            themeColorPatched = false;
        }
    });
    const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
    let createdItems;
    let factoryInvocations;
    let disposables;
    (0, mocha_globals_1.beforeEach)(() => {
        createdItems = [];
        factoryInvocations = [];
        disposables = [];
        vscode.window.createStatusBarItem = ((...args) => {
            const argList = args;
            let alignment;
            let priority;
            if (typeof argList[0] === "string") {
                alignment =
                    typeof argList[1] === "number"
                        ? argList[1]
                        : undefined;
                priority =
                    typeof argList[2] === "number" ? argList[2] : undefined;
            }
            else if (argList[0] &&
                typeof argList[0] === "object" &&
                "alignment" in argList[0]) {
                const options = argList[0];
                alignment = options.alignment;
                priority = options.priority;
            }
            else {
                alignment = argList[0];
                priority = argList[1];
            }
            const item = new StatusBarItemTestDouble();
            item.alignment = alignment ?? vscode.StatusBarAlignment.Left;
            item.priority = priority;
            createdItems.push(item);
            factoryInvocations.push({ alignment, priority });
            return item;
        });
    });
    (0, mocha_globals_1.afterEach)(() => {
        vscode.window.createStatusBarItem = originalCreateStatusBarItem;
        disposables.forEach((statusBar) => statusBar.dispose());
    });
    function instantiate() {
        const statusBar = new status_bar_1.StatusBar();
        disposables.push(statusBar);
        const item = createdItems.at(-1);
        if (!item) {
            throw new Error("Status bar item was not created");
        }
        return { statusBar, item };
    }
    (0, mocha_globals_1.test)("constructor primes ready state and reveals status bar", () => {
        const { item } = instantiate();
        (0, chai_setup_1.expect)(factoryInvocations).to.deep.equal([
            { alignment: vscode.StatusBarAlignment.Right, priority: 100 },
        ]);
        (0, chai_setup_1.expect)(item.text).to.equal("$(mic) VoicePilot: Ready");
        (0, chai_setup_1.expect)(item.tooltip).to.equal("VoicePilot voice assistant");
        (0, chai_setup_1.expect)(item.showCalls).to.equal(1);
        (0, chai_setup_1.expect)(item.backgroundColor).to.be.undefined;
        (0, chai_setup_1.expect)(item.color).to.be.undefined;
        (0, chai_setup_1.expect)(item.command).to.be.undefined;
    });
    (0, mocha_globals_1.test)("showReady updates text and clears styling", () => {
        const { statusBar, item } = instantiate();
        item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
        item.color = new vscode.ThemeColor("statusBarItem.prominentForeground");
        item.command = "voicepilot.startConversation";
        statusBar.showReady("Listening");
        (0, chai_setup_1.expect)(item.text).to.equal("$(mic) VoicePilot: Listening");
        (0, chai_setup_1.expect)(item.tooltip).to.equal("VoicePilot voice assistant");
        (0, chai_setup_1.expect)(item.backgroundColor).to.be.undefined;
        (0, chai_setup_1.expect)(item.color).to.be.undefined;
        (0, chai_setup_1.expect)(item.command).to.be.undefined;
    });
    (0, mocha_globals_1.test)("showInfo displays informational message with fallback tooltip", () => {
        const { statusBar, item } = instantiate();
        statusBar.showInfo("Connecting");
        (0, chai_setup_1.expect)(item.text).to.equal("$(comment-discussion) VoicePilot: Connecting");
        (0, chai_setup_1.expect)(item.tooltip).to.equal("VoicePilot status");
        (0, chai_setup_1.expect)(item.backgroundColor).to.be.undefined;
        (0, chai_setup_1.expect)(item.color).to.be.undefined;
        (0, chai_setup_1.expect)(item.command).to.be.undefined;
    });
    (0, mocha_globals_1.test)("showInfo honors provided tooltip", () => {
        const { statusBar, item } = instantiate();
        statusBar.showInfo("Retrying", "Retrying session setup");
        (0, chai_setup_1.expect)(item.text).to.equal("$(comment-discussion) VoicePilot: Retrying");
        (0, chai_setup_1.expect)(item.tooltip).to.equal("Retrying session setup");
    });
    (0, mocha_globals_1.test)("showError applies theme colors and remediation tooltip", () => {
        const { statusBar, item } = instantiate();
        const error = {
            id: "session-recovery-failed",
            faultDomain: "session",
            severity: "error",
            userImpact: "blocked",
            code: "session.recovery.failed",
            message: "Voice session failed to recover",
            remediation: "Try reconnecting to restore voice control",
            timestamp: new Date(),
        };
        statusBar.showError(error);
        (0, chai_setup_1.expect)(item.text).to.equal("$(error) VoicePilot issue");
        (0, chai_setup_1.expect)(item.tooltip).to.equal(`${error.message}\n${error.remediation}`);
        (0, chai_setup_1.expect)(item.backgroundColor).to.be.instanceOf(vscode.ThemeColor);
        const background = item.backgroundColor;
        (0, chai_setup_1.expect)(background?.id).to.equal("statusBarItem.errorBackground");
        (0, chai_setup_1.expect)(item.color).to.be.instanceOf(vscode.ThemeColor);
        const foreground = item.color;
        (0, chai_setup_1.expect)(foreground?.id).to.equal("statusBarItem.prominentForeground");
    });
    (0, mocha_globals_1.test)("dispose releases underlying status bar item", () => {
        const { statusBar, item } = instantiate();
        statusBar.dispose();
        (0, chai_setup_1.expect)(item.disposeCalls).to.equal(1);
    });
});
//# sourceMappingURL=status-bar.unit.test.js.map
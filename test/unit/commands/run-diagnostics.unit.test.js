"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const run_diagnostics_1 = require("../../src/../commands/run-diagnostics");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)("Unit: Cleanup Diagnostics Command", () => {
    function createReport(overrides = {}) {
        return {
            reason: "session-end",
            startedAt: 0,
            completedAt: 5,
            steps: [
                {
                    name: "config",
                    durationMs: 2,
                    success: true,
                    skipped: false,
                },
                {
                    name: "session",
                    durationMs: 3,
                    success: false,
                    skipped: false,
                    error: new Error("session failure"),
                },
            ],
            orphanSnapshot: {
                timers: 1,
                audioNodes: 0,
                mediaStreams: 0,
                dataChannels: 0,
                disposables: 0,
            },
            dryRun: false,
            ...overrides,
        };
    }
    (0, mocha_globals_1.test)("summarizeCleanupReport calculates totals and message", () => {
        const result = (0, run_diagnostics_1.summarizeCleanupReport)(createReport());
        (0, chai_setup_1.expect)(result.summary.totalOrphans).to.equal(1);
        (0, chai_setup_1.expect)(result.summary.failures).to.equal(1);
        (0, chai_setup_1.expect)(result.summary.stepsEvaluated).to.equal(2);
        (0, chai_setup_1.expect)(result.summary.message).to.contain("detected 1 orphaned resource");
    });
    (0, mocha_globals_1.test)("presentCleanupDiagnostics uses warning when orphans detected", async () => {
        const warnings = [];
        const infos = [];
        const windowStub = {
            showWarningMessage: async (message) => {
                warnings.push(message);
                return undefined;
            },
            showInformationMessage: async (message) => {
                infos.push(message);
                return undefined;
            },
        };
        const result = (0, run_diagnostics_1.summarizeCleanupReport)(createReport());
        await (0, run_diagnostics_1.presentCleanupDiagnostics)(result, windowStub);
        (0, chai_setup_1.expect)(warnings).to.have.length(1);
        (0, chai_setup_1.expect)(infos).to.have.length(0);
        (0, chai_setup_1.expect)(warnings[0]).to.contain("Snapshot:");
    });
    (0, mocha_globals_1.test)("presentCleanupDiagnostics reports info when no findings", async () => {
        const warnings = [];
        const infos = [];
        const windowStub = {
            showWarningMessage: async (message) => {
                warnings.push(message);
                return undefined;
            },
            showInformationMessage: async (message) => {
                infos.push(message);
                return undefined;
            },
        };
        const result = (0, run_diagnostics_1.summarizeCleanupReport)(createReport({
            steps: [
                {
                    name: "config",
                    durationMs: 1,
                    success: true,
                    skipped: false,
                },
            ],
            orphanSnapshot: {
                timers: 0,
                audioNodes: 0,
                mediaStreams: 0,
                dataChannels: 0,
                disposables: 0,
            },
        }));
        await (0, run_diagnostics_1.presentCleanupDiagnostics)(result, windowStub);
        (0, chai_setup_1.expect)(warnings).to.have.length(0);
        (0, chai_setup_1.expect)(infos).to.have.length(1);
        (0, chai_setup_1.expect)(infos[0]).to.contain("Steps inspected");
    });
});
//# sourceMappingURL=run-diagnostics.unit.test.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const disposal_orchestrator_1 = require("../../src/../core/disposal/disposal-orchestrator");
const orphan_detector_1 = require("../../src/../core/disposal/orphan-detector");
const logger_1 = require("../../src/../telemetry/logger");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createStubLogger() {
    const logger = {
        info: () => {
            /* noop */
        },
        warn: () => {
            /* noop */
        },
        error: () => {
            /* noop */
        },
        debug: () => {
            /* noop */
        },
        setLevel: () => {
            /* noop */
        },
        dispose: () => {
            /* noop */
        },
    };
    return logger;
}
(0, mocha_globals_1.suite)("Integration: Cleanup Telemetry Flow", () => {
    (0, mocha_globals_1.test)("disposeAll emits report and step telemetry with cleared orphans", async () => {
        const orphanDetector = new orphan_detector_1.OrphanDetector();
        const logger = createStubLogger();
        const orchestrator = new disposal_orchestrator_1.DisposalOrchestratorImpl(logger, orphanDetector);
        await orchestrator.initialize();
        const releaseTimer = orphanDetector.trackTimer("timer-1");
        let disposed = false;
        const timerScope = {
            id: "timerScope",
            priority: 10,
            dispose: () => {
                disposed = true;
                releaseTimer();
            },
            isDisposed: () => disposed,
        };
        orchestrator.register(timerScope);
        logger_1.telemetryLogger.reset();
        const report = await orchestrator.disposeAll("session-end");
        const payload = logger_1.telemetryLogger.recordCleanupReport(report, {
            emitStepEvents: true,
        });
        const events = logger_1.telemetryLogger.getEvents();
        (0, chai_setup_1.expect)(report.dryRun).to.equal(false);
        (0, chai_setup_1.expect)(report.orphanSnapshot.timers).to.equal(0);
        (0, chai_setup_1.expect)(payload.failureCount).to.equal(0);
        (0, chai_setup_1.expect)(events).to.have.length(1 + payload.steps.length);
        (0, chai_setup_1.expect)(events[0].name).to.equal("voicepilot.cleanup.report");
        (0, chai_setup_1.expect)(events
            .slice(1)
            .every((event) => event.name === "voicepilot.cleanup.step")).to.equal(true);
    });
});
//# sourceMappingURL=cleanup-telemetry.integration.test.js.map
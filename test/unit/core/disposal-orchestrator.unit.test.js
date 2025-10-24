"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const disposal_orchestrator_1 = require("../../src/../core/disposal/disposal-orchestrator");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createStubLogger() {
    const entries = [];
    const baseLogger = {
        info: (message, data) => {
            entries.push({ level: "info", message, data });
        },
        warn: (message, data) => {
            entries.push({ level: "warn", message, data });
        },
        error: (message, data) => {
            entries.push({ level: "error", message, data });
        },
        debug: (message, data) => {
            entries.push({ level: "debug", message, data });
        },
        setLevel: () => {
            /* noop */
        },
        dispose: () => {
            /* noop */
        },
    };
    return { logger: baseLogger, entries };
}
function createOrphanDetector(snapshot) {
    return {
        captureSnapshot: async () => snapshot,
        reset: () => {
            /* noop */
        },
    };
}
function createDisposable(id, priority, options = {}, callOrder = []) {
    let disposed = options.initialDisposed ?? false;
    return {
        id,
        priority,
        dispose: async (reason) => {
            callOrder.push(id);
            if (options.reason) {
                (0, chai_setup_1.expect)(reason).to.equal(options.reason);
            }
            if (options.fail) {
                throw new Error(`${id} failed disposal`);
            }
            disposed = true;
        },
        isDisposed: () => disposed,
    };
}
(0, mocha_globals_1.suite)("Unit: DisposalOrchestrator", () => {
    (0, mocha_globals_1.test)("disposeAll executes scopes by ascending priority", async () => {
        const { logger } = createStubLogger();
        const callOrder = [];
        const orchestrator = new disposal_orchestrator_1.DisposalOrchestratorImpl(logger, createOrphanDetector({
            timers: 0,
            audioNodes: 0,
            mediaStreams: 0,
            dataChannels: 0,
            disposables: 0,
        }));
        await orchestrator.initialize();
        orchestrator.register(createDisposable("config", 10, {}, callOrder));
        orchestrator.register(createDisposable("auth", 20, {}, callOrder));
        orchestrator.register(createDisposable("session", 30, {}, callOrder));
        const report = await orchestrator.disposeAll("session-end");
        (0, chai_setup_1.expect)(callOrder).to.deep.equal(["config", "auth", "session"]);
        const stepNames = report.steps.map((step) => step.name);
        (0, chai_setup_1.expect)(stepNames).to.deep.equal([
            "config",
            "auth",
            "session",
        ]);
        (0, chai_setup_1.expect)(report.steps.every((step) => step.success)).to.equal(true);
        (0, chai_setup_1.expect)(report.dryRun).to.equal(false);
    });
    (0, mocha_globals_1.test)("disposeAll aggregates failures and surfaces errors", async () => {
        const { logger } = createStubLogger();
        const orchestrator = new disposal_orchestrator_1.DisposalOrchestratorImpl(logger, createOrphanDetector({
            timers: 0,
            audioNodes: 0,
            mediaStreams: 0,
            dataChannels: 0,
            disposables: 0,
        }));
        await orchestrator.initialize();
        const callOrder = [];
        orchestrator.register(createDisposable("config", 10, {}, callOrder));
        orchestrator.register(createDisposable("auth", 20, { fail: true, reason: "session-end" }, callOrder));
        orchestrator.register(createDisposable("session", 30, {}, callOrder));
        const report = await orchestrator.disposeAll("session-end");
        (0, chai_setup_1.expect)(callOrder).to.deep.equal(["config", "auth", "session"]);
        const failingStep = report.steps.find((step) => step.name === "auth");
        (0, chai_setup_1.expect)(failingStep).to.not.equal(undefined);
        (0, chai_setup_1.expect)(failingStep?.success).to.equal(false);
        (0, chai_setup_1.expect)(failingStep?.error).to.be.instanceOf(Error);
        (0, chai_setup_1.expect)(report.aggregatedError).to.be.instanceOf(AggregateError);
    });
    (0, mocha_globals_1.test)("dry-run disposal skips execution and marks steps", async () => {
        const { logger } = createStubLogger();
        const callOrder = [];
        const orchestrator = new disposal_orchestrator_1.DisposalOrchestratorImpl(logger, createOrphanDetector({
            timers: 1,
            audioNodes: 0,
            mediaStreams: 0,
            dataChannels: 0,
            disposables: 0,
        }));
        await orchestrator.initialize();
        orchestrator.register(createDisposable("config", 5, { initialDisposed: false }, callOrder));
        orchestrator.register(createDisposable("auth", 6, { initialDisposed: true }, callOrder));
        const report = await orchestrator.disposeAll("config-reload", {
            dryRun: true,
            auditTrailId: "diagnostics",
        });
        (0, chai_setup_1.expect)(callOrder).to.deep.equal([]);
        (0, chai_setup_1.expect)(report.dryRun).to.equal(true);
        (0, chai_setup_1.expect)(report.steps).to.have.length(2);
        (0, chai_setup_1.expect)(report.steps.every((step) => step.skipped)).to.equal(true);
        const [configStep, authStep] = report.steps;
        (0, chai_setup_1.expect)(configStep.success).to.equal(false);
        (0, chai_setup_1.expect)(authStep.success).to.equal(true);
        (0, chai_setup_1.expect)(report.orphanSnapshot.timers).to.equal(1);
    });
});
//# sourceMappingURL=disposal-orchestrator.unit.test.js.map
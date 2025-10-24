"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const audio_metrics_1 = require("../../src/../audio/audio-metrics");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)("Unit: Audio performance trackers", () => {
    (0, mocha_globals_1.test)("records and summarizes performance budget samples", () => {
        const definitions = [
            { id: "analysis", limitMs: 50, requirement: "AUD-004" },
        ];
        const tracker = new audio_metrics_1.PerformanceBudgetTracker(definitions);
        tracker.record("analysis", 40);
        tracker.record("analysis", 65);
        const summary = tracker.getSummary("analysis");
        (0, chai_setup_1.expect)(summary, "Summary should be available after recording samples").to.exist;
        (0, chai_setup_1.expect)(summary.count, "Should record both samples").to.equal(2);
        (0, chai_setup_1.expect)(summary.breaches, "Should track budget breaches").to.equal(1);
        (0, chai_setup_1.expect)(summary.maxMs >= 65, "Should capture maximum duration").to.be.true;
        (0, chai_setup_1.expect)(Number(summary.averageMs.toFixed(2)), "Average duration should reflect recorded samples").to.equal(Number(((40 + 65) / 2).toFixed(2)));
    });
    (0, mocha_globals_1.test)("tracks CPU utilization and identifies threshold breaches", () => {
        const tracker = new audio_metrics_1.CpuLoadTracker(0.1);
        tracker.record(5, 100);
        tracker.record(20, 100);
        const summary = tracker.getSummary();
        (0, chai_setup_1.expect)(summary, "Summary should be available after samples").to.exist;
        (0, chai_setup_1.expect)(summary.count, "Should record both CPU samples").to.equal(2);
        (0, chai_setup_1.expect)(summary.breaches, "Should flag utilization above threshold").to.equal(1);
        (0, chai_setup_1.expect)(summary.maxUtilization, "Should capture utilization above budget").to.be.greaterThan(summary.budget);
    });
});
//# sourceMappingURL=audio-metrics.performance.unit.test.js.map
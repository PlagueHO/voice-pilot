import {
    CpuLoadTracker,
    PerformanceBudgetTracker,
    type PerformanceBudgetDefinition,
} from "../../../src/audio/audio-metrics";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

suite("Unit: Audio performance trackers", () => {
  test("records and summarizes performance budget samples", () => {
    const definitions: PerformanceBudgetDefinition[] = [
      { id: "analysis", limitMs: 50, requirement: "AUD-004" },
    ];
    const tracker = new PerformanceBudgetTracker(definitions);

    tracker.record("analysis", 40);
    tracker.record("analysis", 65);

    const summary = tracker.getSummary("analysis");
    expect(summary, "Summary should be available after recording samples").to.exist;
    expect(summary!.count, "Should record both samples").to.equal(2);
    expect(summary!.breaches, "Should track budget breaches").to.equal(1);
    expect(summary!.maxMs >= 65, "Should capture maximum duration").to.be.true;
    expect(Number(summary!.averageMs.toFixed(2)), "Average duration should reflect recorded samples").to.equal(
      Number(((40 + 65) / 2).toFixed(2)),
    );
  });

  test("tracks CPU utilization and identifies threshold breaches", () => {
    const tracker = new CpuLoadTracker(0.1);

    tracker.record(5, 100);
    tracker.record(20, 100);

    const summary = tracker.getSummary();
    expect(summary, "Summary should be available after samples").to.exist;
    expect(summary!.count, "Should record both CPU samples").to.equal(2);
    expect(summary!.breaches, "Should flag utilization above threshold").to.equal(1);
    expect(summary!.maxUtilization, "Should capture utilization above budget").to.be.greaterThan(
      summary!.budget,
    );
  });
});

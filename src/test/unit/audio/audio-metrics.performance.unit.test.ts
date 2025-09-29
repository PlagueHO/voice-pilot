import * as assert from "assert";
import {
    CpuLoadTracker,
    PerformanceBudgetTracker,
    type PerformanceBudgetDefinition,
} from "../../../audio/audio-metrics";

describe("Audio performance trackers", () => {
  it("records and summarizes performance budget samples", () => {
    const definitions: PerformanceBudgetDefinition[] = [
      { id: "analysis", limitMs: 50, requirement: "AUD-004" },
    ];
    const tracker = new PerformanceBudgetTracker(definitions);

    tracker.record("analysis", 40);
    tracker.record("analysis", 65);

    const summary = tracker.getSummary("analysis");
    assert.ok(summary, "Summary should be available after recording samples");
    assert.strictEqual(summary!.count, 2, "Should record both samples");
    assert.strictEqual(summary!.breaches, 1, "Should track budget breaches");
    assert.strictEqual(summary!.maxMs >= 65, true, "Should capture maximum duration");
    assert.strictEqual(
      Number(summary!.averageMs.toFixed(2)),
      Number(((40 + 65) / 2).toFixed(2)),
      "Average duration should reflect recorded samples",
    );
  });

  it("tracks CPU utilization and identifies threshold breaches", () => {
    const tracker = new CpuLoadTracker(0.1);

    tracker.record(5, 100);
    tracker.record(20, 100);

    const summary = tracker.getSummary();
    assert.ok(summary, "Summary should be available after samples");
    assert.strictEqual(summary!.count, 2, "Should record both CPU samples");
    assert.strictEqual(summary!.breaches, 1, "Should flag utilization above threshold");
    assert.ok(summary!.maxUtilization > summary!.budget, "Should capture utilization above budget");
  });
});

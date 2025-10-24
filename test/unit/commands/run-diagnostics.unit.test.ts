import {
    presentCleanupDiagnostics,
    summarizeCleanupReport,
} from "../../../src/commands/run-diagnostics";
import type { DisposalReport } from "../../../src/types/disposal";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

suite("Unit: Cleanup Diagnostics Command", () => {
  function createReport(overrides: Partial<DisposalReport> = {}): DisposalReport {
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

  test("summarizeCleanupReport calculates totals and message", () => {
    const result = summarizeCleanupReport(createReport());
    expect(result.summary.totalOrphans).to.equal(1);
    expect(result.summary.failures).to.equal(1);
    expect(result.summary.stepsEvaluated).to.equal(2);
    expect(result.summary.message).to.contain("detected 1 orphaned resource");
  });

  test("presentCleanupDiagnostics uses warning when orphans detected", async () => {
    const warnings: string[] = [];
    const infos: string[] = [];
    const windowStub = {
      showWarningMessage: async (message: string) => {
        warnings.push(message);
        return undefined;
      },
      showInformationMessage: async (message: string) => {
        infos.push(message);
        return undefined;
      },
    };

    const result = summarizeCleanupReport(createReport());
    await presentCleanupDiagnostics(result, windowStub);

    expect(warnings).to.have.length(1);
    expect(infos).to.have.length(0);
    expect(warnings[0]).to.contain("Snapshot:");
  });

  test("presentCleanupDiagnostics reports info when no findings", async () => {
    const warnings: string[] = [];
    const infos: string[] = [];
    const windowStub = {
      showWarningMessage: async (message: string) => {
        warnings.push(message);
        return undefined;
      },
      showInformationMessage: async (message: string) => {
        infos.push(message);
        return undefined;
      },
    };

    const result = summarizeCleanupReport(
      createReport({
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
      }),
    );

    await presentCleanupDiagnostics(result, windowStub);

    expect(warnings).to.have.length(0);
    expect(infos).to.have.length(1);
    expect(infos[0]).to.contain("Steps inspected");
  });
});

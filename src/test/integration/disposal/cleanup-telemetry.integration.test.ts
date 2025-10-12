import { DisposalOrchestratorImpl } from "../../../core/disposal/disposal-orchestrator";
import { OrphanDetector } from "../../../core/disposal/orphan-detector";
import type { Logger } from "../../../core/logger";
import type { TelemetryEvent } from "../../../telemetry/events";
import { telemetryLogger } from "../../../telemetry/logger";
import type { ScopedDisposable } from "../../../types/disposal";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

function createStubLogger(): Logger {
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
  } as unknown as Logger;
  return logger;
}

suite("Integration: Cleanup Telemetry Flow", () => {
  test("disposeAll emits report and step telemetry with cleared orphans", async () => {
    const orphanDetector = new OrphanDetector();
    const logger = createStubLogger();
    const orchestrator = new DisposalOrchestratorImpl(logger, orphanDetector);
    await orchestrator.initialize();

    const releaseTimer = orphanDetector.trackTimer("timer-1");
    let disposed = false;
    const timerScope: ScopedDisposable = {
      id: "timerScope",
      priority: 10,
      dispose: () => {
        disposed = true;
        releaseTimer();
      },
      isDisposed: () => disposed,
    };

    orchestrator.register(timerScope);

    telemetryLogger.reset();
    const report = await orchestrator.disposeAll("session-end");
    const payload = telemetryLogger.recordCleanupReport(report, {
      emitStepEvents: true,
    });

    const events = telemetryLogger.getEvents();

    expect(report.dryRun).to.equal(false);
    expect(report.orphanSnapshot.timers).to.equal(0);
    expect(payload.failureCount).to.equal(0);
    expect(events).to.have.length(1 + payload.steps.length);
    expect(events[0].name).to.equal("voicepilot.cleanup.report");
    expect(
      events
        .slice(1)
        .every((event: TelemetryEvent) => event.name === "voicepilot.cleanup.step"),
    ).to.equal(true);
  });
});

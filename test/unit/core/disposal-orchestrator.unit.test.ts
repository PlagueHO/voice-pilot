import { DisposalOrchestratorImpl } from "../../../src/core/disposal/disposal-orchestrator";
import type { Logger } from "../../../src/core/logger";
import type {
    DisposalReason,
    DisposalStepResult,
    OrphanSnapshot,
    ScopedDisposable,
} from "../../../src/types/disposal";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

function createStubLogger(): { logger: Logger; entries: Array<{
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: unknown;
}> } {
  const entries: Array<{
    level: "info" | "warn" | "error" | "debug";
    message: string;
    data?: unknown;
  }> = [];

  const baseLogger = {
    info: (message: string, data?: unknown) => {
      entries.push({ level: "info", message, data });
    },
    warn: (message: string, data?: unknown) => {
      entries.push({ level: "warn", message, data });
    },
    error: (message: string, data?: unknown) => {
      entries.push({ level: "error", message, data });
    },
    debug: (message: string, data?: unknown) => {
      entries.push({ level: "debug", message, data });
    },
    setLevel: () => {
      /* noop */
    },
    dispose: () => {
      /* noop */
    },
  } as unknown as Logger;

  return { logger: baseLogger, entries };
}

function createOrphanDetector(snapshot: OrphanSnapshot) {
  return {
    captureSnapshot: async () => snapshot,
    reset: () => {
      /* noop */
    },
  } as unknown as import("../../../src/core/disposal/orphan-detector").OrphanDetector;
}

function createDisposable(
  id: string,
  priority: number,
  options: {
    fail?: boolean;
    reason?: DisposalReason;
    initialDisposed?: boolean;
  } = {},
  callOrder: string[] = [],
): ScopedDisposable {
  let disposed = options.initialDisposed ?? false;

  return {
    id,
    priority,
    dispose: async (reason: DisposalReason) => {
      callOrder.push(id);
      if (options.reason) {
        expect(reason).to.equal(options.reason);
      }
      if (options.fail) {
        throw new Error(`${id} failed disposal`);
      }
      disposed = true;
    },
    isDisposed: () => disposed,
  };
}

suite("Unit: DisposalOrchestrator", () => {
  test("disposeAll executes scopes by ascending priority", async () => {
    const { logger } = createStubLogger();
    const callOrder: string[] = [];
    const orchestrator = new DisposalOrchestratorImpl(
      logger,
      createOrphanDetector({
        timers: 0,
        audioNodes: 0,
        mediaStreams: 0,
        dataChannels: 0,
        disposables: 0,
      }),
    );

    await orchestrator.initialize();

    orchestrator.register(createDisposable("config", 10, {}, callOrder));
    orchestrator.register(createDisposable("auth", 20, {}, callOrder));
    orchestrator.register(createDisposable("session", 30, {}, callOrder));

    const report = await orchestrator.disposeAll("session-end");

    expect(callOrder).to.deep.equal(["config", "auth", "session"]);
    const stepNames = report.steps.map((step: DisposalStepResult) => step.name);
    expect(stepNames).to.deep.equal([
      "config",
      "auth",
      "session",
    ]);
    expect(
      report.steps.every((step: DisposalStepResult) => step.success),
    ).to.equal(true);
    expect(report.dryRun).to.equal(false);
  });

  test("disposeAll aggregates failures and surfaces errors", async () => {
    const { logger } = createStubLogger();
    const orchestrator = new DisposalOrchestratorImpl(
      logger,
      createOrphanDetector({
        timers: 0,
        audioNodes: 0,
        mediaStreams: 0,
        dataChannels: 0,
        disposables: 0,
      }),
    );

    await orchestrator.initialize();

    const callOrder: string[] = [];
    orchestrator.register(createDisposable("config", 10, {}, callOrder));
    orchestrator.register(
      createDisposable(
        "auth",
        20,
        { fail: true, reason: "session-end" },
        callOrder,
      ),
    );
    orchestrator.register(createDisposable("session", 30, {}, callOrder));

    const report = await orchestrator.disposeAll("session-end");

    expect(callOrder).to.deep.equal(["config", "auth", "session"]);
    const failingStep = report.steps.find(
      (step: DisposalStepResult) => step.name === "auth",
    );
    expect(failingStep).to.not.equal(undefined);
    expect(failingStep?.success).to.equal(false);
    expect(failingStep?.error).to.be.instanceOf(Error);
    expect(report.aggregatedError).to.be.instanceOf(AggregateError);
  });

  test("dry-run disposal skips execution and marks steps", async () => {
    const { logger } = createStubLogger();
    const callOrder: string[] = [];
    const orchestrator = new DisposalOrchestratorImpl(
      logger,
      createOrphanDetector({
        timers: 1,
        audioNodes: 0,
        mediaStreams: 0,
        dataChannels: 0,
        disposables: 0,
      }),
    );

    await orchestrator.initialize();

    orchestrator.register(
      createDisposable("config", 5, { initialDisposed: false }, callOrder),
    );
    orchestrator.register(
      createDisposable("auth", 6, { initialDisposed: true }, callOrder),
    );

    const report = await orchestrator.disposeAll("config-reload", {
      dryRun: true,
      auditTrailId: "diagnostics",
    });

    expect(callOrder).to.deep.equal([]);
    expect(report.dryRun).to.equal(true);
    expect(report.steps).to.have.length(2);
    expect(
      report.steps.every((step: DisposalStepResult) => step.skipped),
    ).to.equal(true);
    const [configStep, authStep] = report.steps;
    expect(configStep.success).to.equal(false);
    expect(authStep.success).to.equal(true);
    expect(report.orphanSnapshot.timers).to.equal(1);
  });
});

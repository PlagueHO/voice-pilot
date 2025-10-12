import { performance } from "perf_hooks";
import { DisposalOptions, DisposalOrchestrator, DisposalReason, DisposalReport, DisposalStepResult, OrphanSnapshot, ScopedDisposable } from "../../types/disposal";
import { Logger } from "../logger";
import { ServiceInitializable } from "../service-initializable";
import { OrphanDetector } from "./orphan-detector";

interface RegisteredDisposable {
  scope: ScopedDisposable;
  isDisposed: boolean;
}

interface DisposalResult {
  report: DisposalReport;
  errors: Error[];
}

const DEFAULT_GRACE_PERIOD_MS = 2000;

export class DisposalOrchestratorImpl
  implements DisposalOrchestrator, ServiceInitializable
{
  private readonly registry: Map<string, RegisteredDisposable> = new Map();
  private initialized = false;

  constructor(
    private readonly logger: Logger,
    private readonly orphanDetector: OrphanDetector,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.registry.clear();
    this.orphanDetector.reset();
    this.initialized = false;
  }

  register(scope: ScopedDisposable): void {
    if (!scope || !scope.id) {
      throw new Error("ScopedDisposable must provide a non-empty id");
    }
    this.registry.set(scope.id, { scope, isDisposed: scope.isDisposed() });
  }

  async disposeAll(
    reason: DisposalReason,
    options: DisposalOptions = {},
  ): Promise<DisposalReport> {
    if (!this.initialized) {
      throw new Error("DisposalOrchestrator must be initialized before use");
    }

    const startedAt = performance.now();
    const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    const dryRun = options.dryRun === true;
    const scopeEntries = Array.from(this.registry.values()).sort(
      (left, right) => left.scope.priority - right.scope.priority,
    );

    const steps: DisposalStepResult[] = [];
    const errors: Error[] = [];

    for (const entry of scopeEntries) {
      if (dryRun) {
        const alreadyDisposed = entry.scope.isDisposed();
        this.logger.info(`Dry-run inspection for ${entry.scope.id}`, {
          reason,
          auditTrailId: options.auditTrailId,
          alreadyDisposed,
        });
        steps.push({
          name: entry.scope.id,
          durationMs: 0,
          success: alreadyDisposed,
          skipped: true,
        });
        entry.isDisposed = alreadyDisposed;
        continue;
      }

      if (entry.scope.isDisposed()) {
        steps.push({
          name: entry.scope.id,
          durationMs: 0,
          success: true,
          skipped: false,
        });
        entry.isDisposed = true;
        continue;
      }

      const stepStart = performance.now();
      try {
        this.logger.info(`Disposing ${entry.scope.id}`, {
          reason,
          auditTrailId: options.auditTrailId,
        });
        await entry.scope.dispose(reason);
        entry.isDisposed = entry.scope.isDisposed();
        steps.push({
          name: entry.scope.id,
          durationMs: Math.round(performance.now() - stepStart),
          success: entry.isDisposed,
          skipped: false,
        });
      } catch (error: unknown) {
        const err =
          error instanceof Error ? error : new Error(String(error ?? ""));
        this.logger.error("Disposal step failed", {
          scopeId: entry.scope.id,
          reason,
          error: err.message,
          auditTrailId: options.auditTrailId,
        });
        entry.isDisposed = entry.scope.isDisposed();
        const durationMs = Math.round(performance.now() - stepStart);
        steps.push({
          name: entry.scope.id,
          durationMs,
          success: false,
          error: err,
          skipped: false,
        });
        errors.push(err);
      }
    }

    const orphanSnapshot = await this.orphanDetector.captureSnapshot();
    const completedAt = performance.now();
    const durationMs = completedAt - startedAt;

    if (durationMs > gracePeriodMs + 1000) {
      this.logger.error("Disposal exceeded hard timeout", {
        reason,
        durationMs,
        gracePeriodMs,
      });
    } else if (durationMs > gracePeriodMs) {
      this.logger.warn(
        dryRun ? "Dry-run diagnostics exceeded grace period" : "Disposal exceeded grace period",
        {
          reason,
          durationMs,
          gracePeriodMs,
          auditTrailId: options.auditTrailId,
        },
      );
    }

    const report: DisposalReport = {
      reason,
      startedAt,
      completedAt,
      steps,
      orphanSnapshot,
      dryRun,
      auditTrailId: options.auditTrailId,
    };

    if (errors.length > 0) {
      Object.assign(report, {
        aggregatedError: new AggregateError(errors, "One or more disposal steps failed"),
      });
    }

    if (!this.hasZeroOrphans(orphanSnapshot)) {
      this.logger.warn("Orphan resources detected after disposal", {
        reason,
        orphanSnapshot,
      });
    }

    return report;
  }

  private hasZeroOrphans(snapshot: OrphanSnapshot): boolean {
    return (
      snapshot.timers === 0 &&
      snapshot.audioNodes === 0 &&
      snapshot.mediaStreams === 0 &&
      snapshot.dataChannels === 0 &&
      snapshot.disposables === 0
    );
  }
}

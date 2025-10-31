import type {
  DisposalReason,
  DisposalReport,
  DisposalStepResult,
  OrphanSnapshot,
} from "../types/disposal";

export type TelemetryEventName =
  | "agentvoice.cleanup.report"
  | "agentvoice.cleanup.step";

export interface CleanupStepTelemetry {
  name: string;
  durationMs: number;
  success: boolean;
  skipped: boolean;
  errorMessage?: string;
  orphanCounts?: Partial<OrphanSnapshot>;
}

export interface CleanupReportTelemetry {
  reason: DisposalReason;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  dryRun: boolean;
  auditTrailId?: string;
  orphanSnapshot: OrphanSnapshot;
  failureCount: number;
  steps: CleanupStepTelemetry[];
}

export type TelemetryEvent =
  | {
      name: "agentvoice.cleanup.report";
      properties: CleanupReportTelemetry;
    }
  | {
      name: "agentvoice.cleanup.step";
      properties: CleanupStepTelemetry & {
        reason: DisposalReason;
        auditTrailId?: string;
      };
    };

export function sanitizeDisposalStep(
  step: DisposalStepResult,
): CleanupStepTelemetry {
  return {
    name: step.name,
    durationMs: Number.isFinite(step.durationMs)
      ? Math.max(0, Math.round(step.durationMs))
      : 0,
    success: step.success,
    skipped: Boolean(step.skipped),
    errorMessage: step.error?.message,
    orphanCounts: step.orphanCounts,
  };
}

export function createCleanupReportTelemetry(
  report: DisposalReport,
): CleanupReportTelemetry {
  const steps = report.steps.map((step) => sanitizeDisposalStep(step));
  return {
    reason: report.reason,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    durationMs: Math.max(
      0,
      Math.round(report.completedAt - report.startedAt),
    ),
    dryRun: report.dryRun,
    auditTrailId: report.auditTrailId,
    orphanSnapshot: report.orphanSnapshot,
    failureCount: steps.filter((step) => !step.success && !step.skipped).length,
    steps,
  };
}

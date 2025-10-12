import * as vscode from "vscode";
import type { CleanupReportTelemetry } from "../telemetry/events";
import { createCleanupReportTelemetry } from "../telemetry/events";
import type {
    DisposalReport,
    OrphanSnapshot,
} from "../types/disposal";

export interface CleanupDiagnosticsSummary {
  message: string;
  totalOrphans: number;
  stepsEvaluated: number;
  failures: number;
  dryRun: boolean;
  snapshot: OrphanSnapshot;
}

export interface CleanupDiagnosticsResult {
  report: DisposalReport;
  telemetry: CleanupReportTelemetry;
  summary: CleanupDiagnosticsSummary;
}

export function summarizeCleanupReport(
  report: DisposalReport,
): CleanupDiagnosticsResult {
  const telemetry = createCleanupReportTelemetry(report);
  const totalOrphans = calculateTotalOrphans(telemetry.orphanSnapshot);
  const message = buildSummaryMessage(totalOrphans, telemetry.failureCount);

  return {
    report,
    telemetry,
    summary: {
      message,
      totalOrphans,
      stepsEvaluated: telemetry.steps.length,
  failures: telemetry.failureCount,
      dryRun: telemetry.dryRun,
      snapshot: telemetry.orphanSnapshot,
    },
  };
}

export async function presentCleanupDiagnostics(
  result: CleanupDiagnosticsResult,
  window: Pick<
    typeof vscode.window,
    "showInformationMessage" | "showWarningMessage"
  > = vscode.window,
): Promise<void> {
  const { summary } = result;
  const snapshotDetails = formatSnapshot(summary.snapshot);
  const baseMessage = `${summary.message} Steps inspected: ${summary.stepsEvaluated}. Failures: ${summary.failures}. Snapshot: ${snapshotDetails}.`;

  if (summary.totalOrphans > 0 || summary.failures > 0) {
    await window.showWarningMessage(baseMessage);
    return;
  }

  await window.showInformationMessage(baseMessage);
}

function calculateTotalOrphans(snapshot: OrphanSnapshot): number {
  return Object.values(snapshot).reduce((acc, count) => acc + count, 0);
}

function formatSnapshot(snapshot: OrphanSnapshot): string {
  const nonZero = Object.entries(snapshot).filter(([, value]) => value > 0);
  if (nonZero.length === 0) {
    return "none";
  }
  return nonZero.map(([key, value]) => `${key}: ${value}`).join(", ");
}

function buildSummaryMessage(totalOrphans: number, failures: number): string {
  if (totalOrphans === 0 && failures === 0) {
    return "Cleanup diagnostics completed without orphaned resources.";
  }
  if (totalOrphans > 0 && failures > 0) {
    return `Cleanup diagnostics detected ${pluralize(totalOrphans, "orphaned resource")} with ${pluralize(failures, "failed step")}.`;
  }
  if (totalOrphans > 0) {
    return `Cleanup diagnostics detected ${pluralize(totalOrphans, "orphaned resource")}.`;
  }
  return `Cleanup diagnostics completed with ${pluralize(failures, "failed cleanup step")}.`;
}

function pluralize(value: number, singular: string): string {
  const suffix = value === 1 ? singular : `${singular}s`;
  return `${value} ${suffix}`;
}

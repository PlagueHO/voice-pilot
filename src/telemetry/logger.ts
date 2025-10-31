import * as vscode from "vscode";
import { Logger } from "../core/logger";
import type { DisposalReport } from "../types/disposal";
import {
    createCleanupReportTelemetry,
    type CleanupReportTelemetry,
    type TelemetryEvent,
} from "./events";

export interface RecordCleanupOptions {
  emitStepEvents?: boolean;
}

export class TelemetryLogger {
  private readonly events: TelemetryEvent[] = [];
  private readonly listeners = new Set<(event: TelemetryEvent) => void>();

  constructor(private readonly logger: Logger = new Logger("Agent VoiceTelemetry")) {}

  reset(): void {
    this.events.length = 0;
  }

  getEvents(): readonly TelemetryEvent[] {
    return [...this.events];
  }

  onEvent(listener: (event: TelemetryEvent) => void): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  recordCleanupReport(
    report: DisposalReport,
    options: RecordCleanupOptions = {},
  ): CleanupReportTelemetry {
    const payload = createCleanupReportTelemetry(report);
    this.record({
      name: "agentvoice.cleanup.report",
      properties: payload,
    });

    if (options.emitStepEvents) {
      for (const step of payload.steps) {
        this.record({
          name: "agentvoice.cleanup.step",
          properties: {
            ...step,
            reason: payload.reason,
            auditTrailId: payload.auditTrailId,
          },
        });
      }
    }

    return payload;
  }

  private record(event: TelemetryEvent): void {
    this.events.push(event);
    this.logger.debug(`Telemetry event emitted: ${event.name}`, {
      properties: event.properties,
    });

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("Telemetry listener failed", {
          event: event.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export const telemetryLogger = new TelemetryLogger();

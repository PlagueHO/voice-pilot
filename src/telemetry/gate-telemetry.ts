import { posix as pathPosix } from "path";
import { TextDecoder, TextEncoder } from "util";
import * as vscode from "vscode";

export interface GateTelemetryLogger {
  warn(message: string, data?: unknown): void;
}

export type GateTaskStatus = "pass" | "fail";

export interface GateCoverageSnapshot {
  statements?: number;
  branches?: number;
  functions?: number;
  lines?: number;
}

export interface GateTaskTelemetryRecord {
  task: string;
  status: GateTaskStatus;
  durationMs: number;
  coverage?: GateCoverageSnapshot;
}

export interface GateTelemetryEmitterOptions {
  /**
   * Root folder where the telemetry artefact should be written. Defaults to the first workspace folder
   * or the current working directory when the extension runs detached from a workspace.
   */
  baseUri?: vscode.Uri;
  /**
   * Optional logger instance used to surface diagnostics when persistence fails.
   */
  logger?: GateTelemetryLogger;
  /**
   * Maximum number of records to retain in the report. Older entries are pruned when the limit is exceeded.
   * Defaults to 50 to keep the artefact concise for CI uploads.
   */
  maxEntries?: number;
  /**
   * File system implementation used for persistence. Primarily injected by tests to avoid mutating the real workspace.
   */
  fileSystem?: Pick<
    (typeof vscode.workspace)["fs"],
    "createDirectory" | "writeFile" | "readFile"
  >;
  /**
   * Custom joinPath helper. Defaults to VS Code's implementation or a POSIX-based fallback when unavailable.
   */
  joinPath?: (base: vscode.Uri, ...segments: string[]) => vscode.Uri;
}

const DEFAULT_MAX_ENTRIES = 50;
const TELEMETRY_DIRECTORY_NAME = "telemetry";
const TELEMETRY_FILE_NAME = "gate-report.json";

/**
 * Aggregates task execution outcomes for the quality gate sequence and persists them to a JSON artefact.
 * The emitted structure conforms to the schema defined in `sp-039-spec-process-testing-strategy.md` section 4.
 */
export class GateTelemetryEmitter {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly reportUri: vscode.Uri;
  private readonly directoryUri: vscode.Uri;
  private readonly maxEntries: number;
  private readonly logger?: GateTelemetryLogger;
  private readonly fileSystem: Pick<
    (typeof vscode.workspace)["fs"],
    "createDirectory" | "writeFile" | "readFile"
  >;
  private readonly joinPath: (
    base: vscode.Uri,
    ...segments: string[]
  ) => vscode.Uri;

  constructor(options: GateTelemetryEmitterOptions = {}) {
    this.logger = options.logger;
    this.fileSystem = options.fileSystem ?? vscode.workspace.fs;
    this.joinPath = options.joinPath ?? GateTelemetryEmitter.resolveJoinPath();
    const baseUri =
      options.baseUri ?? GateTelemetryEmitter.resolveDefaultBaseUri();
    this.directoryUri = this.joinPath(baseUri, TELEMETRY_DIRECTORY_NAME);
    this.reportUri = this.joinPath(this.directoryUri, TELEMETRY_FILE_NAME);
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Records a single gate task outcome, merging it into the existing report while enforcing size limits
   * and sanitizing the payload.
   */
  async record(result: GateTaskTelemetryRecord): Promise<void> {
    const sanitized = GateTelemetryEmitter.sanitize(result);
    try {
      await this.ensureDirectory();
      const existing = await this.readExisting();
      existing.push(sanitized);
      const trimmed = existing.slice(-this.maxEntries);
      await this.fileSystem.writeFile(
        this.reportUri,
        this.encoder.encode(JSON.stringify(trimmed, null, 2)),
      );
    } catch (error) {
      this.logger?.warn("Failed to persist gate telemetry", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Retrieves the current gate report contents. Primarily used for tests and diagnostics.
   */
  async read(): Promise<GateTaskTelemetryRecord[]> {
    try {
      const buffer = await this.fileSystem.readFile(this.reportUri);
      const content = this.decoder.decode(buffer);
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map((entry) => GateTelemetryEmitter.sanitize(entry));
    } catch (error) {
      return [];
    }
  }

  private async ensureDirectory(): Promise<void> {
    await this.fileSystem.createDirectory(this.directoryUri);
  }

  private async readExisting(): Promise<GateTaskTelemetryRecord[]> {
    try {
      const buffer = await this.fileSystem.readFile(this.reportUri);
      const content = this.decoder.decode(buffer);
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((entry) => GateTelemetryEmitter.sanitize(entry))
        .filter((entry) => Boolean(entry.task));
    } catch (error) {
      return [];
    }
  }

  private static resolveDefaultBaseUri(): vscode.Uri {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      return workspaceFolder.uri;
    }
    return vscode.Uri.file(process.cwd());
  }

  private static sanitize(
    record: GateTaskTelemetryRecord,
  ): GateTaskTelemetryRecord {
    const coverage = record.coverage
      ? GateTelemetryEmitter.sanitizeCoverage(record.coverage)
      : undefined;
    return {
      task: record.task.trim(),
      status: record.status === "fail" ? "fail" : "pass",
      durationMs: Number.isFinite(record.durationMs)
        ? Math.max(0, Math.round(record.durationMs))
        : 0,
      coverage,
    };
  }

  private static sanitizeCoverage(
    coverage: GateCoverageSnapshot,
  ): GateCoverageSnapshot {
    const normalize = (value?: number) =>
      Number.isFinite(value)
        ? Math.max(0, Math.round(value as number))
        : undefined;
    const sanitized: GateCoverageSnapshot = {};
    if (coverage.statements !== undefined) {
      sanitized.statements = normalize(coverage.statements);
    }
    if (coverage.branches !== undefined) {
      sanitized.branches = normalize(coverage.branches);
    }
    if (coverage.functions !== undefined) {
      sanitized.functions = normalize(coverage.functions);
    }
    if (coverage.lines !== undefined) {
      sanitized.lines = normalize(coverage.lines);
    }
    return sanitized;
  }

  private static resolveJoinPath(): (
    base: vscode.Uri,
    ...segments: string[]
  ) => vscode.Uri {
    const uriWithJoin = vscode.Uri as typeof vscode.Uri & {
      joinPath?: (base: vscode.Uri, ...segments: string[]) => vscode.Uri;
    };
    if (typeof uriWithJoin.joinPath === "function") {
      return (base: vscode.Uri, ...segments: string[]) =>
        uriWithJoin.joinPath!(base, ...segments);
    }

    return (base: vscode.Uri, ...segments: string[]) => {
      const sanitizedSegments = segments.map((segment) =>
        segment.replace(/^\/+/, ""),
      );
      const joined = pathPosix.join(base.path, ...sanitizedSegments);
      return base.with({ path: joined });
    };
  }
}

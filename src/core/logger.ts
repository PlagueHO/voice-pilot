import * as vscode from "vscode";
import {
  GateTaskTelemetryRecord,
  GateTelemetryEmitter,
  GateTelemetryEmitterOptions,
} from "../telemetry/gate-telemetry";

/**
 * Supported log levels ordered from highest severity (`error`) to most verbose (`debug`).
 */
export type LogLevel = "error" | "warn" | "info" | "debug";

/**
 * Structured representation of a single log line emitted by the {@link Logger}.
 */
interface LogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * Thin wrapper around a VS Code {@link vscode.OutputChannel} that provides
 * structured logging, level-based filtering, and JSON serialization of
 * metadata objects.
 *
 * @remarks
 * Logger instances share output channels by name. Most consumers should rely on the
 * default "VoicePilot" channel to keep telemetry and diagnostics consolidated.
 */
export class Logger {
  private static readonly channelRegistry = new Map<
    string,
    { channel: vscode.OutputChannel; refCount: number; isFallback: boolean }
  >();
  private static fallbackChannel: vscode.OutputChannel | undefined;
  private static readonly logObservers = new Set<(entry: LogEvent) => void>();

  private readonly channelName: string;
  private readonly channel: vscode.OutputChannel;
  private readonly levelOrder: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };
  private currentLevel: LogLevel = "info";
  private disposed = false;
  private readonly useConsoleFallback: boolean;

  /**
   * Creates a logger that writes to a shared VS Code output channel.
   *
   * @param name - The output channel name. Loggers with matching names share the same channel instance.
   */
  constructor(name = "VoicePilot") {
    this.channelName = name;
    const registryEntry = Logger.channelRegistry.get(name);
    if (registryEntry) {
      registryEntry.refCount += 1;
      this.channel = registryEntry.channel;
      this.useConsoleFallback = registryEntry.isFallback;
      return;
    }

    const { channel, isFallback } = Logger.createChannel(name);
    Logger.channelRegistry.set(name, {
      channel,
      refCount: 1,
      isFallback,
    });
    this.channel = channel;
    this.useConsoleFallback = isFallback;
  }

  /**
   * Subscribes to structured log events emitted by any {@link Logger} instance.
   * The returned {@link vscode.Disposable} removes the observer when disposed.
   */
  static onDidLog(listener: (entry: LogEvent) => void): vscode.Disposable {
    Logger.logObservers.add(listener);
    return {
      dispose: () => {
        Logger.logObservers.delete(listener);
      },
    };
  }

  /**
   * Updates the minimum log level that will be emitted to the output channel.
   *
   * @param level - The lowest {@link LogLevel} that should be written. Messages below this level are suppressed.
   */
  setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  /**
   * Logs an error level message to the channel.
   *
   * @param message - A human-readable description of the failure.
   * @param data - Optional structured context to serialize alongside the message.
   */
  error(message: string, data?: unknown) {
    this.log("error", message, data);
  }
  /**
   * Logs a warning level message to the channel.
   *
   * @param message - Diagnostic details about the potential issue.
   * @param data - Optional structured context to serialize alongside the message.
   */
  warn(message: string, data?: unknown) {
    this.log("warn", message, data);
  }
  /**
   * Logs an informational message to the channel.
   *
   * @param message - A description of a notable state change or action.
   * @param data - Optional structured context to serialize alongside the message.
   */
  info(message: string, data?: unknown) {
    this.log("info", message, data);
  }
  /**
   * Logs a debug level message to the channel. Only emitted when the
   * current level is `debug`.
   *
   * @param message - Verbose diagnostic details useful during development.
   * @param data - Optional structured context to serialize alongside the message.
   */
  debug(message: string, data?: unknown) {
    this.log("debug", message, data);
  }

  /**
   * Persists a quality gate task outcome and logs the result. Gate reports are stored under the telemetry
   * directory so CI pipelines can publish them as build artefacts.
   *
   * @param result - Telemetry describing a single gate task execution.
   * @param options - Optional emission overrides such as output directory.
   * @remarks
   * The emitter sanitizes payloads before writing to disk. Integration tests can assert on the
   * generated artefacts via the shared telemetry directory.
   * @example
   * ```ts
   * await logger.recordGateTaskOutcome({
   *   task: "npm: Lint Extension",
   *   status: "pass",
   *   durationMs: 3200,
   *   coverage: undefined,
   *   timestamp: new Date().toISOString(),
   * });
   * ```
   */
  async recordGateTaskOutcome(
    result: GateTaskTelemetryRecord,
    options: GateTelemetryEmitterOptions = {},
  ): Promise<void> {
    const emitter = new GateTelemetryEmitter({ ...options, logger: this });
    await emitter.record(result);
    const payload = {
      durationMs: result.durationMs,
      coverage: result.coverage,
    };
    if (result.status === "fail") {
      this.error(`Gate task failed: ${result.task}`, payload);
    } else {
      this.info(`Gate task passed: ${result.task}`, payload);
    }
  }

  /**
   * Performs the severity comparison and writes a structured log entry when
   * the provided level meets the configured threshold.
   */
  private log(level: LogLevel, message: string, data?: unknown) {
    if (this.disposed) {
      return;
    }
    if (this.levelOrder[level] > this.levelOrder[this.currentLevel]) {
      return;
    }
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    const formatted = this.format(event);
    try {
      this.channel.appendLine(formatted);
    } catch (error) {
      console.warn(
        "Logger failed to append to output channel; falling back to console",
        error,
      );
      this.writeToConsole(level, formatted);
      return;
    }
    if (this.useConsoleFallback) {
      this.writeToConsole(level, formatted);
    }
    Logger.emitLogEvent(event);
  }

  /**
   * Formats a {@link LogEvent} into a string, including serialized metadata
   * when available. Fallback messaging is used if serialization fails.
   */
  private format(ev: LogEvent): string {
    const base = `[${ev.timestamp}] [${ev.level.toUpperCase()}] ${ev.message}`;
    if (ev.data !== undefined) {
      try {
        return `${base} :: ${JSON.stringify(ev.data)}`;
      } catch (err) {
        return `${base} [WARN: Failed to serialize data: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }
    return base;
  }

  /**
   * Releases the underlying {@link vscode.OutputChannel}. Call during
   * extension shutdown to avoid resource leaks.
   */
  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const entry = Logger.channelRegistry.get(this.channelName);
    if (!entry) {
      return;
    }
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      Logger.channelRegistry.delete(this.channelName);
      if (!entry.isFallback) {
        try {
          entry.channel.dispose();
        } catch (error) {
          console.warn("Logger failed to dispose output channel", error);
        }
      }
    }
  }

  private static createChannel(name: string): {
    channel: vscode.OutputChannel;
    isFallback: boolean;
  } {
    try {
      return {
        channel: vscode.window.createOutputChannel(name),
        isFallback: false,
      };
    } catch (error) {
      console.warn(
        "Logger failed to create output channel; defaulting to console logging",
        error,
      );
      return { channel: Logger.getFallbackChannel(), isFallback: true };
    }
  }

  private static getFallbackChannel(): vscode.OutputChannel {
    if (!Logger.fallbackChannel) {
      Logger.fallbackChannel = {
        name: "VoicePilotFallbackLogger",
        append() {
          /* noop */
        },
        appendLine() {
          /* noop */
        },
        clear() {
          /* noop */
        },
        replace() {
          /* noop */
        },
        show() {
          /* noop */
        },
        hide() {
          /* noop */
        },
        dispose() {
          /* noop */
        },
      } as vscode.OutputChannel;
    }
    return Logger.fallbackChannel;
  }

  private writeToConsole(level: LogLevel, message: string): void {
    switch (level) {
      case "error":
        console.error(message);
        break;
      case "warn":
        console.warn(message);
        break;
      case "info":
        console.info ? console.info(message) : console.log(message);
        break;
      default:
        console.debug ? console.debug(message) : console.log(message);
        break;
    }
  }

  private static emitLogEvent(event: LogEvent): void {
    if (Logger.logObservers.size === 0) {
      return;
    }
    for (const listener of Array.from(Logger.logObservers)) {
      try {
        listener(event);
      } catch (error) {
        console.warn(
          "Logger observer threw an error and will be ignored",
          error,
        );
      }
    }
  }
}

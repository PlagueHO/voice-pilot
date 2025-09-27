import * as vscode from "vscode";

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
 */
export class Logger {
  private static readonly channelRegistry = new Map<
    string,
    { channel: vscode.OutputChannel; refCount: number; isFallback: boolean }
  >();
  private static fallbackChannel: vscode.OutputChannel | undefined;

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
   * Updates the minimum log level that will be emitted to the output channel.
   * Messages below the configured level are silently ignored.
   */
  setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  /**
   * Logs an error level message to the channel.
   */
  error(message: string, data?: unknown) {
    this.log("error", message, data);
  }
  /**
   * Logs a warning level message to the channel.
   */
  warn(message: string, data?: unknown) {
    this.log("warn", message, data);
  }
  /**
   * Logs an informational message to the channel.
   */
  info(message: string, data?: unknown) {
    this.log("info", message, data);
  }
  /**
   * Logs a debug level message to the channel. Only emitted when the
   * current level is `debug`.
   */
  debug(message: string, data?: unknown) {
    this.log("debug", message, data);
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
          console.warn(
            "Logger failed to dispose output channel",
            error,
          );
        }
      }
    }
  }

  private static createChannel(name: string): {
    channel: vscode.OutputChannel;
    isFallback: boolean;
  } {
    try {
      return { channel: vscode.window.createOutputChannel(name), isFallback: false };
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
}

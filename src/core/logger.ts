import * as vscode from "vscode";

export type LogLevel = "error" | "warn" | "info" | "debug";

interface LogEvent {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

export class Logger {
  private channel: vscode.OutputChannel;
  private levelOrder: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };
  private currentLevel: LogLevel = "info";

  constructor(name = "VoicePilot") {
    this.channel = vscode.window.createOutputChannel(name);
  }

  setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  error(message: string, data?: unknown) {
    this.log("error", message, data);
  }
  warn(message: string, data?: unknown) {
    this.log("warn", message, data);
  }
  info(message: string, data?: unknown) {
    this.log("info", message, data);
  }
  debug(message: string, data?: unknown) {
    this.log("debug", message, data);
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (this.levelOrder[level] > this.levelOrder[this.currentLevel]) {
      return;
    }
    const event: LogEvent = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    this.channel.appendLine(this.format(event));
  }

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

  dispose() {
    this.channel.dispose();
  }
}

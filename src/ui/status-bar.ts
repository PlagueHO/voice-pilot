import * as vscode from "vscode";
import type { VoicePilotError } from "../types/error/voice-pilot-error";

export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly defaultLabel = "VoicePilot";

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.showReady();
    this.item.show();
  }

  showReady(message = "Ready"): void {
    this.item.text = `$(mic) ${this.defaultLabel}: ${message}`;
    this.item.tooltip = "VoicePilot voice assistant";
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
    this.item.command = undefined;
  }

  showInfo(message: string, tooltip?: string): void {
    this.item.text = `$(comment-discussion) ${this.defaultLabel}: ${message}`;
    this.item.tooltip = tooltip ?? "VoicePilot status";
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
    this.item.command = undefined;
  }

  showError(error: VoicePilotError): void {
    this.item.text = `$(error) ${this.defaultLabel} issue`;
    this.item.tooltip = [error.message, error.remediation]
      .filter(Boolean)
      .join("\n");
    this.item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
    this.item.color = new vscode.ThemeColor(
      "statusBarItem.prominentForeground",
    );
    this.item.command = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

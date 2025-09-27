import * as vscode from "vscode";
import type { VoicePilotError } from "../types/error/voice-pilot-error";

/**
 * Manages the VoicePilot status bar item and renders state transitions for the extension lifecycle.
 *
 * @remarks
 * The status bar item surfaces readiness, informational, and error states for the voice session.
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly defaultLabel = "VoicePilot";

  /**
   * Creates the VS Code status bar item and initializes it in the ready state.
   */
  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.showReady();
    this.item.show();
  }

  /**
   * Displays the ready state, indicating that VoicePilot is idle and prepared to start a session.
   *
   * @param message - Optional message appended to the ready label. Defaults to "Ready".
   */
  showReady(message = "Ready"): void {
    this.item.text = `$(mic) ${this.defaultLabel}: ${message}`;
    this.item.tooltip = "VoicePilot voice assistant";
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
    this.item.command = undefined;
  }

  /**
   * Displays an informational state in the status bar.
   *
   * @param message - Text to display alongside the VoicePilot label.
   * @param tooltip - Optional tooltip content to provide additional context.
   */
  showInfo(message: string, tooltip?: string): void {
    this.item.text = `$(comment-discussion) ${this.defaultLabel}: ${message}`;
    this.item.tooltip = tooltip ?? "VoicePilot status";
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
    this.item.command = undefined;
  }

  /**
   * Displays an error state with structured remediation details.
   *
   * @param error - The error raised by VoicePilot, including remediation guidance for the tooltip.
   */
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

  /**
   * Disposes of the underlying status bar item.
   */
  dispose(): void {
    this.item.dispose();
  }
}

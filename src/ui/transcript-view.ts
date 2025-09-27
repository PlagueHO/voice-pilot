import * as vscode from "vscode";

/**
 * Renders a live transcript webview beside the active editor and
 * exposes methods for appending conversational messages.
 */
export class TranscriptView {
  private panel: vscode.WebviewPanel | undefined;
  private messages: string[] = [];

  /**
   * Creates the transcript view and initializes the backing webview panel.
   */
  constructor() {
    this.createPanel();
  }

  private createPanel() {
    this.panel = vscode.window.createWebviewPanel(
      "transcriptView",
      "Transcript",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
      },
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /**
   * Appends a new message to the transcript and refreshes the webview markup.
   *
   * @param newMessage - The message text to display in the transcript view.
   */
  public updateTranscript(newMessage: string) {
    this.messages.push(newMessage);
    if (this.panel) {
      this.panel.webview.html = this.getWebviewContent();
    }
  }

  private getWebviewContent(): string {
    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Transcript</title>
                <style>
                    body { font-family: Arial, sans-serif; padding: 10px; }
                    .message { margin-bottom: 10px; }
                </style>
            </head>
            <body>
                <h1>Transcript</h1>
                <div id="transcript">
                    ${this.messages.map((msg) => `<div class="message">${msg}</div>`).join("")}
                </div>
            </body>
            </html>
        `;
  }
}

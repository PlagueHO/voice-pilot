import * as vscode from "vscode";

export class TranscriptView {
  private panel: vscode.WebviewPanel | undefined;
  private messages: string[] = [];

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

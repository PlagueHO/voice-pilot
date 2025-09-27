import * as vscode from "vscode";

/**
 * Manages the VoicePilot chat webview so messages stay in sync with the extension.
 * @remarks
 *  Provides a singleton-style webview panel that can be revealed or created on
 *  demand, and exposes helpers for appending new chat messages from the
 *  extension host.
 */
export class ChatPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;

  /**
   * Creates an instance bound to the extension root for resource loading.
   * @param extensionUri - Root URI used to scope webview local resources.
   */
  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Reveals the chat panel if it exists, otherwise creates a new webview panel.
   */
  public createOrShow() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        "voicePilotChat",
        "VoicePilot Chat",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
        /**
         * Appends a message to the chat webview if the panel is active.
         * @param message - The text content to append in the webview transcript.
         */
      );

      this.panel.webview.html = this.getWebviewContent();

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
  }

  private getWebviewContent() {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>VoicePilot Chat</title>
            <style>
                body { font-family: Arial, sans-serif; }
                #messages { height: 400px; overflow-y: scroll; border: 1px solid #ccc; padding: 10px; }
                #input { width: 100%; }
            </style>
        </head>
        <body>
            <div id="messages"></div>
            <input type="text" id="input" placeholder="Type a message..." />
            <script>
                const input = document.getElementById('input');
                input.addEventListener('keypress', function (event) {
                    if (event.key === 'Enter') {
                        const message = input.value;
                        input.value = '';
                        // Send message to the extension
                        vscode.postMessage({ command: 'sendMessage', text: message });
                    }
                });
            </script>
        </body>
        </html>`;
  }

  public appendMessage(message: string) {
    if (this.panel) {
      this.panel.webview.postMessage({
        command: "appendMessage",
        text: message,
      });
    }
  }
}

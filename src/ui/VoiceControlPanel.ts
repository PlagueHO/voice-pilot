import * as vscode from 'vscode';
import { ServiceInitializable } from '../core/ServiceInitializable';

export class VoiceControlPanel implements ServiceInitializable {
  private initialized = false;
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    // TODO: Preload resources or state
    this.initialized = true;
  }

  isInitialized(): boolean { return this.initialized; }

  dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }
  }

  async show(): Promise<void> {
    if (!this.initialized) {
      throw new Error('VoiceControlPanel not initialized');
    }
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'voicepilotConversation',
        'VoicePilot Conversation',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.html = this.render();
    } else {
      this.panel.reveal(vscode.ViewColumn.One);
    }
  }

  private render(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none';" />
<title>VoicePilot</title>
</head>
<body>
  <h2>VoicePilot</h2>
  <p>Conversation panel placeholder.</p>
</body>
</html>`;
  }

  isVisible(): boolean {
    return !!this.panel;
  }
}

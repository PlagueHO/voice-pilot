import * as vscode from 'vscode';
import { AzureSpeechConfig } from '../../types/configuration';

export class AzureSpeechSection {
  read(): AzureSpeechConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.azureSpeech');
    return {
      region: c.get('region', 'eastus'),
      voice: c.get('voice', 'en-US-JennyNeural')
    };
  }
}

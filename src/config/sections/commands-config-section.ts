import * as vscode from 'vscode';
import { CommandsConfig } from '../../types/configuration';

export class CommandsSection {
  read(): CommandsConfig {
    const c = vscode.workspace.getConfiguration('agentvoice.commands');
    return {
      wakeWord: c.get('wakeWord', 'agentvoice'),
      sensitivity: c.get('sensitivity', 0.7),
      timeout: c.get('timeout', 30)
    };
  }
}

import * as vscode from 'vscode';
import { GitHubConfig } from '../../types/configuration';

export class GitHubSection {
  read(): GitHubConfig {
    const c = vscode.workspace.getConfiguration('agentvoice.github');
    return {
      repository: c.get('repository', ''),
      authMode: c.get('authMode', 'auto') as GitHubConfig['authMode']
    };
  }
}

import * as vscode from 'vscode';
import { AzureOpenAIConfig } from '../../types/configuration';

export class AzureOpenAISection {
  read(): AzureOpenAIConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.azureOpenAI');
    return {
      endpoint: c.get('endpoint', ''),
      deploymentName: c.get('deploymentName', 'gpt-4o-realtime-preview'),
      region: c.get('region', 'eastus2') as AzureOpenAIConfig['region'],
      apiVersion: c.get('apiVersion', '2025-04-01-preview')
    };
  }
}

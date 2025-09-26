import * as vscode from 'vscode';
import { ConversationConfig } from '../../types/configuration';

const DEFAULT_POLICY: ConversationConfig = {
  policyProfile: 'default',
  interruptionBudgetMs: 250,
  completionGraceMs: 150,
  speechStopDebounceMs: 200,
  allowBargeIn: true,
  fallbackMode: 'hybrid'
};

export class ConversationSection {
  read(): ConversationConfig {
    const config = vscode.workspace.getConfiguration('voicepilot.conversation');
    return {
      policyProfile: config.get('policyProfile', DEFAULT_POLICY.policyProfile) as ConversationConfig['policyProfile'],
      interruptionBudgetMs: config.get('interruptionBudgetMs', DEFAULT_POLICY.interruptionBudgetMs),
      completionGraceMs: config.get('completionGraceMs', DEFAULT_POLICY.completionGraceMs),
      speechStopDebounceMs: config.get('speechStopDebounceMs', DEFAULT_POLICY.speechStopDebounceMs),
      allowBargeIn: config.get('allowBargeIn', DEFAULT_POLICY.allowBargeIn),
      fallbackMode: config.get('fallbackMode', DEFAULT_POLICY.fallbackMode) as ConversationConfig['fallbackMode']
    };
  }
}

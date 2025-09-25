import * as vscode from 'vscode';
import { AzureRealtimeConfig } from '../../types/configuration';

export class AzureOpenAIRealtimeSection {
  read(): AzureRealtimeConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.azureRealtime');
    return {
      model: c.get('model', 'gpt-realtime'),
      apiVersion: c.get('apiVersion', '2025-08-28'),
      transcriptionModel: c.get('transcriptionModel', 'whisper-1'),
      inputAudioFormat: c.get('inputAudioFormat', 'pcm16') as AzureRealtimeConfig['inputAudioFormat'],
      locale: c.get('locale', 'en-US'),
      profanityFilter: c.get('profanityFilter', 'medium') as AzureRealtimeConfig['profanityFilter'],
      interimDebounceMs: c.get('interimDebounceMs', 250),
      maxTranscriptHistorySeconds: c.get('maxTranscriptHistorySeconds', 120)
    };
  }
}

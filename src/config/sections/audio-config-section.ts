import * as vscode from 'vscode';
import { AudioConfig } from '../../types/configuration';

export class AudioSection {
  read(): AudioConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.audio');
    return {
      inputDevice: c.get('inputDevice', 'default'),
      outputDevice: c.get('outputDevice', 'default'),
      noiseReduction: c.get('noiseReduction', true),
      echoCancellation: c.get('echoCancellation', true),
      sampleRate: c.get('sampleRate', 24000) as AudioConfig['sampleRate']
    };
  }
}

import * as vscode from 'vscode';
import { createDefaultTurnDetectionConfig } from '../../audio/turn-detection-defaults';
import { AudioConfig, TurnDetectionConfig, TurnDetectionMode } from '../../types/configuration';

export class AudioSection {
  read(): AudioConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.audio');
    const defaultTurnDetection: TurnDetectionConfig = createDefaultTurnDetectionConfig();
    const resolveMode = (c.get<string>('turnDetection.mode', defaultTurnDetection.mode) ?? defaultTurnDetection.mode) as TurnDetectionMode;
    return {
      inputDevice: c.get('inputDevice', 'default'),
      outputDevice: c.get('outputDevice', 'default'),
      noiseReduction: c.get('noiseReduction', true),
      echoCancellation: c.get('echoCancellation', true),
      sampleRate: c.get('sampleRate', 24000) as AudioConfig['sampleRate'],
      turnDetection: {
        mode: resolveMode,
        threshold: c.get('turnDetection.threshold', defaultTurnDetection.threshold),
        prefixPaddingMs: c.get('turnDetection.prefixPaddingMs', defaultTurnDetection.prefixPaddingMs),
        silenceDurationMs: c.get('turnDetection.silenceDurationMs', defaultTurnDetection.silenceDurationMs),
        createResponse: c.get('turnDetection.createResponse', defaultTurnDetection.createResponse),
        interruptResponse: c.get('turnDetection.interruptResponse', defaultTurnDetection.interruptResponse),
        eagerness: c.get('turnDetection.eagerness', defaultTurnDetection.eagerness) as TurnDetectionConfig['eagerness']
      }
    };
  }
}

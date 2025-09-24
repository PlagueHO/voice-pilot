import { TurnDetectionConfig } from '../types/configuration';

export const DEFAULT_TURN_DETECTION_CONFIG: Readonly<TurnDetectionConfig> = Object.freeze({
  mode: 'server_vad',
  threshold: 0.5,
  prefixPaddingMs: 300,
  silenceDurationMs: 200,
  createResponse: true,
  interruptResponse: true,
  eagerness: 'auto'
});

export function createDefaultTurnDetectionConfig(): TurnDetectionConfig {
  return { ...DEFAULT_TURN_DETECTION_CONFIG };
}

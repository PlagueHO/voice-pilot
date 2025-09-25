import { TurnDetectionConfig } from '../types/configuration';

export const DEFAULT_TURN_DETECTION_CONFIG: Readonly<TurnDetectionConfig> = Object.freeze({
  type: 'server_vad',
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

export function normalizeTurnDetectionConfig(config?: Partial<TurnDetectionConfig>): TurnDetectionConfig {
  const defaults = createDefaultTurnDetectionConfig();
  if (!config) {
    return defaults;
  }

  const normalized: TurnDetectionConfig = {
    ...defaults,
    ...config,
    type: config.type ?? defaults.type
  };

  if (normalized.type === 'none') {
    normalized.createResponse = config.createResponse ?? false;
    normalized.interruptResponse = config.interruptResponse ?? false;
  }

  if (normalized.type !== 'semantic_vad') {
    normalized.eagerness = 'auto';
  } else {
    normalized.eagerness = config.eagerness ?? defaults.eagerness;
  }

  if (typeof normalized.threshold === 'number') {
    normalized.threshold = Math.max(0, Math.min(1, normalized.threshold));
  }

  if (typeof normalized.prefixPaddingMs === 'number') {
    normalized.prefixPaddingMs = Math.max(0, Math.round(normalized.prefixPaddingMs));
  }

  if (typeof normalized.silenceDurationMs === 'number') {
    normalized.silenceDurationMs = Math.max(0, Math.round(normalized.silenceDurationMs));
  }

  return normalized;
}

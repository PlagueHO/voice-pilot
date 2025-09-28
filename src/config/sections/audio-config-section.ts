import * as vscode from 'vscode';
import { createDefaultTurnDetectionConfig } from '../../audio/turn-detection-defaults';
import { AudioConfig, TtsConfig, TurnDetectionConfig } from '../../types/configuration';

const DEFAULT_TTS_VOICE: TtsConfig['voice'] = {
  name: 'alloy',
  locale: 'en-US',
  style: 'conversational' as const,
  gender: 'unspecified' as const
};

export class AudioSection {
  read(): AudioConfig {
    const c = vscode.workspace.getConfiguration('voicepilot.audio');
    const defaultTurnDetection: TurnDetectionConfig = createDefaultTurnDetectionConfig();
    const configuredType = c.get<string>('turnDetection.type');
    const legacyMode = c.get<string>('turnDetection.mode');
    const resolvedTypeRaw = configuredType ?? legacyMode ?? defaultTurnDetection.type;
    const resolvedType = (resolvedTypeRaw === 'manual' ? 'none' : resolvedTypeRaw) as TurnDetectionConfig['type'];
    const latencyHint = c.get<string | number>('context.latencyHint', 'interactive');
    const sharedContext = {
      autoResume: c.get('context.autoResume', true),
      requireGesture: c.get('context.requireGesture', true),
      latencyHint: latencyHint as AudioContextLatencyCategory | number
    };
    const workletModules = c.get<string[]>('workletModuleUrls', []);
    return {
      inputDevice: c.get('inputDevice', 'default'),
      outputDevice: c.get('outputDevice', 'default'),
      noiseReduction: c.get('noiseReduction', true),
      echoCancellation: c.get('echoCancellation', true),
      sampleRate: c.get('sampleRate', 24000) as AudioConfig['sampleRate'],
      sharedContext,
      workletModules,
      turnDetection: {
        type: resolvedType,
        threshold: c.get('turnDetection.threshold', defaultTurnDetection.threshold),
        prefixPaddingMs: c.get('turnDetection.prefixPaddingMs', defaultTurnDetection.prefixPaddingMs),
        silenceDurationMs: c.get('turnDetection.silenceDurationMs', defaultTurnDetection.silenceDurationMs),
        createResponse: c.get('turnDetection.createResponse', defaultTurnDetection.createResponse),
        interruptResponse: c.get('turnDetection.interruptResponse', defaultTurnDetection.interruptResponse),
        eagerness: c.get('turnDetection.eagerness', defaultTurnDetection.eagerness) as TurnDetectionConfig['eagerness']
      },
      tts: this.readTtsConfig(c)
    };
  }

  private readTtsConfig(configuration: vscode.WorkspaceConfiguration): TtsConfig {
    const voiceRaw = configuration.get('tts.voiceProfile') as Partial<TtsConfig['voice']> | undefined;
    const transport = configuration.get('tts.transport', 'webrtc') as TtsConfig['transport'];
    const fallbackMode = configuration.get('tts.fallbackMode', 'retry') as TtsConfig['fallbackMode'];
    const apiVersion = configuration.get('tts.apiVersion', '2025-04-01-preview');
    const maxInitialLatencyMs = configuration.get('tts.maxInitialLatencyMs', 300);
    const voice: TtsConfig['voice'] = {
      name: voiceRaw?.name ?? DEFAULT_TTS_VOICE.name,
      locale: voiceRaw?.locale ?? DEFAULT_TTS_VOICE.locale,
      style: voiceRaw?.style ?? DEFAULT_TTS_VOICE.style,
      gender: voiceRaw?.gender ?? DEFAULT_TTS_VOICE.gender,
      providerVoiceId: voiceRaw?.providerVoiceId,
      description: voiceRaw?.description
    };

    return {
      transport,
      apiVersion,
      fallbackMode,
      maxInitialLatencyMs,
      voice
    };
  }
}

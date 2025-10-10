import { EphemeralKeyServiceImpl } from '../../auth/ephemeral-key-service';
import { resolveRealtimeSessionPreferences } from '../../config/realtime-session';
import { Logger } from '../../core/logger';
import {
  AudioConfig,
  AzureOpenAIConfig,
  AzureRealtimeConfig,
} from '../../types/configuration';
import { expect } from "../helpers/chai-setup";
import { afterEach, suite, test } from '../mocha-globals';

// Minimal mock credential manager implementing only required surface
class MockCredMgr {
  private key?: string;
  constructor(key?: string) { this.key = key; }
  isInitialized() { return true; }
  async getAzureOpenAIKey() { return this.key; }
}

class MockConfigMgr {
  private readonly cfg: AzureOpenAIConfig;
  private readonly realtime: AzureRealtimeConfig;
  private readonly audio: AudioConfig;

  constructor(
    cfg: AzureOpenAIConfig,
    realtime: AzureRealtimeConfig,
    audio: AudioConfig,
  ) {
    this.cfg = cfg;
    this.realtime = realtime;
    this.audio = audio;
  }
  isInitialized() { return true; }
  getAzureOpenAIConfig() { return this.cfg; }
  getAzureRealtimeConfig() { return this.realtime; }
  getAudioConfig() { return this.audio; }
  getRealtimeSessionPreferences() {
    return resolveRealtimeSessionPreferences(this.realtime, this.audio);
  }
}

function okSessionResponse() {
  return {
    id: 'sess-1',
    model: 'gpt-4o-realtime-preview',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    client_secret: { value: 'ephemeral-key-xyz', expires_at: Math.floor(Date.now() / 1000) + 60 }
  };
}

const baseConfig: AzureOpenAIConfig = {
  endpoint: 'https://unit.openai.azure.com',
  deploymentName: 'gpt-4o-realtime-preview',
  region: 'eastus2',
  apiVersion: '2025-04-01-preview'
};

const baseRealtimeConfig: AzureRealtimeConfig = {
  model: 'gpt-4o-realtime-preview',
  apiVersion: '2025-08-28',
  transcriptionModel: 'whisper-large-v3',
  inputAudioFormat: 'pcm16',
  locale: 'en-US',
  profanityFilter: 'medium',
  interimDebounceMs: 150,
  maxTranscriptHistorySeconds: 120,
};

const baseAudioConfig: AudioConfig = {
  inputDevice: 'default',
  outputDevice: 'default',
  noiseReduction: true,
  echoCancellation: true,
  sampleRate: 16000,
  sharedContext: {
    autoResume: true,
    requireGesture: false,
    latencyHint: 'interactive',
  },
  workletModules: [],
  turnDetection: {
    type: 'semantic_vad',
    threshold: 0.5,
    prefixPaddingMs: 120,
    silenceDurationMs: 350,
    createResponse: true,
    interruptResponse: true,
    eagerness: 'auto',
  },
  tts: {
    transport: 'webrtc',
    apiVersion: '2025-08-28',
    fallbackMode: 'retry',
    maxInitialLatencyMs: 750,
    voice: {
      name: 'en-US-AriaNeural',
      locale: 'en-US',
    },
  },
};

suite('Unit: EphemeralKeyServiceImpl', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  test('initializes successfully with valid key and session creation', async () => {
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
    const svc = new EphemeralKeyServiceImpl(
      new MockCredMgr('abc123') as any,
      new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig) as any,
      new Logger('Test'),
    );
    await svc.initialize();
    expect(svc.isInitialized()).to.equal(true);
  });

  test('fails initialization when authentication test cannot create session', async () => {
    (global as any).fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized' }}) });
    const svc = new EphemeralKeyServiceImpl(
      new MockCredMgr('bad') as any,
      new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig) as any,
      new Logger('Test'),
    );
    await expect(svc.initialize()).to.be.rejectedWith(/Authentication test failed/i);
  });

  test('requestEphemeralKey returns error when missing key', async () => {
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
    const svc = new EphemeralKeyServiceImpl(
      new MockCredMgr(undefined) as any,
      new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig) as any,
      new Logger('Test'),
    );
    // Manually set initialized to bypass initialize path for this focused unit check
    (svc as any).initialized = true;
    const result = await svc.requestEphemeralKey();
    expect(result.success).to.equal(false);
    expect(result.error?.code).to.equal('MISSING_CREDENTIALS');
  });

  test('maps 429 to RATE_LIMITED', async () => {
    (global as any).fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Too many' }}) });
    const svc = new EphemeralKeyServiceImpl(
      new MockCredMgr('key') as any,
      new MockConfigMgr(baseConfig, baseRealtimeConfig, baseAudioConfig) as any,
      new Logger('Test'),
    );
    (svc as any).initialized = true;
    const result = await svc.requestEphemeralKey();
    expect(result.success).to.equal(false);
    expect(result.error?.code).to.equal('RATE_LIMITED');
  });
});

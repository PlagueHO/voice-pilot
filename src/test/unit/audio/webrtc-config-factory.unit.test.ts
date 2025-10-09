import * as assert from "assert";
import { WebRTCConfigFactory } from "../../../audio/webrtc-config-factory";
import type { ConfigurationManager } from "../../../config/configuration-manager";
import { resolveRealtimeSessionPreferences } from "../../../config/realtime-session";
import type { Logger } from "../../../core/logger";
import type {
  AudioConfig,
  AzureOpenAIConfig,
  AzureRealtimeConfig,
} from "../../../types/configuration";
import type { RealtimeSessionInfo } from "../../../types/ephemeral";
import {
  WebRTCErrorCode,
  WebRTCErrorImpl,
  type WebRTCConfig,
} from "../../../types/webrtc";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  data?: unknown;
}

function createTestLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = {
    debug: (message: string, data?: unknown) => {
      entries.push({ level: "debug", message, data });
    },
    info: (message: string, data?: unknown) => {
      entries.push({ level: "info", message, data });
    },
    warn: (message: string, data?: unknown) => {
      entries.push({ level: "warn", message, data });
    },
    error: (message: string, data?: unknown) => {
      entries.push({ level: "error", message, data });
    },
    setLevel: () => {
      /* noop */
    },
    dispose: () => {
      /* noop */
    },
    recordGateTaskOutcome: async () => {
      /* noop */
    },
  } as unknown as Logger;

  return { logger, entries };
}

function createRealtimeSession(
  overrides: Partial<RealtimeSessionInfo> = {},
): RealtimeSessionInfo {
  const now = Date.now();
  const expiresAt = new Date(now + 60000);
  const refreshAt = new Date(now + 30000);

  return {
    sessionId: "test-session",
    ephemeralKey: "ephemeral-key",
    webrtcUrl: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
    websocketUrl: "wss://eastus2.realtimeapi-preview.ai.azure.com",
    expiresAt,
    issuedAt: new Date(now - 1000),
    refreshAt,
    refreshIntervalMs: 45000,
    keyInfo: {
      key: "ephemeral-key",
      sessionId: "test-session",
      issuedAt: new Date(now - 1000),
      expiresAt,
      isValid: true,
      secondsRemaining: Math.floor((expiresAt.getTime() - now) / 1000),
      refreshAt,
      secondsUntilRefresh: Math.floor((refreshAt.getTime() - now) / 1000),
      ttlSeconds: 60,
      refreshIntervalSeconds: 45,
    },
    ...overrides,
  };
}

function createAzureConfig(
  overrides: Partial<AzureOpenAIConfig> & { region?: string } = {},
): AzureOpenAIConfig {
  return {
    endpoint: "https://example.openai.azure.com",
    deploymentName: "gpt-4o-realtime-preview",
    region: "eastus2",
    apiVersion: "2025-04-01-preview",
    ...overrides,
  } as unknown as AzureOpenAIConfig;
}

function createAudioConfig(
  overrides: Partial<AudioConfig> = {},
): AudioConfig {
  return {
    inputDevice: "default",
    outputDevice: "default",
    noiseReduction: true,
    echoCancellation: true,
    sampleRate: 24000,
    sharedContext: {
      autoResume: true,
      requireGesture: true,
      latencyHint: "interactive",
    },
    workletModules: [
      "resource://voicepilot/processors/vad-processor.js",
      "resource://voicepilot/processors/gain-processor.js",
    ],
    turnDetection: {
      type: "server_vad",
      threshold: 0.4,
      prefixPaddingMs: 250,
      silenceDurationMs: 200,
      createResponse: true,
      interruptResponse: true,
      eagerness: "auto",
    },
    tts: {
      transport: "webrtc",
      apiVersion: "2025-04-01-preview",
      fallbackMode: "retry",
      maxInitialLatencyMs: 400,
      voice: {
        name: "alloy",
        locale: "en-US",
        style: "conversational",
        gender: "unspecified",
      },
    },
    ...overrides,
  } as AudioConfig;
}

function createRealtimeConfig(
  overrides: Partial<AzureRealtimeConfig> = {},
): AzureRealtimeConfig {
  return {
    model: "gpt-realtime",
    apiVersion: "2025-08-28",
    transcriptionModel: "whisper-1",
    inputAudioFormat: "pcm16",
    locale: "en-US",
    profanityFilter: "medium",
    interimDebounceMs: 250,
    maxTranscriptHistorySeconds: 120,
    ...overrides,
  } as AzureRealtimeConfig;
}

interface ConfigManagerStubOptions {
  azure?: Partial<AzureOpenAIConfig> & { region?: string };
  audio?: Partial<AudioConfig>;
  realtime?: Partial<AzureRealtimeConfig>;
  sessionPreferencesOverride?: Partial<ReturnType<typeof resolveRealtimeSessionPreferences>>;
}

function createConfigManagerStub({
  azure: azureOverrides,
  audio: audioOverrides,
  realtime: realtimeOverrides,
  sessionPreferencesOverride,
}: ConfigManagerStubOptions = {}): {
  manager: ConfigurationManager;
  audio: AudioConfig;
  azure: AzureOpenAIConfig;
  realtime: AzureRealtimeConfig;
} {
  const audio = createAudioConfig(audioOverrides);
  const realtime = createRealtimeConfig(realtimeOverrides);
  const azure = createAzureConfig(azureOverrides);
  const baseSession = resolveRealtimeSessionPreferences(realtime, audio);
  const session = {
    ...baseSession,
    ...sessionPreferencesOverride,
  };

  const manager = {
    getAzureOpenAIConfig: () => azure,
    getAzureRealtimeConfig: () => realtime,
    getAudioConfig: () => audio,
    getRealtimeSessionPreferences: () => session,
  } as unknown as ConfigurationManager;

  return { manager, audio, azure, realtime };
}

class EphemeralKeyServiceStub {
  constructor(private session: RealtimeSessionInfo) {}

  setSession(session: RealtimeSessionInfo): void {
    this.session = session;
  }

  async createRealtimeSession(): Promise<RealtimeSessionInfo> {
    if (this.session instanceof Error) {
      throw this.session;
    }
    return this.session;
  }
}

describe("WebRTCConfigFactory", () => {
  it("creates a configuration bundle with normalized fields", async () => {
    const { logger, entries } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      audio: {
        workletModules: [
          "resource://voicepilot/processors/vad-processor.js",
          "resource://voicepilot/processors/vad-processor.js",
          "resource://voicepilot/processors/gain-processor.js",
        ],
      },
    });

    const session = createRealtimeSession();
    const keyService = new EphemeralKeyServiceStub(session);

    const config = await factory.createConfig(manager, keyService as any);

    assert.strictEqual(config.endpoint.region, "eastus2");
    assert.strictEqual(
      config.endpoint.url,
      "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
    );
    assert.strictEqual(config.authentication.ephemeralKey, session.ephemeralKey);
    assert.strictEqual(config.audioConfig.sampleRate, 24000);
    assert.strictEqual(config.audioConfig.codecProfileId, "pcm16-24k-mono");
    assert.deepStrictEqual(config.audioConfig.workletModuleUrls, [
      "resource://voicepilot/processors/vad-processor.js",
      "resource://voicepilot/processors/gain-processor.js",
    ]);
    assert.ok(
      Object.isFrozen(config.audioConfig.workletModuleUrls),
      "worklet modules should be frozen to prevent mutation",
    );
    assert.strictEqual(config.sessionConfig.voice, "alloy");
    assert.ok(config.sessionConfig.turnDetection);
    assert.strictEqual(config.dataChannelConfig?.channelName, "realtime-channel");
    assert.strictEqual(config.connectionConfig?.reconnectAttempts, 3);

    const debugEntry = entries.find((entry) => entry.level === "debug");
    assert.ok(debugEntry, "should emit a debug log when config is created");
  });

  it("maps known Azure regions to supported WebRTC regions", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      azure: {
        region: "eastus",
      } as Partial<AzureOpenAIConfig> & { region: string },
    });

    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const config = await factory.createConfig(manager, keyService as any);

    assert.strictEqual(config.endpoint.region, "eastus2");
    assert.strictEqual(
      config.endpoint.url,
      "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
    );
  });

  it("rejects creation when the region is unsupported", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      azure: {
        region: "antarctica" as unknown as "eastus2",
      },
    });
    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());

    await assert.rejects(
      factory.createConfig(manager, keyService as any),
      (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.ConfigurationInvalid);
        assert.match(error.message, /Unsupported region/i);
        return true;
      },
    );
  });

  it("fails fast when session expiry window is unsafe", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub();

    const imminentExpiry = new Date(Date.now() + 5000);
    const keyService = new EphemeralKeyServiceStub(
      createRealtimeSession({
        expiresAt: imminentExpiry,
        keyInfo: {
          ...createRealtimeSession().keyInfo,
          expiresAt: imminentExpiry,
          secondsRemaining: 5,
        },
      }),
    );

    await assert.rejects(
      factory.createConfig(manager, keyService as any),
      (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.AuthenticationFailed);
        assert.match(error.message, /expires too soon/i);
        return true;
      },
    );
  });

  it("warns when requested sample rate is adjusted for compliance", async () => {
    const { logger, entries } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      audio: {
        sampleRate: 16000,
      },
    });

    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const config = await factory.createConfig(manager, keyService as any);

    assert.strictEqual(config.audioConfig.sampleRate, 24000);
    const warning = entries.find((entry) => entry.level === "warn");
    assert.ok(warning, "expected warning when sample rate is adjusted");
    assert.match(warning.message, /Audio sample rate adjusted/i);
  });

  it("refreshes authentication material via updateConfigWithNewKey", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const originalSession = createRealtimeSession();
    const keyService = new EphemeralKeyServiceStub(originalSession);
    const { manager } = createConfigManagerStub();
    const baseConfig = await factory.createConfig(manager, keyService as any);

    const refreshedSession = createRealtimeSession({
      sessionId: "refreshed",
      ephemeralKey: "refreshed-key",
      keyInfo: {
        ...originalSession.keyInfo,
        key: "refreshed-key",
        sessionId: "refreshed",
        secondsRemaining: 55,
      },
    });
    keyService.setSession(refreshedSession);

    const updated = await factory.updateConfigWithNewKey(
      baseConfig,
      keyService as any,
    );

    assert.notStrictEqual(updated, baseConfig);
    assert.strictEqual(updated.authentication.ephemeralKey, "refreshed-key");
    assert.strictEqual(baseConfig.authentication.ephemeralKey, "ephemeral-key");
  });

  it("surfaces structured errors when key refresh fails", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const { manager } = createConfigManagerStub();
    const baseConfig = await factory.createConfig(manager, keyService as any);

    keyService.setSession(new Error("network unavailable") as unknown as RealtimeSessionInfo);

    await assert.rejects(
      factory.updateConfigWithNewKey(baseConfig, keyService as any),
      (error: unknown) => {
        assert.ok(error instanceof WebRTCErrorImpl);
        assert.strictEqual(error.code, WebRTCErrorCode.AuthenticationFailed);
        assert.match(error.message, /Key update failed/i);
        return true;
      },
    );
  });

  it("validates configurations and logs failures", () => {
    const { logger, entries } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const config = factory.createTestConfig();

    assert.strictEqual(factory.validateConfig(config), true);

    const expiredConfig: WebRTCConfig = {
      ...config,
      authentication: {
        ...config.authentication,
        expiresAt: new Date(Date.now() - 1000),
      },
    };

    assert.strictEqual(factory.validateConfig(expiredConfig), false);
    const errorEntry = entries.find((entry) => entry.level === "error");
    assert.ok(errorEntry, "validation failure should emit error log");
    assert.match(errorEntry.message, /validation failed/i);
  });
});

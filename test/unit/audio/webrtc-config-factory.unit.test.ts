import { WebRTCConfigFactory } from "../../../src/audio/webrtc-config-factory";
import type { ConfigurationManager } from "../../../src/config/configuration-manager";
import { resolveRealtimeSessionPreferences } from "../../../src/config/realtime-session";
import type { Logger } from "../../../src/core/logger";
import type {
  AudioConfig,
  AzureOpenAIConfig,
  AzureRealtimeConfig,
} from "../../../src/types/configuration";
import type { RealtimeSessionInfo } from "../../../src/types/ephemeral";
import {
  WebRTCErrorCode,
  WebRTCErrorImpl,
  type WebRTCConfig,
} from "../../../src/types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

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
  private session: RealtimeSessionInfo;

  constructor(session: RealtimeSessionInfo) {
    this.session = session;
  }

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

suite("Unit: WebRTCConfigFactory", () => {
  test("creates a configuration bundle with normalized fields", async () => {
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

    expect(config.endpoint.region).to.equal("eastus2");
    expect(config.endpoint.url).to.equal(
      "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
    );
    expect(config.authentication.ephemeralKey).to.equal(session.ephemeralKey);
    expect(config.audioConfig.sampleRate).to.equal(24000);
    expect(config.audioConfig.codecProfileId).to.equal("pcm16-24k-mono");
    expect(config.audioConfig.workletModuleUrls).to.deep.equal([
      "resource://voicepilot/processors/vad-processor.js",
      "resource://voicepilot/processors/gain-processor.js",
    ]);
    expect(
      Object.isFrozen(config.audioConfig.workletModuleUrls),
      "worklet modules should be frozen to prevent mutation",
    ).to.be.true;
    expect(config.sessionConfig.voice).to.equal("alloy");
    expect(config.sessionConfig.turnDetection).to.exist;
    expect(config.dataChannelConfig?.channelName).to.equal("realtime-channel");
    expect(config.connectionConfig?.reconnectAttempts).to.equal(3);

    const debugEntry = entries.find((entry) => entry.level === "debug");
    expect(debugEntry, "should emit a debug log when config is created").to.exist;
  });

  test("maps known Azure regions to supported WebRTC regions", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      azure: {
        region: "eastus",
      } as Partial<AzureOpenAIConfig> & { region: string },
    });

    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const config = await factory.createConfig(manager, keyService as any);

    expect(config.endpoint.region).to.equal("eastus2");
    expect(config.endpoint.url).to.equal(
      "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
    );
  });

  test("rejects creation when the region is unsupported", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      azure: {
        region: "antarctica" as unknown as "eastus2",
      },
    });
    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());

    try {
      await factory.createConfig(manager, keyService as any);
      expect.fail("Expected createConfig to reject for unsupported region");
    } catch (error) {
      const webrtcError = error as WebRTCErrorImpl;
      expect(webrtcError).to.be.instanceOf(WebRTCErrorImpl);
      expect(webrtcError.code).to.equal(WebRTCErrorCode.ConfigurationInvalid);
      expect(webrtcError.message).to.match(/Unsupported region/i);
    }
  });

  test("fails fast when session expiry window is unsafe", async () => {
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

    try {
      await factory.createConfig(manager, keyService as any);
      expect.fail("Expected createConfig to reject when expiry is unsafe");
    } catch (error) {
      const webrtcError = error as WebRTCErrorImpl;
      expect(webrtcError).to.be.instanceOf(WebRTCErrorImpl);
      expect(webrtcError.code).to.equal(WebRTCErrorCode.AuthenticationFailed);
      expect(webrtcError.message).to.match(/expires too soon/i);
    }
  });

  test("warns when requested sample rate is adjusted for compliance", async () => {
    const { logger, entries } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const { manager } = createConfigManagerStub({
      audio: {
        sampleRate: 16000,
      },
    });

    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const config = await factory.createConfig(manager, keyService as any);

    expect(config.audioConfig.sampleRate).to.equal(24000);
    const warning = entries.find((entry) => entry.level === "warn");
    expect(warning, "expected warning when sample rate is adjusted").to.exist;
    expect(warning?.message).to.match(/Audio sample rate adjusted/i);
  });

  test("refreshes authentication material via updateConfigWithNewKey", async () => {
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

    expect(updated).to.not.equal(baseConfig);
    expect(updated.authentication.ephemeralKey).to.equal("refreshed-key");
    expect(baseConfig.authentication.ephemeralKey).to.equal("ephemeral-key");
  });

  test("surfaces structured errors when key refresh fails", async () => {
    const { logger } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const keyService = new EphemeralKeyServiceStub(createRealtimeSession());
    const { manager } = createConfigManagerStub();
    const baseConfig = await factory.createConfig(manager, keyService as any);

    keyService.setSession(new Error("network unavailable") as unknown as RealtimeSessionInfo);

    try {
      await factory.updateConfigWithNewKey(baseConfig, keyService as any);
      expect.fail("Expected updateConfigWithNewKey to reject when key refresh fails");
    } catch (error) {
      const webrtcError = error as WebRTCErrorImpl;
      expect(webrtcError).to.be.instanceOf(WebRTCErrorImpl);
      expect(webrtcError.code).to.equal(WebRTCErrorCode.AuthenticationFailed);
      expect(webrtcError.message).to.match(/Key update failed/i);
    }
  });

  test("validates configurations and logs failures", () => {
    const { logger, entries } = createTestLogger();
    const factory = new WebRTCConfigFactory(logger);
    const config = factory.createTestConfig();

  expect(factory.validateConfig(config)).to.be.true;

    const expiredConfig: WebRTCConfig = {
      ...config,
      authentication: {
        ...config.authentication,
        expiresAt: new Date(Date.now() - 1000),
      },
    };

    expect(factory.validateConfig(expiredConfig)).to.be.false;
    const errorEntry = entries.find((entry) => entry.level === "error");
    expect(errorEntry, "validation failure should emit error log").to.exist;
    expect(errorEntry?.message).to.match(/validation failed/i);
  });
});

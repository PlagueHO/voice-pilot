import { WebRTCTransportImpl } from "../../../audio/webrtc-transport";
import type { Logger } from "../../../core/logger";
import type { EphemeralKeyInfo } from "../../../types/ephemeral";
import type { RealtimeEvent, SessionUpdateEvent } from "../../../types/realtime-events";
import type {
  RecoveryEventPayload,
  WebRTCConfig,
  WebRTCEvent,
} from "../../../types/webrtc";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

type LogLevel = "info" | "warn" | "error" | "debug";

type LogEntry = {
  level: LogLevel;
  message: string;
  data?: unknown;
};

type ConfigOverrides = Partial<WebRTCConfig> & {
  sessionConfig?: Partial<WebRTCConfig["sessionConfig"]>;
  audioConfig?: Partial<WebRTCConfig["audioConfig"]>;
  endpoint?: Partial<WebRTCConfig["endpoint"]>;
  authentication?: Partial<WebRTCConfig["authentication"]> & {
    keyInfo?: Partial<EphemeralKeyInfo>;
  };
};

function createTestLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];

  const loggerStub = {
    info: (message: string, data?: unknown) => {
      entries.push({ level: "info", message, data });
    },
    warn: (message: string, data?: unknown) => {
      entries.push({ level: "warn", message, data });
    },
    error: (message: string, data?: unknown) => {
      entries.push({ level: "error", message, data });
    },
    debug: (message: string, data?: unknown) => {
      entries.push({ level: "debug", message, data });
    },
    setLevel: () => {
      /* noop */
    },
    dispose: () => {
      /* noop */
    },
  } as unknown as Logger;

  return { logger: loggerStub, entries };
}

function createBaseKeyInfo(): EphemeralKeyInfo {
  const now = new Date();
  const refreshAt = new Date(now.getTime() + 30_000);
  return {
    key: "test-key",
    sessionId: "session-id",
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    isValid: true,
    secondsRemaining: 60,
    refreshAt,
    secondsUntilRefresh: 30,
    ttlSeconds: 60,
    refreshIntervalSeconds: 30,
  };
}

function createConfig(overrides: ConfigOverrides = {}): WebRTCConfig {
  const baseKeyInfo = createBaseKeyInfo();
  const baseConfig: WebRTCConfig = {
    endpoint: {
      region: "eastus2",
      url: "https://example.azure.com/realtime",
      deployment: "gpt-realtime",
      apiVersion: "2025-08-28",
    },
    authentication: {
      ephemeralKey: "ephemeral-key",
      expiresAt: new Date(Date.now() + 60_000),
      keyInfo: baseKeyInfo,
    },
    audioConfig: {
      sampleRate: 24000,
      codecProfileId: "pcm16-24k-mono",
      format: "pcm16",
      channels: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: "interactive",
        resumeOnActivation: true,
        requiresUserGesture: false,
      },
      workletModuleUrls: [],
    },
    sessionConfig: {
      inputAudioFormat: "pcm16",
      outputAudioFormat: "pcm16",
    },
  };

  const mergedConfig: WebRTCConfig = {
    ...baseConfig,
    ...overrides,
    endpoint: {
      ...baseConfig.endpoint,
      ...overrides.endpoint,
    },
    authentication: {
      ...baseConfig.authentication,
      ...overrides.authentication,
      keyInfo: {
        ...baseConfig.authentication.keyInfo,
        ...overrides.authentication?.keyInfo,
      },
    },
    audioConfig: {
      ...baseConfig.audioConfig,
      ...overrides.audioConfig,
    },
    sessionConfig: {
      ...baseConfig.sessionConfig,
      ...overrides.sessionConfig,
    },
  };

  return mergedConfig;
}

suite("Unit: WebRTCTransportImpl configuration helpers", () => {
  test("composeSessionUpdateEvent includes session metadata and defaults", () => {
    const { logger } = createTestLogger();
    const transport = new WebRTCTransportImpl(logger);

    const config = createConfig({
      sessionConfig: {
        voice: "alloy",
        instructions: "Respond concisely",
        locale: "en-GB",
        inputAudioFormat: "pcm24",
        outputAudioFormat: "pcm32",
        transcriptionModel: "whisper-1",
        turnDetection: {
          type: "server_vad",
          threshold: 0.42,
          prefixPaddingMs: 120,
          silenceDurationMs: 480,
          createResponse: true,
          interruptResponse: false,
          eagerness: "auto",
        },
      },
    });

    const sessionUpdate = (transport as any).composeSessionUpdateEvent(
      config,
    ) as SessionUpdateEvent;

    expect(sessionUpdate.type).to.equal("session.update");
    expect(sessionUpdate.session.modalities).to.deep.equal([
      "audio",
      "text",
    ]);
    expect(sessionUpdate.session.output_modalities).to.deep.equal([
      "audio",
      "text",
    ]);
    expect(sessionUpdate.session.input_audio_format).to.equal("pcm24");
    expect(sessionUpdate.session.output_audio_format).to.equal("pcm32");
    expect(sessionUpdate.session.voice).to.equal("alloy");
    expect(sessionUpdate.session.instructions).to.equal("Respond concisely");
    expect(sessionUpdate.session.locale).to.equal("en-GB");
    expect(sessionUpdate.session.input_audio_transcription?.model).to.equal(
      "whisper-1",
    );

    expect(sessionUpdate.session.turn_detection).to.deep.equal({
      type: "server_vad",
      threshold: 0.42,
      prefix_padding_ms: 120,
      silence_duration_ms: 480,
      create_response: true,
      interrupt_response: false,
      eagerness: "auto",
    });
  });
});

suite("Unit: WebRTCTransportImpl recovery events", () => {
  test("publishRecoveryEvent emits structured attempt/success/failure events", () => {
    const { logger } = createTestLogger();
    const transport = new WebRTCTransportImpl(logger);
    const events: WebRTCEvent[] = [];

    const captureEvent = (event: WebRTCEvent) => {
      events.push(event);
    };

    transport.addEventListener("reconnectAttempt", captureEvent);
    transport.addEventListener("reconnectSucceeded", captureEvent);
    transport.addEventListener("reconnectFailed", captureEvent);

    const attempt: RecoveryEventPayload = {
      type: "reconnectAttempt",
      strategy: "restart_ice",
      attempt: 2,
      delayMs: 750,
    };

    const success: RecoveryEventPayload = {
      type: "reconnectSucceeded",
      strategy: "recreate_datachannel",
      attempt: 1,
      durationMs: 1200,
    };

    const failureError = new Error("failed");
    const failure: RecoveryEventPayload = {
      type: "reconnectFailed",
      strategy: "restart_ice",
      attempt: 3,
      durationMs: 2100,
      error: failureError,
    };

    transport.publishRecoveryEvent(attempt);
    transport.publishRecoveryEvent(success);
    transport.publishRecoveryEvent(failure);

    expect(events).to.have.length(3);

    const [attemptEvent, successEvent, failureEvent] = events;

    expect(attemptEvent.type).to.equal("reconnectAttempt");
    expect(attemptEvent.data).to.deep.equal({
      strategy: "restart_ice",
      attempt: 2,
      delayMs: 750,
    });

    expect(successEvent.type).to.equal("reconnectSucceeded");
    expect(successEvent.data).to.deep.equal({
      strategy: "recreate_datachannel",
      attempt: 1,
      durationMs: 1200,
      error: undefined,
    });

    expect(failureEvent.type).to.equal("reconnectFailed");
    expect(failureEvent.data).to.deep.equal({
      strategy: "restart_ice",
      attempt: 3,
      durationMs: 2100,
      error: failureError,
    });
  });
});

suite("Unit: WebRTCTransportImpl data channel queue", () => {
  test("sendDataChannelMessage enforces queue capacity and emits fallback state", async () => {
    const { logger, entries } = createTestLogger();
    const transport = new WebRTCTransportImpl(logger);
    const states: WebRTCEvent[] = [];

    transport.addEventListener("dataChannelStateChanged", (event) => {
      states.push(event);
    });

    (transport as any).maxQueuedMessages = 2;

    await transport.sendDataChannelMessage({ type: "queued.1" });
    await transport.sendDataChannelMessage({ type: "queued.2" });
    await transport.sendDataChannelMessage({ type: "queued.3" });

    const queue = (transport as any).pendingDataChannelMessages as RealtimeEvent[];

    expect(queue).to.have.length(2);
    expect(queue[0]?.type).to.equal("queued.2");
    expect(queue[1]?.type).to.equal("queued.3");
    expect(transport.isDataChannelFallbackActive()).to.be.true;

    const dropWarning = entries.find(
      (entry) =>
        entry.level === "warn" &&
        entry.message === "Data channel queue capacity reached; dropping oldest",
    );

    expect(dropWarning).to.not.equal(undefined);

    const fallbackEvent = states.find(
      (event) =>
        event.type === "dataChannelStateChanged" &&
        event.data?.queuedMessages === 2,
    );

    expect(fallbackEvent).to.not.equal(undefined);
    expect(fallbackEvent?.data?.fallbackActive).to.equal(true);
    expect(fallbackEvent?.data?.reason).to.equal(
      "Data channel unavailable, queued message",
    );
  });
});

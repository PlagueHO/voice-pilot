import * as assert from "assert";
import {
  AzureTurnDetectionCoordinator,
  type HybridFallbackAdapter,
  type TurnDetectionCoordinatorEvent,
} from "../../../audio/turn-detection-coordinator";
import type { Logger } from "../../../core/logger";
import type { TurnDetectionConfig } from "../../../types/configuration";

interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
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

class MockFallbackAdapter implements HybridFallbackAdapter {
  public enableCount = 0;
  public disableCount = 0;
  public processed: Array<{ frame: Int16Array; timestamp: number }> = [];

  async enable(): Promise<void> {
    this.enableCount += 1;
  }

  async disable(): Promise<void> {
    this.disableCount += 1;
  }

  processFrame(frame: Int16Array, timestamp: number): void {
    this.processed.push({ frame, timestamp });
  }
}

function createConfig(overrides: Partial<TurnDetectionConfig> = {}): TurnDetectionConfig {
  return {
    type: "server_vad",
    threshold: 0.5,
    prefixPaddingMs: 300,
    silenceDurationMs: 200,
    createResponse: true,
    interruptResponse: true,
    eagerness: "auto",
    ...overrides,
  };
}

describe("AzureTurnDetectionCoordinator", () => {
  it("enforces initialization guard before public operations", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);

    await assert.rejects(
      coordinator.configure(createConfig()),
      /must be initialized/,
      "configure should require initialization",
    );

    assert.throws(
      () => coordinator.handleServerEvent({ type: "speech-start", timestamp: 0 }),
      /must be initialized/,
      "handleServerEvent should require initialization",
    );

    await coordinator.initialize();
    assert.strictEqual(coordinator.isInitialized(), true);

    coordinator.dispose();
  });

  it("emits normalized configuration updates and mode change events", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    const configEvents: TurnDetectionCoordinatorEvent[] = [];
    const modeEvents: TurnDetectionCoordinatorEvent[] = [];

    const configDisposable = coordinator.on("config-updated", (event) => {
      configEvents.push(event);
    });
    const modeDisposable = coordinator.on("mode-changed", (event) => {
      modeEvents.push(event);
    });

    const newConfig = createConfig({
      type: "semantic_vad",
      threshold: 1.4,
      prefixPaddingMs: 149.2,
      silenceDurationMs: 220.7,
      createResponse: false,
      interruptResponse: true,
      eagerness: "high",
    });

    await coordinator.configure(newConfig);

    assert.strictEqual(configEvents.length, 1, "config-updated should fire once");
    const eventConfig = configEvents[0]?.config;
    assert.ok(eventConfig, "config payload should be present");
    assert.deepStrictEqual(eventConfig, {
      type: "semantic_vad",
      threshold: 1,
      prefixPaddingMs: 149,
      silenceDurationMs: 221,
      createResponse: false,
      interruptResponse: true,
      eagerness: "high",
    });

    assert.strictEqual(modeEvents.length, 1, "mode-changed should fire when type changes");
    assert.strictEqual(modeEvents[0]?.previousMode, "server_vad");
    assert.strictEqual(modeEvents[0]?.state.mode, "semantic_vad");
    assert.strictEqual(modeEvents[0]?.state.pendingResponse, false);

    configDisposable.dispose();
    modeDisposable.dispose();
    coordinator.dispose();
  });

  it("processes realtime events, manages fallback adapter, and updates diagnostics", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    const adapter = new MockFallbackAdapter();
    coordinator.registerFallbackAdapter(adapter);

    const startEvents: TurnDetectionCoordinatorEvent[] = [];
    const stopEvents: TurnDetectionCoordinatorEvent[] = [];
    const fallbackEvents: TurnDetectionCoordinatorEvent[] = [];

    const disposables = [
      coordinator.on("speech-start-detached", (event) => {
        startEvents.push(event);
      }),
      coordinator.on("speech-stop-detached", (event) => {
        stopEvents.push(event);
      }),
      coordinator.on("fallback-engaged", (event) => {
        fallbackEvents.push(event);
      }),
    ];

    coordinator.handleServerEvent({ type: "speech-start", timestamp: 1000, latencyMs: 45 });
    let state = coordinator.getState();
    assert.strictEqual(state.lastSpeechStart, 1000);
    assert.strictEqual(state.pendingResponse, false);
    assert.strictEqual(state.diagnostics.avgStartLatencyMs, 45);
    assert.strictEqual(startEvents.length, 1);

    coordinator.handleServerEvent({ type: "degraded", timestamp: 1200 });
    state = coordinator.getState();
    assert.strictEqual(state.diagnostics.missedEvents, 1);
    assert.strictEqual(state.diagnostics.fallbackActive, true);
    assert.strictEqual(adapter.enableCount, 1);
    assert.strictEqual(fallbackEvents.at(-1)?.metadata?.reason, "server_degraded");

    const originalNow = Date.now;
    Date.now = () => 2000;
    try {
      coordinator.handleServerEvent({ type: "response-interrupted", timestamp: 1500 });
    } finally {
      Date.now = originalNow;
    }

    state = coordinator.getState();
    assert.strictEqual(state.diagnostics.fallbackActive, false);
    assert.strictEqual(adapter.disableCount, 1);
    assert.strictEqual(stopEvents.length, 1);
    assert.ok(Math.abs(state.diagnostics.avgStopLatencyMs - 500) < 0.001);
    assert.strictEqual(fallbackEvents.at(-1)?.metadata?.reason, "server_response_interrupted");

    coordinator.handleServerEvent({
      type: "speech-stop",
      timestamp: 2600,
      serverEvent: { create_response: true },
      latencyMs: 60,
    });

    state = coordinator.getState();
    assert.strictEqual(state.lastSpeechStop, 2600);
    assert.strictEqual(state.pendingResponse, true);
    assert.ok(Math.abs(state.diagnostics.avgStopLatencyMs - 280) < 0.001);
    assert.strictEqual(stopEvents.length, 2);

    coordinator.handleServerEvent({ type: "degraded", timestamp: 3100 });
    state = coordinator.getState();
    assert.strictEqual(state.diagnostics.fallbackActive, true);
    assert.strictEqual(state.diagnostics.missedEvents, 2);
    assert.strictEqual(adapter.enableCount, 2);

    await coordinator.requestModeChange("none");
    state = coordinator.getState();
    assert.strictEqual(state.mode, "none");
    assert.strictEqual(state.diagnostics.fallbackActive, false);
    assert.strictEqual(adapter.disableCount, 2);
    assert.strictEqual(fallbackEvents.at(-1)?.metadata?.reason, "mode_switch_manual");

    disposables.forEach((d) => d.dispose());
    coordinator.dispose();
  });

  it("warns when fallback engages without a registered adapter", async () => {
    const { logger, entries } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    coordinator.handleServerEvent({ type: "degraded", timestamp: 500 });

    const state = coordinator.getState();
    assert.strictEqual(state.diagnostics.fallbackActive, true);
    assert.strictEqual(state.diagnostics.missedEvents, 1);
    assert.ok(
      entries.some((entry) => entry.level === "warn" && entry.message === "Fallback active without adapter"),
      "warn should be logged when fallback adapter is missing",
    );

    coordinator.dispose();
  });

  it("disables previous adapter and enables the new one when fallback is active", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    const firstAdapter = new MockFallbackAdapter();
    coordinator.registerFallbackAdapter(firstAdapter);

    coordinator.handleServerEvent({ type: "degraded", timestamp: 900 });
    assert.strictEqual(firstAdapter.enableCount, 1);

    const secondAdapter = new MockFallbackAdapter();
    coordinator.registerFallbackAdapter(secondAdapter);

    assert.strictEqual(firstAdapter.disableCount, 1, "previous adapter should be disabled when replacing");
    assert.strictEqual(secondAdapter.enableCount, 1, "new adapter should be enabled when fallback active");

    coordinator.registerFallbackAdapter(undefined);
    assert.strictEqual(secondAdapter.disableCount, 1, "second adapter should be disabled when removed during fallback");

    coordinator.dispose();
  });
});

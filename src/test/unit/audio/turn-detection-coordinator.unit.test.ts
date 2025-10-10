import {
  AzureTurnDetectionCoordinator,
  type HybridFallbackAdapter,
  type TurnDetectionCoordinatorEvent,
} from "../../../audio/turn-detection-coordinator";
import type { Logger } from "../../../core/logger";
import type { TurnDetectionConfig } from "../../../types/configuration";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

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

suite("Unit: AzureTurnDetectionCoordinator", () => {
  test("enforces initialization guard before public operations", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);

    await expect(coordinator.configure(createConfig())).to.be.rejectedWith(/must be initialized/);

    expect(() => coordinator.handleServerEvent({ type: "speech-start", timestamp: 0 })).to.throw(
      /must be initialized/,
      "handleServerEvent should require initialization",
    );

    await coordinator.initialize();
    expect(coordinator.isInitialized()).to.be.true;

    coordinator.dispose();
  });

  test("emits normalized configuration updates and mode change events", async () => {
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

    expect(configEvents.length, "config-updated should fire once").to.equal(1);
    const eventConfig = configEvents[0]?.config;
    expect(eventConfig, "config payload should be present").to.exist;
    expect(eventConfig).to.deep.equal({
      type: "semantic_vad",
      threshold: 1,
      prefixPaddingMs: 149,
      silenceDurationMs: 221,
      createResponse: false,
      interruptResponse: true,
      eagerness: "high",
    });

    expect(modeEvents.length, "mode-changed should fire when type changes").to.equal(1);
    expect(modeEvents[0]?.previousMode).to.equal("server_vad");
    expect(modeEvents[0]?.state.mode).to.equal("semantic_vad");
    expect(modeEvents[0]?.state.pendingResponse).to.be.false;

    configDisposable.dispose();
    modeDisposable.dispose();
    coordinator.dispose();
  });

  test("processes realtime events, manages fallback adapter, and updates diagnostics", async () => {
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
    expect(state.lastSpeechStart).to.equal(1000);
    expect(state.pendingResponse).to.be.false;
    expect(state.diagnostics.avgStartLatencyMs).to.equal(45);
    expect(startEvents.length).to.equal(1);

    coordinator.handleServerEvent({ type: "degraded", timestamp: 1200 });
    state = coordinator.getState();
    expect(state.diagnostics.missedEvents).to.equal(1);
    expect(state.diagnostics.fallbackActive).to.be.true;
    expect(adapter.enableCount).to.equal(1);
    expect(fallbackEvents.at(-1)?.metadata?.reason).to.equal("server_degraded");

    const originalNow = Date.now;
    Date.now = () => 2000;
    try {
      coordinator.handleServerEvent({ type: "response-interrupted", timestamp: 1500 });
    } finally {
      Date.now = originalNow;
    }

    state = coordinator.getState();
    expect(state.diagnostics.fallbackActive).to.be.false;
    expect(adapter.disableCount).to.equal(1);
    expect(stopEvents.length).to.equal(1);
    expect(Math.abs(state.diagnostics.avgStopLatencyMs - 500)).to.be.below(0.001);
    expect(fallbackEvents.at(-1)?.metadata?.reason).to.equal("server_response_interrupted");

    coordinator.handleServerEvent({
      type: "speech-stop",
      timestamp: 2600,
      serverEvent: { create_response: true },
      latencyMs: 60,
    });

    state = coordinator.getState();
    expect(state.lastSpeechStop).to.equal(2600);
    expect(state.pendingResponse).to.be.true;
    expect(Math.abs(state.diagnostics.avgStopLatencyMs - 280)).to.be.below(0.001);
    expect(stopEvents.length).to.equal(2);

    coordinator.handleServerEvent({ type: "degraded", timestamp: 3100 });
    state = coordinator.getState();
    expect(state.diagnostics.fallbackActive).to.be.true;
    expect(state.diagnostics.missedEvents).to.equal(2);
    expect(adapter.enableCount).to.equal(2);

    await coordinator.requestModeChange("none");
    state = coordinator.getState();
    expect(state.mode).to.equal("none");
    expect(state.diagnostics.fallbackActive).to.be.false;
    expect(adapter.disableCount).to.equal(2);
    expect(fallbackEvents.at(-1)?.metadata?.reason).to.equal("mode_switch_manual");

    disposables.forEach((d) => d.dispose());
    coordinator.dispose();
  });

  test("warns when fallback engages without a registered adapter", async () => {
    const { logger, entries } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    coordinator.handleServerEvent({ type: "degraded", timestamp: 500 });

    const state = coordinator.getState();
    expect(state.diagnostics.fallbackActive).to.be.true;
    expect(state.diagnostics.missedEvents).to.equal(1);
    expect(
      entries.some((entry) => entry.level === "warn" && entry.message === "Fallback active without adapter"),
      "warn should be logged when fallback adapter is missing",
    ).to.be.true;

    coordinator.dispose();
  });

  test("disables previous adapter and enables the new one when fallback is active", async () => {
    const { logger } = createTestLogger();
    const coordinator = new AzureTurnDetectionCoordinator(undefined, logger);
    await coordinator.initialize();

    const firstAdapter = new MockFallbackAdapter();
    coordinator.registerFallbackAdapter(firstAdapter);

  coordinator.handleServerEvent({ type: "degraded", timestamp: 900 });
  expect(firstAdapter.enableCount).to.equal(1);

    const secondAdapter = new MockFallbackAdapter();
    coordinator.registerFallbackAdapter(secondAdapter);

    expect(firstAdapter.disableCount, "previous adapter should be disabled when replacing").to.equal(1);
    expect(secondAdapter.enableCount, "new adapter should be enabled when fallback active").to.equal(1);

    coordinator.registerFallbackAdapter(undefined);
    expect(
      secondAdapter.disableCount,
      "second adapter should be disabled when removed during fallback",
    ).to.equal(1);

    coordinator.dispose();
  });
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const turn_detection_coordinator_1 = require("../../src/../audio/turn-detection-coordinator");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
function createTestLogger() {
    const entries = [];
    const logger = {
        debug: (message, data) => {
            entries.push({ level: "debug", message, data });
        },
        info: (message, data) => {
            entries.push({ level: "info", message, data });
        },
        warn: (message, data) => {
            entries.push({ level: "warn", message, data });
        },
        error: (message, data) => {
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
    };
    return { logger, entries };
}
class MockFallbackAdapter {
    enableCount = 0;
    disableCount = 0;
    processed = [];
    async enable() {
        this.enableCount += 1;
    }
    async disable() {
        this.disableCount += 1;
    }
    processFrame(frame, timestamp) {
        this.processed.push({ frame, timestamp });
    }
}
function createConfig(overrides = {}) {
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
(0, mocha_globals_1.suite)("Unit: AzureTurnDetectionCoordinator", () => {
    (0, mocha_globals_1.test)("enforces initialization guard before public operations", async () => {
        const { logger } = createTestLogger();
        const coordinator = new turn_detection_coordinator_1.AzureTurnDetectionCoordinator(undefined, logger);
        await (0, chai_setup_1.expect)(coordinator.configure(createConfig())).to.be.rejectedWith(/must be initialized/);
        (0, chai_setup_1.expect)(() => coordinator.handleServerEvent({ type: "speech-start", timestamp: 0 })).to.throw(/must be initialized/, "handleServerEvent should require initialization");
        await coordinator.initialize();
        (0, chai_setup_1.expect)(coordinator.isInitialized()).to.be.true;
        coordinator.dispose();
    });
    (0, mocha_globals_1.test)("emits normalized configuration updates and mode change events", async () => {
        const { logger } = createTestLogger();
        const coordinator = new turn_detection_coordinator_1.AzureTurnDetectionCoordinator(undefined, logger);
        await coordinator.initialize();
        const configEvents = [];
        const modeEvents = [];
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
        (0, chai_setup_1.expect)(configEvents.length, "config-updated should fire once").to.equal(1);
        const eventConfig = configEvents[0]?.config;
        (0, chai_setup_1.expect)(eventConfig, "config payload should be present").to.exist;
        (0, chai_setup_1.expect)(eventConfig).to.deep.equal({
            type: "semantic_vad",
            threshold: 1,
            prefixPaddingMs: 149,
            silenceDurationMs: 221,
            createResponse: false,
            interruptResponse: true,
            eagerness: "high",
        });
        (0, chai_setup_1.expect)(modeEvents.length, "mode-changed should fire when type changes").to.equal(1);
        (0, chai_setup_1.expect)(modeEvents[0]?.previousMode).to.equal("server_vad");
        (0, chai_setup_1.expect)(modeEvents[0]?.state.mode).to.equal("semantic_vad");
        (0, chai_setup_1.expect)(modeEvents[0]?.state.pendingResponse).to.be.false;
        configDisposable.dispose();
        modeDisposable.dispose();
        coordinator.dispose();
    });
    (0, mocha_globals_1.test)("processes realtime events, manages fallback adapter, and updates diagnostics", async () => {
        const { logger } = createTestLogger();
        const coordinator = new turn_detection_coordinator_1.AzureTurnDetectionCoordinator(undefined, logger);
        await coordinator.initialize();
        const adapter = new MockFallbackAdapter();
        coordinator.registerFallbackAdapter(adapter);
        const startEvents = [];
        const stopEvents = [];
        const fallbackEvents = [];
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
        (0, chai_setup_1.expect)(state.lastSpeechStart).to.equal(1000);
        (0, chai_setup_1.expect)(state.pendingResponse).to.be.false;
        (0, chai_setup_1.expect)(state.diagnostics.avgStartLatencyMs).to.equal(45);
        (0, chai_setup_1.expect)(startEvents.length).to.equal(1);
        coordinator.handleServerEvent({ type: "degraded", timestamp: 1200 });
        state = coordinator.getState();
        (0, chai_setup_1.expect)(state.diagnostics.missedEvents).to.equal(1);
        (0, chai_setup_1.expect)(state.diagnostics.fallbackActive).to.be.true;
        (0, chai_setup_1.expect)(adapter.enableCount).to.equal(1);
        (0, chai_setup_1.expect)(fallbackEvents.at(-1)?.metadata?.reason).to.equal("server_degraded");
        const originalNow = Date.now;
        Date.now = () => 2000;
        try {
            coordinator.handleServerEvent({ type: "response-interrupted", timestamp: 1500 });
        }
        finally {
            Date.now = originalNow;
        }
        state = coordinator.getState();
        (0, chai_setup_1.expect)(state.diagnostics.fallbackActive).to.be.false;
        (0, chai_setup_1.expect)(adapter.disableCount).to.equal(1);
        (0, chai_setup_1.expect)(stopEvents.length).to.equal(1);
        (0, chai_setup_1.expect)(Math.abs(state.diagnostics.avgStopLatencyMs - 500)).to.be.below(0.001);
        (0, chai_setup_1.expect)(fallbackEvents.at(-1)?.metadata?.reason).to.equal("server_response_interrupted");
        coordinator.handleServerEvent({
            type: "speech-stop",
            timestamp: 2600,
            serverEvent: { create_response: true },
            latencyMs: 60,
        });
        state = coordinator.getState();
        (0, chai_setup_1.expect)(state.lastSpeechStop).to.equal(2600);
        (0, chai_setup_1.expect)(state.pendingResponse).to.be.true;
        (0, chai_setup_1.expect)(Math.abs(state.diagnostics.avgStopLatencyMs - 280)).to.be.below(0.001);
        (0, chai_setup_1.expect)(stopEvents.length).to.equal(2);
        coordinator.handleServerEvent({ type: "degraded", timestamp: 3100 });
        state = coordinator.getState();
        (0, chai_setup_1.expect)(state.diagnostics.fallbackActive).to.be.true;
        (0, chai_setup_1.expect)(state.diagnostics.missedEvents).to.equal(2);
        (0, chai_setup_1.expect)(adapter.enableCount).to.equal(2);
        await coordinator.requestModeChange("none");
        state = coordinator.getState();
        (0, chai_setup_1.expect)(state.mode).to.equal("none");
        (0, chai_setup_1.expect)(state.diagnostics.fallbackActive).to.be.false;
        (0, chai_setup_1.expect)(adapter.disableCount).to.equal(2);
        (0, chai_setup_1.expect)(fallbackEvents.at(-1)?.metadata?.reason).to.equal("mode_switch_manual");
        disposables.forEach((d) => d.dispose());
        coordinator.dispose();
    });
    (0, mocha_globals_1.test)("warns when fallback engages without a registered adapter", async () => {
        const { logger, entries } = createTestLogger();
        const coordinator = new turn_detection_coordinator_1.AzureTurnDetectionCoordinator(undefined, logger);
        await coordinator.initialize();
        coordinator.handleServerEvent({ type: "degraded", timestamp: 500 });
        const state = coordinator.getState();
        (0, chai_setup_1.expect)(state.diagnostics.fallbackActive).to.be.true;
        (0, chai_setup_1.expect)(state.diagnostics.missedEvents).to.equal(1);
        (0, chai_setup_1.expect)(entries.some((entry) => entry.level === "warn" && entry.message === "Fallback active without adapter"), "warn should be logged when fallback adapter is missing").to.be.true;
        coordinator.dispose();
    });
    (0, mocha_globals_1.test)("disables previous adapter and enables the new one when fallback is active", async () => {
        const { logger } = createTestLogger();
        const coordinator = new turn_detection_coordinator_1.AzureTurnDetectionCoordinator(undefined, logger);
        await coordinator.initialize();
        const firstAdapter = new MockFallbackAdapter();
        coordinator.registerFallbackAdapter(firstAdapter);
        coordinator.handleServerEvent({ type: "degraded", timestamp: 900 });
        (0, chai_setup_1.expect)(firstAdapter.enableCount).to.equal(1);
        const secondAdapter = new MockFallbackAdapter();
        coordinator.registerFallbackAdapter(secondAdapter);
        (0, chai_setup_1.expect)(firstAdapter.disableCount, "previous adapter should be disabled when replacing").to.equal(1);
        (0, chai_setup_1.expect)(secondAdapter.enableCount, "new adapter should be enabled when fallback active").to.equal(1);
        coordinator.registerFallbackAdapter(undefined);
        (0, chai_setup_1.expect)(secondAdapter.disableCount, "second adapter should be disabled when removed during fallback").to.equal(1);
        coordinator.dispose();
    });
});
//# sourceMappingURL=turn-detection-coordinator.unit.test.js.map
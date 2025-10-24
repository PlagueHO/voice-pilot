"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const conversation_state_machine_1 = require("../../src/conversation/conversation-state-machine");
const logger_1 = require("../../src/core/logger");
const session_1 = require("../../src/types/session");
const chai_setup_1 = require("../helpers/chai-setup");
const mocha_globals_1 = require("../mocha-globals");
function createSessionInfo() {
    const config = {
        renewalMarginSeconds: 10,
        inactivityTimeoutMinutes: 5,
        heartbeatIntervalSeconds: 30,
        maxRetryAttempts: 3,
        retryBackoffMs: 1000,
        enableHeartbeat: true,
        enableInactivityTimeout: true,
    };
    const statistics = {
        renewalCount: 0,
        failedRenewalCount: 0,
        heartbeatCount: 0,
        inactivityResets: 0,
        totalDurationMs: 0,
        averageRenewalLatencyMs: 0,
    };
    const connectionInfo = {
        webrtcState: "connected",
        reconnectAttempts: 0,
    };
    return {
        sessionId: "session-001",
        state: session_1.SessionState.Active,
        startedAt: new Date(),
        lastActivity: new Date(),
        config,
        statistics,
        connectionInfo,
    };
}
function newTimestamp() {
    return new Date().toISOString();
}
function buildTranscriptDelta(session, overrides = {}) {
    const { metadata: metadataOverride, ...eventOverrides } = overrides;
    return {
        type: "transcript-delta",
        sessionId: session.sessionId,
        utteranceId: "utt-1",
        delta: "hello",
        content: "hello",
        confidence: 0.92,
        timestamp: newTimestamp(),
        sequence: 1,
        metadata: {
            startOffsetMs: 0,
            endOffsetMs: 400,
            chunkCount: 1,
            locale: "en-US",
            ...(metadataOverride ?? {}),
        },
        ...eventOverrides,
    };
}
function buildTranscriptFinal(session, overrides = {}) {
    const { metadata: metadataOverride, ...eventOverrides } = overrides;
    return {
        type: "transcript-final",
        sessionId: session.sessionId,
        utteranceId: "utt-1",
        content: "hello world",
        confidence: 0.94,
        timestamp: newTimestamp(),
        metadata: {
            startOffsetMs: 0,
            endOffsetMs: 1450,
            chunkCount: 2,
            locale: "en-US",
            ...(metadataOverride ?? {}),
        },
        ...eventOverrides,
    };
}
function buildCopilotEvent(status, overrides = {}) {
    return {
        requestId: overrides.requestId ?? "request-1",
        status,
        timestamp: overrides.timestamp ?? newTimestamp(),
        ...overrides,
    };
}
function buildTtsEvent(state, type = "speaking-state-changed", overrides = {}) {
    const { data: dataOverride, ...eventOverrides } = overrides;
    return {
        type,
        handleId: eventOverrides.handleId ?? "tts-handle",
        timestamp: eventOverrides.timestamp ?? Date.now(),
        data: {
            state,
            ...(dataOverride ?? {}),
        },
        ...eventOverrides,
    };
}
(0, mocha_globals_1.suite)("Unit: ConversationStateMachine", () => {
    let logger;
    let machine;
    let sessionInfo;
    (0, mocha_globals_1.beforeEach)(async () => {
        logger = new logger_1.Logger("ConversationStateMachineTest");
        logger.setLevel("debug");
        machine = new conversation_state_machine_1.ConversationStateMachine({ logger });
        sessionInfo = createSessionInfo();
        await machine.initialize(sessionInfo);
    });
    (0, mocha_globals_1.afterEach)(() => {
        machine.dispose();
        logger.dispose();
    });
    (0, mocha_globals_1.test)("should transition from idle to listening on start", async () => {
        const transitions = [];
        const disposable = machine.onStateChanged((event) => {
            transitions.push(`${event.transition.from}->${event.transition.to}`);
        });
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        disposable.dispose();
        (0, chai_setup_1.expect)(transitions).to.include("idle->preparing");
        (0, chai_setup_1.expect)(transitions).to.include("preparing->listening");
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("listening");
    });
    (0, mocha_globals_1.test)("should ignore duplicate start requests while active", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        const transitions = [];
        const disposable = machine.onStateChanged((event) => {
            transitions.push(`${event.transition.from}->${event.transition.to}`);
        });
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        disposable.dispose();
        (0, chai_setup_1.expect)(transitions).to.be.empty;
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("listening");
    });
    (0, mocha_globals_1.test)("should append transcript delta and mark user turn active", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscript(buildTranscriptDelta(sessionInfo));
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("listening");
        (0, chai_setup_1.expect)(state.turnContext?.turnRole).to.equal("user");
        (0, chai_setup_1.expect)(state.turnContext?.transcript).to.equal("hello");
    });
    (0, mocha_globals_1.test)("should enter processing after final transcript", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscriptionStatus({
            type: "transcription-status",
            sessionId: sessionInfo.sessionId,
            status: "speech-started",
            timestamp: newTimestamp(),
        });
        await machine.notifyTranscript(buildTranscriptDelta(sessionInfo));
        await machine.notifyTranscript(buildTranscriptFinal(sessionInfo));
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("processing");
        (0, chai_setup_1.expect)(state.metadata.transcriptId).to.equal("utt-1");
    });
    (0, mocha_globals_1.test)("should move to processing when VAD stops speech", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscriptionStatus({
            type: "transcription-status",
            sessionId: sessionInfo.sessionId,
            status: "speech-stopped",
            timestamp: newTimestamp(),
        });
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("processing");
        (0, chai_setup_1.expect)(state.metadata.reason).to.equal("Conversation start requested");
    });
    (0, mocha_globals_1.test)("should sequence copilot states and speaking transitions", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscript(buildTranscriptFinal(sessionInfo));
        await machine.notifyCopilot(buildCopilotEvent("pending"));
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("waitingForCopilot");
        await machine.notifyCopilot(buildCopilotEvent("completed", { content: "assistant reply" }));
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("processing");
        await machine.notifyTts(buildTtsEvent("speaking"));
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("speaking");
        await machine.notifyTts(buildTtsEvent("idle", "playback-complete"));
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("listening");
    });
    (0, mocha_globals_1.test)("should transition to faulted when copilot fails", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyCopilot(buildCopilotEvent("failed", {
            error: { message: "timeout", retryable: false },
        }));
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("faulted");
        (0, chai_setup_1.expect)(state.metadata.reason).to.equal("timeout");
    });
    (0, mocha_globals_1.test)("should emit turn interruption when assistant speaking is interrupted", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscript(buildTranscriptFinal(sessionInfo));
        await machine.notifyCopilot(buildCopilotEvent("completed", { content: "assistant reply" }));
        await machine.notifyTts(buildTtsEvent("speaking"));
        const turnEvents = [];
        const disposable = machine.onTurnEvent((event) => {
            turnEvents.push(event.type);
        });
        machine.handleUserInterrupt("user-command", "manual barge-in");
        disposable.dispose();
        const state = machine.getState();
        (0, chai_setup_1.expect)(state.state).to.equal("interrupted");
        (0, chai_setup_1.expect)(turnEvents).to.include("turn-interrupted");
        (0, chai_setup_1.expect)(state.metadata.pendingActions).to.deep.equal(["user-command"]);
    });
    (0, mocha_globals_1.test)("should restore previous state after suspend resume cycle", async () => {
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        machine.suspend("network");
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("suspended");
        machine.resume();
        (0, chai_setup_1.expect)(machine.getState().state).to.equal("listening");
    });
    (0, mocha_globals_1.test)("should wire transcript source subscription", async () => {
        const events = [];
        const disposable = machine.onTranscriptEvent((event) => {
            events.push(event);
        });
        await machine.startConversation({ sessionId: sessionInfo.sessionId });
        await machine.notifyTranscript(buildTranscriptDelta(sessionInfo));
        disposable.dispose();
        (0, chai_setup_1.expect)(events).to.have.length(1);
        (0, chai_setup_1.expect)(events[0].type).to.equal("transcript-delta");
    });
});
//# sourceMappingURL=conversation-state-machine.unit.test.js.map
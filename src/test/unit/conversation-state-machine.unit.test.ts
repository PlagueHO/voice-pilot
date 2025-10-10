import { ConversationStateMachine, CopilotResponseEvent } from "../../conversation/conversation-state-machine";
import { Logger } from "../../core/logger";
import {
  ConnectionInfo,
  SessionConfig,
  SessionInfo,
  SessionState,
  SessionStatistics,
} from "../../types/session";
import {
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent
} from "../../types/speech-to-text";
import { TtsPlaybackEvent } from "../../types/tts";
import { expect } from "../helpers/chai-setup";
import { afterEach, beforeEach, suite, test } from "../mocha-globals";

function createSessionInfo(): SessionInfo {
  const config: SessionConfig = {
    renewalMarginSeconds: 10,
    inactivityTimeoutMinutes: 5,
    heartbeatIntervalSeconds: 30,
    maxRetryAttempts: 3,
    retryBackoffMs: 1000,
    enableHeartbeat: true,
    enableInactivityTimeout: true,
  };

  const statistics: SessionStatistics = {
    renewalCount: 0,
    failedRenewalCount: 0,
    heartbeatCount: 0,
    inactivityResets: 0,
    totalDurationMs: 0,
    averageRenewalLatencyMs: 0,
  };

  const connectionInfo: ConnectionInfo = {
    webrtcState: "connected",
    reconnectAttempts: 0,
  };

  return {
    sessionId: "session-001",
    state: SessionState.Active,
    startedAt: new Date(),
    lastActivity: new Date(),
    config,
    statistics,
    connectionInfo,
  };
}

function newTimestamp(): string {
  return new Date().toISOString();
}

function buildTranscriptDelta(
  session: SessionInfo,
  overrides: Partial<TranscriptDeltaEvent> = {},
): TranscriptDeltaEvent {
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

function buildTranscriptFinal(
  session: SessionInfo,
  overrides: Partial<TranscriptFinalEvent> = {},
): TranscriptFinalEvent {
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

function buildCopilotEvent(
  status: CopilotResponseEvent["status"],
  overrides: Partial<CopilotResponseEvent> = {},
): CopilotResponseEvent {
  return {
    requestId: overrides.requestId ?? "request-1",
    status,
    timestamp: overrides.timestamp ?? newTimestamp(),
    ...overrides,
  };
}

function buildTtsEvent(
  state: "speaking" | "idle" | "paused" | string,
  type: TtsPlaybackEvent["type"] = "speaking-state-changed",
  overrides: Partial<TtsPlaybackEvent> = {},
): TtsPlaybackEvent {
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
  } as TtsPlaybackEvent;
}

suite("Unit: ConversationStateMachine", () => {
  let logger: Logger;
  let machine: ConversationStateMachine;
  let sessionInfo: SessionInfo;

  beforeEach(async () => {
    logger = new Logger("ConversationStateMachineTest");
    logger.setLevel("debug");
    machine = new ConversationStateMachine({ logger });
    sessionInfo = createSessionInfo();
    await machine.initialize(sessionInfo);
  });

  afterEach(() => {
    machine.dispose();
    logger.dispose();
  });

  test("should transition from idle to listening on start", async () => {
    const transitions: string[] = [];
    const disposable = machine.onStateChanged((event) => {
      transitions.push(`${event.transition.from}->${event.transition.to}`);
    });

    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    disposable.dispose();

    expect(transitions).to.include("idle->preparing");
    expect(transitions).to.include("preparing->listening");
    const state = machine.getState();
    expect(state.state).to.equal("listening");
  });

  test("should ignore duplicate start requests while active", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    const transitions: string[] = [];
    const disposable = machine.onStateChanged((event) => {
      transitions.push(`${event.transition.from}->${event.transition.to}`);
    });

    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    disposable.dispose();

    expect(transitions).to.be.empty;
    expect(machine.getState().state).to.equal("listening");
  });

  test("should append transcript delta and mark user turn active", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    await machine.notifyTranscript(buildTranscriptDelta(sessionInfo));

    const state = machine.getState();
    expect(state.state).to.equal("listening");
    expect(state.turnContext?.turnRole).to.equal("user");
    expect(state.turnContext?.transcript).to.equal("hello");
  });

  test("should enter processing after final transcript", async () => {
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
    expect(state.state).to.equal("processing");
    expect(state.metadata.transcriptId).to.equal("utt-1");
  });

  test("should move to processing when VAD stops speech", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    await machine.notifyTranscriptionStatus({
      type: "transcription-status",
      sessionId: sessionInfo.sessionId,
      status: "speech-stopped",
      timestamp: newTimestamp(),
    });

    const state = machine.getState();
    expect(state.state).to.equal("processing");
    expect(state.metadata.reason).to.equal("Conversation start requested");
  });

  test("should sequence copilot states and speaking transitions", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    await machine.notifyTranscript(buildTranscriptFinal(sessionInfo));

    await machine.notifyCopilot(buildCopilotEvent("pending"));
    expect(machine.getState().state).to.equal("waitingForCopilot");

    await machine.notifyCopilot(
      buildCopilotEvent("completed", { content: "assistant reply" }),
    );
    expect(machine.getState().state).to.equal("processing");

    await machine.notifyTts(buildTtsEvent("speaking"));
    expect(machine.getState().state).to.equal("speaking");

    await machine.notifyTts(buildTtsEvent("idle", "playback-complete"));
    expect(machine.getState().state).to.equal("listening");
  });

  test("should transition to faulted when copilot fails", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    await machine.notifyCopilot(
      buildCopilotEvent("failed", {
        error: { message: "timeout", retryable: false },
      }),
    );

    const state = machine.getState();
    expect(state.state).to.equal("faulted");
    expect(state.metadata.reason).to.equal("timeout");
  });

  test("should emit turn interruption when assistant speaking is interrupted", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    await machine.notifyTranscript(buildTranscriptFinal(sessionInfo));
    await machine.notifyCopilot(
      buildCopilotEvent("completed", { content: "assistant reply" }),
    );
    await machine.notifyTts(buildTtsEvent("speaking"));

    const turnEvents: string[] = [];
    const disposable = machine.onTurnEvent((event) => {
      turnEvents.push(event.type);
    });

    machine.handleUserInterrupt("user-command", "manual barge-in");
    disposable.dispose();

    const state = machine.getState();
    expect(state.state).to.equal("interrupted");
    expect(turnEvents).to.include("turn-interrupted");
    expect(state.metadata.pendingActions).to.deep.equal(["user-command"]);
  });

  test("should restore previous state after suspend resume cycle", async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    machine.suspend("network");
    expect(machine.getState().state).to.equal("suspended");

    machine.resume();
    expect(machine.getState().state).to.equal("listening");
  });

  test("should wire transcript source subscription", async () => {
    const events: TranscriptEvent[] = [];
    const disposable = machine.onTranscriptEvent((event) => {
      events.push(event);
    });

    await machine.startConversation({ sessionId: sessionInfo.sessionId });
    await machine.notifyTranscript(buildTranscriptDelta(sessionInfo));
    disposable.dispose();

    expect(events).to.have.length(1);
    expect(events[0].type).to.equal("transcript-delta");
  });
});

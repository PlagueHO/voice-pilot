import type {
  TranscriptEntry,
  VoiceControlPanelState,
} from "../../../src/ui/voice-control-state";
import {
  MAX_TRANSCRIPT_ENTRIES,
  createInitialPanelState,
  deriveMicrophoneStatusFromState,
  ensureEntryId,
  getElapsedSeconds,
  isSessionActive,
  withTranscriptAppend,
  withTranscriptCommit,
} from "../../../src/ui/voice-control-state";
import { expect } from "../../helpers/chai-setup";
import { afterEach, suite, test } from "../../mocha-globals";

suite("Unit: VoiceControlState", () => {
  const originalDateNow = Date.now;

  afterEach(() => {
    (Date as unknown as { now: () => number }).now = originalDateNow;
  });

  test("createInitialPanelState seeds ready status and defaults", () => {
    const state = createInitialPanelState();

    expect(state.status).to.equal("ready");
    expect(state.statusLabel).to.equal("Ready");
    expect(state.transcript).to.deep.equal([]);
    expect(state.copilotAvailable).to.equal(true);
    expect(state.microphoneStatus).to.equal("idle");
    expect(state.pendingAction).to.equal(null);
    expect(state.fallbackActive).to.equal(false);
  });

  test("withTranscriptAppend appends new entries without truncation", () => {
    const state = createInitialPanelState();
    const entry: TranscriptEntry = {
      entryId: "id-1",
      speaker: "user",
      content: "Hello",
      timestamp: new Date().toISOString(),
      partial: true,
    };

    const { state: nextState, truncated } = withTranscriptAppend(state, entry);

    expect(truncated).to.equal(false);
    expect(nextState.transcript).to.have.length(1);
    expect(nextState.transcript[0]).to.include(entry);
  });

  test("withTranscriptAppend merges existing entry content", () => {
    const baseState = createInitialPanelState();
    const existing: TranscriptEntry = {
      entryId: "merge-id",
      speaker: "agentvoice",
      content: "Partial text",
      timestamp: new Date().toISOString(),
      confidence: 0.3,
      partial: true,
    };
    const state: VoiceControlPanelState = {
      ...baseState,
      transcript: [existing],
    };

    const update: TranscriptEntry = {
      entryId: "merge-id",
      speaker: "agentvoice",
      content: "Final text",
      timestamp: existing.timestamp,
      confidence: 0.92,
      partial: false,
    };

    const { state: nextState, truncated } = withTranscriptAppend(state, update);

    expect(truncated).to.equal(false);
    expect(nextState.transcript).to.have.length(1);
    expect(nextState.transcript[0]).to.deep.equal({
      ...existing,
      ...update,
    });
  });

  test("withTranscriptAppend enforces transcript limit and flags truncation", () => {
    const baseState = createInitialPanelState();
    const seededEntries: TranscriptEntry[] = Array.from(
      { length: MAX_TRANSCRIPT_ENTRIES },
      (_, index) => ({
        entryId: `seed-${index}`,
        speaker: "user",
        content: `Entry ${index}`,
        timestamp: new Date(index + 1).toISOString(),
      }),
    );
    const state: VoiceControlPanelState = {
      ...baseState,
      transcript: seededEntries,
    };

    const newEntry: TranscriptEntry = {
      entryId: "new-entry",
      speaker: "copilot",
      content: "Latest entry",
      timestamp: new Date(MAX_TRANSCRIPT_ENTRIES + 1).toISOString(),
    };

    const { state: nextState, truncated } = withTranscriptAppend(state, newEntry);

    expect(truncated).to.equal(true);
    expect(nextState.truncated).to.equal(true);
    expect(nextState.transcript).to.have.length(MAX_TRANSCRIPT_ENTRIES);
    expect(nextState.transcript[0].entryId).to.equal("seed-1");
    expect(nextState.transcript[nextState.transcript.length - 1]).to.deep.equal(
      newEntry,
    );
  });

  test("withTranscriptAppend preserves prior truncation state when no new truncation occurs", () => {
    const state: VoiceControlPanelState = {
      ...createInitialPanelState(),
      transcript: [],
      truncated: true,
    };

    const entry: TranscriptEntry = {
      entryId: "id-keep-truncated",
      speaker: "user",
      content: "No truncation",
      timestamp: new Date().toISOString(),
    };

    const { state: nextState, truncated } = withTranscriptAppend(state, entry);

    expect(truncated).to.equal(false);
    expect(nextState.truncated).to.equal(true);
  });

  test("withTranscriptCommit replaces partial content with finalized text", () => {
    const partialEntry: TranscriptEntry = {
      entryId: "commit-id",
      speaker: "user",
      content: "Working text",
      timestamp: new Date().toISOString(),
      partial: true,
    };
    const state: VoiceControlPanelState = {
      ...createInitialPanelState(),
      transcript: [partialEntry],
    };

    const nextState = withTranscriptCommit(
      state,
      "commit-id",
      "Finished text",
      0.87,
    );

    expect(nextState.transcript[0]).to.deep.equal({
      ...partialEntry,
      content: "Finished text",
      confidence: 0.87,
      partial: false,
    });
  });

  test("ensureEntryId reuses existing identifier", () => {
    const entry: Partial<TranscriptEntry> = { entryId: "existing" };

    expect(ensureEntryId(entry)).to.equal("existing");
  });

  test("ensureEntryId generates identifier when missing", () => {
    const generated = ensureEntryId({});

    expect(generated).to.be.a("string");
    expect(generated).to.have.length.greaterThan(0);
  });

  test("getElapsedSeconds returns undefined for missing or invalid timestamps", () => {
    expect(getElapsedSeconds()).to.be.undefined;
    expect(getElapsedSeconds("not-a-date")).to.be.undefined;
  });

  test("getElapsedSeconds returns whole seconds difference", () => {
    const start = new Date("2024-01-01T00:00:00.000Z").toISOString();
    const expectedElapsed = 9;
    const nowMillis =
      new Date("2024-01-01T00:00:09.950Z").getTime();

    (Date as unknown as { now: () => number }).now = () => nowMillis;

    const elapsed = getElapsedSeconds(start);

    expect(elapsed).to.equal(expectedElapsed);
  });

  test("isSessionActive reports true when session is in progress", () => {
    const state: VoiceControlPanelState = {
      ...createInitialPanelState(),
      sessionId: "session-123",
      status: "listening",
    };

    expect(isSessionActive(state)).to.equal(true);
  });

  test("isSessionActive reports false when session missing or idle", () => {
    const idleState = createInitialPanelState();
    const errorState: VoiceControlPanelState = {
      ...createInitialPanelState(),
      sessionId: "session-err",
      status: "error",
    };

    expect(isSessionActive(idleState)).to.equal(false);
    expect(isSessionActive(errorState)).to.equal(false);
  });

  test("deriveMicrophoneStatusFromState reflects session context", () => {
    const idleStatus = deriveMicrophoneStatusFromState(
      createInitialPanelState(),
    );
    const speakingState: VoiceControlPanelState = {
      ...createInitialPanelState(),
      sessionId: "abc",
      status: "speaking",
    };
    const speakingStatus = deriveMicrophoneStatusFromState(speakingState);
    const errorState: VoiceControlPanelState = {
      ...createInitialPanelState(),
      sessionId: "def",
      status: "error",
      microphoneStatus: "permission-denied",
    };
    const errorStatus = deriveMicrophoneStatusFromState(errorState);
    const defaultState: VoiceControlPanelState = {
      ...createInitialPanelState(),
      sessionId: "ghi",
      status: "thinking",
    };
    const defaultStatus = deriveMicrophoneStatusFromState(defaultState);

    expect(idleStatus).to.equal("idle");
    expect(speakingStatus).to.equal("muted");
    expect(errorStatus).to.equal("permission-denied");
    expect(defaultStatus).to.equal("capturing");
  });
});

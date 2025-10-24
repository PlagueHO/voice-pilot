"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const voice_control_state_1 = require("../../src/../ui/voice-control-state");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)("Unit: VoiceControlState", () => {
    const originalDateNow = Date.now;
    (0, mocha_globals_1.afterEach)(() => {
        Date.now = originalDateNow;
    });
    (0, mocha_globals_1.test)("createInitialPanelState seeds ready status and defaults", () => {
        const state = (0, voice_control_state_1.createInitialPanelState)();
        (0, chai_setup_1.expect)(state.status).to.equal("ready");
        (0, chai_setup_1.expect)(state.statusLabel).to.equal("Ready");
        (0, chai_setup_1.expect)(state.transcript).to.deep.equal([]);
        (0, chai_setup_1.expect)(state.copilotAvailable).to.equal(true);
        (0, chai_setup_1.expect)(state.microphoneStatus).to.equal("idle");
        (0, chai_setup_1.expect)(state.pendingAction).to.equal(null);
        (0, chai_setup_1.expect)(state.fallbackActive).to.equal(false);
    });
    (0, mocha_globals_1.test)("withTranscriptAppend appends new entries without truncation", () => {
        const state = (0, voice_control_state_1.createInitialPanelState)();
        const entry = {
            entryId: "id-1",
            speaker: "user",
            content: "Hello",
            timestamp: new Date().toISOString(),
            partial: true,
        };
        const { state: nextState, truncated } = (0, voice_control_state_1.withTranscriptAppend)(state, entry);
        (0, chai_setup_1.expect)(truncated).to.equal(false);
        (0, chai_setup_1.expect)(nextState.transcript).to.have.length(1);
        (0, chai_setup_1.expect)(nextState.transcript[0]).to.include(entry);
    });
    (0, mocha_globals_1.test)("withTranscriptAppend merges existing entry content", () => {
        const baseState = (0, voice_control_state_1.createInitialPanelState)();
        const existing = {
            entryId: "merge-id",
            speaker: "voicepilot",
            content: "Partial text",
            timestamp: new Date().toISOString(),
            confidence: 0.3,
            partial: true,
        };
        const state = {
            ...baseState,
            transcript: [existing],
        };
        const update = {
            entryId: "merge-id",
            speaker: "voicepilot",
            content: "Final text",
            timestamp: existing.timestamp,
            confidence: 0.92,
            partial: false,
        };
        const { state: nextState, truncated } = (0, voice_control_state_1.withTranscriptAppend)(state, update);
        (0, chai_setup_1.expect)(truncated).to.equal(false);
        (0, chai_setup_1.expect)(nextState.transcript).to.have.length(1);
        (0, chai_setup_1.expect)(nextState.transcript[0]).to.deep.equal({
            ...existing,
            ...update,
        });
    });
    (0, mocha_globals_1.test)("withTranscriptAppend enforces transcript limit and flags truncation", () => {
        const baseState = (0, voice_control_state_1.createInitialPanelState)();
        const seededEntries = Array.from({ length: voice_control_state_1.MAX_TRANSCRIPT_ENTRIES }, (_, index) => ({
            entryId: `seed-${index}`,
            speaker: "user",
            content: `Entry ${index}`,
            timestamp: new Date(index + 1).toISOString(),
        }));
        const state = {
            ...baseState,
            transcript: seededEntries,
        };
        const newEntry = {
            entryId: "new-entry",
            speaker: "copilot",
            content: "Latest entry",
            timestamp: new Date(voice_control_state_1.MAX_TRANSCRIPT_ENTRIES + 1).toISOString(),
        };
        const { state: nextState, truncated } = (0, voice_control_state_1.withTranscriptAppend)(state, newEntry);
        (0, chai_setup_1.expect)(truncated).to.equal(true);
        (0, chai_setup_1.expect)(nextState.truncated).to.equal(true);
        (0, chai_setup_1.expect)(nextState.transcript).to.have.length(voice_control_state_1.MAX_TRANSCRIPT_ENTRIES);
        (0, chai_setup_1.expect)(nextState.transcript[0].entryId).to.equal("seed-1");
        (0, chai_setup_1.expect)(nextState.transcript[nextState.transcript.length - 1]).to.deep.equal(newEntry);
    });
    (0, mocha_globals_1.test)("withTranscriptAppend preserves prior truncation state when no new truncation occurs", () => {
        const state = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            transcript: [],
            truncated: true,
        };
        const entry = {
            entryId: "id-keep-truncated",
            speaker: "user",
            content: "No truncation",
            timestamp: new Date().toISOString(),
        };
        const { state: nextState, truncated } = (0, voice_control_state_1.withTranscriptAppend)(state, entry);
        (0, chai_setup_1.expect)(truncated).to.equal(false);
        (0, chai_setup_1.expect)(nextState.truncated).to.equal(true);
    });
    (0, mocha_globals_1.test)("withTranscriptCommit replaces partial content with finalized text", () => {
        const partialEntry = {
            entryId: "commit-id",
            speaker: "user",
            content: "Working text",
            timestamp: new Date().toISOString(),
            partial: true,
        };
        const state = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            transcript: [partialEntry],
        };
        const nextState = (0, voice_control_state_1.withTranscriptCommit)(state, "commit-id", "Finished text", 0.87);
        (0, chai_setup_1.expect)(nextState.transcript[0]).to.deep.equal({
            ...partialEntry,
            content: "Finished text",
            confidence: 0.87,
            partial: false,
        });
    });
    (0, mocha_globals_1.test)("ensureEntryId reuses existing identifier", () => {
        const entry = { entryId: "existing" };
        (0, chai_setup_1.expect)((0, voice_control_state_1.ensureEntryId)(entry)).to.equal("existing");
    });
    (0, mocha_globals_1.test)("ensureEntryId generates identifier when missing", () => {
        const generated = (0, voice_control_state_1.ensureEntryId)({});
        (0, chai_setup_1.expect)(generated).to.be.a("string");
        (0, chai_setup_1.expect)(generated).to.have.length.greaterThan(0);
    });
    (0, mocha_globals_1.test)("getElapsedSeconds returns undefined for missing or invalid timestamps", () => {
        (0, chai_setup_1.expect)((0, voice_control_state_1.getElapsedSeconds)()).to.be.undefined;
        (0, chai_setup_1.expect)((0, voice_control_state_1.getElapsedSeconds)("not-a-date")).to.be.undefined;
    });
    (0, mocha_globals_1.test)("getElapsedSeconds returns whole seconds difference", () => {
        const start = new Date("2024-01-01T00:00:00.000Z").toISOString();
        const expectedElapsed = 9;
        const nowMillis = new Date("2024-01-01T00:00:09.950Z").getTime();
        Date.now = () => nowMillis;
        const elapsed = (0, voice_control_state_1.getElapsedSeconds)(start);
        (0, chai_setup_1.expect)(elapsed).to.equal(expectedElapsed);
    });
    (0, mocha_globals_1.test)("isSessionActive reports true when session is in progress", () => {
        const state = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            sessionId: "session-123",
            status: "listening",
        };
        (0, chai_setup_1.expect)((0, voice_control_state_1.isSessionActive)(state)).to.equal(true);
    });
    (0, mocha_globals_1.test)("isSessionActive reports false when session missing or idle", () => {
        const idleState = (0, voice_control_state_1.createInitialPanelState)();
        const errorState = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            sessionId: "session-err",
            status: "error",
        };
        (0, chai_setup_1.expect)((0, voice_control_state_1.isSessionActive)(idleState)).to.equal(false);
        (0, chai_setup_1.expect)((0, voice_control_state_1.isSessionActive)(errorState)).to.equal(false);
    });
    (0, mocha_globals_1.test)("deriveMicrophoneStatusFromState reflects session context", () => {
        const idleStatus = (0, voice_control_state_1.deriveMicrophoneStatusFromState)((0, voice_control_state_1.createInitialPanelState)());
        const speakingState = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            sessionId: "abc",
            status: "speaking",
        };
        const speakingStatus = (0, voice_control_state_1.deriveMicrophoneStatusFromState)(speakingState);
        const errorState = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            sessionId: "def",
            status: "error",
            microphoneStatus: "permission-denied",
        };
        const errorStatus = (0, voice_control_state_1.deriveMicrophoneStatusFromState)(errorState);
        const defaultState = {
            ...(0, voice_control_state_1.createInitialPanelState)(),
            sessionId: "ghi",
            status: "thinking",
        };
        const defaultStatus = (0, voice_control_state_1.deriveMicrophoneStatusFromState)(defaultState);
        (0, chai_setup_1.expect)(idleStatus).to.equal("idle");
        (0, chai_setup_1.expect)(speakingStatus).to.equal("muted");
        (0, chai_setup_1.expect)(errorStatus).to.equal("permission-denied");
        (0, chai_setup_1.expect)(defaultStatus).to.equal("capturing");
    });
});
//# sourceMappingURL=voice-control-state.unit.test.js.map
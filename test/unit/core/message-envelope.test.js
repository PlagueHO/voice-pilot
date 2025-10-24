"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const message_envelope_1 = require("../../src/../core/message-envelope");
const mocha_globals_1 = require("../../src/mocha-globals");
function buildUiSessionStatePayload() {
    return {
        sessionId: null,
        status: "ready",
        statusLabel: "Ready",
        statusMode: null,
        statusDetail: null,
        fallbackActive: false,
        sessionStartedAt: null,
        elapsedSeconds: null,
        renewalCountdownSeconds: null,
        copilotAvailable: true,
        pendingAction: null,
        microphoneStatus: "idle",
        transcript: [],
        truncated: false,
        diagnostics: null,
        error: null,
        audioFeedback: null,
    };
}
(0, mocha_globals_1.suite)("Unit: MessageEnvelope", () => {
    (0, mocha_globals_1.test)("createEnvelope assigns identifiers and validates payload", () => {
        const payload = buildUiSessionStatePayload();
        const envelope = (0, message_envelope_1.createEnvelope)({
            type: "ui.session.state",
            version: "1.1.0",
            source: "host",
            payload,
        });
        (0, chai_1.expect)(envelope.id).to.be.a("string").and.not.empty;
        (0, chai_1.expect)(envelope.timestamp).to.be.a("string");
        (0, chai_1.expect)(envelope.payload).to.deep.equal(payload);
    });
    (0, mocha_globals_1.test)("validateEnvelope rejects unknown message types by default", () => {
        const envelope = {
            id: "00000000-0000-0000-0000-000000000001",
            type: "custom.unknown",
            version: "1.0.0",
            timestamp: new Date().toISOString(),
            source: "host",
            payload: {},
        };
        (0, chai_1.expect)(() => (0, message_envelope_1.validateEnvelope)(envelope)).to.throw(message_envelope_1.MessageValidationError);
    });
    (0, mocha_globals_1.test)("chunkEnvelopePayload returns single envelope when within limit", () => {
        const envelope = (0, message_envelope_1.createEnvelope)({
            type: "ui.session.state",
            version: "1.1.0",
            source: "host",
            payload: buildUiSessionStatePayload(),
        });
        const result = (0, message_envelope_1.chunkEnvelopePayload)(envelope, {
            maxBytes: message_envelope_1.MessageEnvelopeUtils.MAX_BYTES,
        });
        (0, chai_1.expect)(result).to.have.length(1);
        (0, chai_1.expect)(result[0]).to.deep.equal(envelope);
    });
    (0, mocha_globals_1.test)("chunkEnvelopePayload splits oversized envelopes", () => {
        const payload = {
            ...buildUiSessionStatePayload(),
            transcript: [
                {
                    entryId: "entry-1",
                    speaker: "user",
                    content: "a".repeat(1024),
                    timestamp: new Date().toISOString(),
                },
            ],
        };
        const envelope = (0, message_envelope_1.createEnvelope)({
            type: "ui.session.state",
            version: "1.1.0",
            source: "host",
            payload,
            correlationId: "11111111-1111-1111-1111-111111111111",
        });
        const chunks = (0, message_envelope_1.chunkEnvelopePayload)(envelope, { maxBytes: 256 });
        (0, chai_1.expect)(chunks.length).to.be.greaterThan(1);
        chunks.forEach((chunk, index) => {
            (0, chai_1.expect)(chunk.type).to.equal("transport.chunk");
            (0, chai_1.expect)(chunk.source).to.equal("host");
            (0, chai_1.expect)(chunk.sequence).to.equal(index);
            (0, chai_1.expect)(chunk.correlationId).to.equal(envelope.correlationId);
        });
        const reassembled = (0, message_envelope_1.reassembleChunks)(chunks);
        (0, chai_1.expect)(reassembled).to.not.be.null;
        (0, chai_1.expect)(reassembled?.type).to.equal("ui.session.state");
    });
    (0, mocha_globals_1.test)("chunkEnvelopePayload throws when configured with invalid limit", () => {
        const envelope = (0, message_envelope_1.createEnvelope)({
            type: "ui.session.state",
            version: "1.1.0",
            source: "host",
            payload: buildUiSessionStatePayload(),
        });
        (0, chai_1.expect)(() => (0, message_envelope_1.chunkEnvelopePayload)(envelope, { maxBytes: 0 })).to.throw(message_envelope_1.MessageValidationError);
    });
});
//# sourceMappingURL=message-envelope.test.js.map
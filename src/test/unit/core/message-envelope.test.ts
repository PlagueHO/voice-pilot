import { expect } from "chai";
import {
  chunkEnvelopePayload,
  createEnvelope,
  MessageEnvelope,
  MessageEnvelopeUtils,
  MessageValidationError,
  reassembleChunks,
  validateEnvelope,
  type TransportChunkPayload,
} from "../../../core/message-envelope";
import { suite, test } from "../../mocha-globals";

interface UiSessionStatePayload {
  sessionId: string | null;
  status: string;
  statusLabel: string;
  statusMode: string | null;
  statusDetail: string | null;
  fallbackActive: boolean;
  sessionStartedAt: string | null;
  elapsedSeconds: number | null;
  renewalCountdownSeconds: number | null;
  copilotAvailable: boolean;
  pendingAction: string | null;
  microphoneStatus: string;
  transcript: Array<{
    entryId: string;
    speaker: string;
    content: string;
    timestamp: string;
    confidence?: number;
    partial?: boolean;
  }>;
  truncated: boolean;
  diagnostics: unknown;
  error: unknown;
  audioFeedback: unknown;
}

function buildUiSessionStatePayload(): UiSessionStatePayload {
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
  } as UiSessionStatePayload;
}

suite("Unit: MessageEnvelope", () => {
  test("createEnvelope assigns identifiers and validates payload", () => {
    const payload = buildUiSessionStatePayload();
    const envelope = createEnvelope({
      type: "ui.session.state",
      version: "1.1.0",
      source: "host",
      payload,
    });

    expect(envelope.id).to.be.a("string").and.not.empty;
    expect(envelope.timestamp).to.be.a("string");
    expect(envelope.payload).to.deep.equal(payload);
  });

  test("validateEnvelope rejects unknown message types by default", () => {
    const envelope = {
      id: "00000000-0000-0000-0000-000000000001",
      type: "custom.unknown",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
  source: "host",
      payload: {},
    };

    expect(() => validateEnvelope(envelope)).to.throw(MessageValidationError);
  });

  test("chunkEnvelopePayload returns single envelope when within limit", () => {
    const envelope = createEnvelope({
      type: "ui.session.state",
      version: "1.1.0",
      source: "host",
      payload: buildUiSessionStatePayload(),
    });

    const result = chunkEnvelopePayload(envelope, {
      maxBytes: MessageEnvelopeUtils.MAX_BYTES,
    });

    expect(result).to.have.length(1);
    expect(result[0]).to.deep.equal(envelope);
  });

  test("chunkEnvelopePayload splits oversized envelopes", () => {
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
    } as UiSessionStatePayload;

    const envelope = createEnvelope({
      type: "ui.session.state",
      version: "1.1.0",
      source: "host",
      payload,
      correlationId: "11111111-1111-1111-1111-111111111111",
    });

    const chunks = chunkEnvelopePayload(envelope, { maxBytes: 256 });

    expect(chunks.length).to.be.greaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.type).to.equal("transport.chunk");
      expect(chunk.source).to.equal("host");
      expect(chunk.sequence).to.equal(index);
      expect(chunk.correlationId).to.equal(envelope.correlationId);
    });

    const reassembled = reassembleChunks(
      chunks as Array<MessageEnvelope<TransportChunkPayload>>,
    );
    expect(reassembled).to.not.be.null;
    expect(reassembled?.type).to.equal("ui.session.state");
  });

  test("chunkEnvelopePayload throws when configured with invalid limit", () => {
    const envelope = createEnvelope({
      type: "ui.session.state",
      version: "1.1.0",
      source: "host",
      payload: buildUiSessionStatePayload(),
    });

    expect(() => chunkEnvelopePayload(envelope, { maxBytes: 0 })).to.throw(
      MessageValidationError,
    );
  });
});

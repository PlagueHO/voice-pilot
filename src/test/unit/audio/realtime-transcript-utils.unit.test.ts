import * as assert from "assert";
import {
    extractTranscriptText,
    getTextFromDelta,
} from "../../../audio/realtime-transcript-utils";
import type { RealtimeEvent } from "../../../types/realtime-events";

describe("realtime-transcript-utils", () => {
  it("returns string payloads unchanged", () => {
    const event: RealtimeEvent = {
      type: "response.audio_transcript.delta",
      delta: "hello world",
    };

    const result = extractTranscriptText(event);
    assert.strictEqual(result, "hello world");
  });

  it("extracts text field from object delta", () => {
    const event: RealtimeEvent = {
      type: "response.output_audio_transcription.delta",
      delta: {
        text: "normalized text",
        confidence: 0.87,
      },
    };

    const result = extractTranscriptText(event);
    assert.strictEqual(result, "normalized text");
  });

  it("falls back to transcript field when text missing", () => {
    const event: RealtimeEvent = {
      type: "conversation.item.audio_transcription.delta",
      delta: {
        transcript: "fallback content",
      },
    };

    const result = extractTranscriptText(event);
    assert.strictEqual(result, "fallback content");
  });

  it("returns undefined when payload lacks text", () => {
    const event: RealtimeEvent = {
      type: "response.output_audio_transcript.delta",
      delta: {
        confidence: 0.45,
      },
    };

    const result = extractTranscriptText(event);
    assert.strictEqual(result, undefined);
  });

  it("supports direct string lookup via getTextFromDelta", () => {
    const result = getTextFromDelta({
      text: "direct lookup",
    });

    assert.strictEqual(result, "direct lookup");
  });
});

import {
    extractTranscriptText,
    getTextFromDelta,
} from "../../../src/audio/realtime-transcript-utils";
import type { RealtimeEvent } from "../../../src/types/realtime-events";
import { expect } from "../../helpers/chai-setup";
import { suite, test } from "../../mocha-globals";

suite("Unit: realtime-transcript-utils", () => {
  test("returns string payloads unchanged", () => {
    const event: RealtimeEvent = {
      type: "response.audio_transcript.delta",
      delta: "hello world",
    };

    const result = extractTranscriptText(event);
    expect(result).to.equal("hello world");
  });

  test("extracts text field from object delta", () => {
    const event: RealtimeEvent = {
      type: "response.output_audio_transcription.delta",
      delta: {
        text: "normalized text",
        confidence: 0.87,
      },
    };

    const result = extractTranscriptText(event);
    expect(result).to.equal("normalized text");
  });

  test("falls back to transcript field when text missing", () => {
    const event: RealtimeEvent = {
      type: "conversation.item.audio_transcription.delta",
      delta: {
        transcript: "fallback content",
      },
    };

    const result = extractTranscriptText(event);
    expect(result).to.equal("fallback content");
  });

  test("returns undefined when payload lacks text", () => {
    const event: RealtimeEvent = {
      type: "response.output_audio_transcript.delta",
      delta: {
        confidence: 0.45,
      },
    };

    const result = extractTranscriptText(event);
  expect(result).to.be.undefined;
  });

  test("supports direct string lookup via getTextFromDelta", () => {
    const result = getTextFromDelta({
      text: "direct lookup",
    });

    expect(result).to.equal("direct lookup");
  });
});

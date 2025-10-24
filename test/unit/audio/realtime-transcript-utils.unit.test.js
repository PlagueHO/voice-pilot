"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const realtime_transcript_utils_1 = require("../../src/../audio/realtime-transcript-utils");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)("Unit: realtime-transcript-utils", () => {
    (0, mocha_globals_1.test)("returns string payloads unchanged", () => {
        const event = {
            type: "response.audio_transcript.delta",
            delta: "hello world",
        };
        const result = (0, realtime_transcript_utils_1.extractTranscriptText)(event);
        (0, chai_setup_1.expect)(result).to.equal("hello world");
    });
    (0, mocha_globals_1.test)("extracts text field from object delta", () => {
        const event = {
            type: "response.output_audio_transcription.delta",
            delta: {
                text: "normalized text",
                confidence: 0.87,
            },
        };
        const result = (0, realtime_transcript_utils_1.extractTranscriptText)(event);
        (0, chai_setup_1.expect)(result).to.equal("normalized text");
    });
    (0, mocha_globals_1.test)("falls back to transcript field when text missing", () => {
        const event = {
            type: "conversation.item.audio_transcription.delta",
            delta: {
                transcript: "fallback content",
            },
        };
        const result = (0, realtime_transcript_utils_1.extractTranscriptText)(event);
        (0, chai_setup_1.expect)(result).to.equal("fallback content");
    });
    (0, mocha_globals_1.test)("returns undefined when payload lacks text", () => {
        const event = {
            type: "response.output_audio_transcript.delta",
            delta: {
                confidence: 0.45,
            },
        };
        const result = (0, realtime_transcript_utils_1.extractTranscriptText)(event);
        (0, chai_setup_1.expect)(result).to.be.undefined;
    });
    (0, mocha_globals_1.test)("supports direct string lookup via getTextFromDelta", () => {
        const result = (0, realtime_transcript_utils_1.getTextFromDelta)({
            text: "direct lookup",
        });
        (0, chai_setup_1.expect)(result).to.equal("direct lookup");
    });
});
//# sourceMappingURL=realtime-transcript-utils.unit.test.js.map
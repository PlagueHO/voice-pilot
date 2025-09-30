// @ts-nocheck
import * as assert from "assert";
import { RealtimeSpeechToTextService } from "../../../services/realtime-speech-to-text-service";
import type {
  ResponseAudioTranscriptDeltaEvent,
  ResponseDoneEvent,
  ResponseOutputAudioTranscriptDeltaEvent,
  ResponseOutputTextDeltaEvent,
  ResponseOutputTextDoneEvent,
  ResponseTextDeltaEvent
} from "../../../types/realtime-events";
import type {
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent,
} from "../../../types/speech-to-text";

describe("RealtimeSpeechToTextService - Unit Tests", () => {
  let service: RealtimeSpeechToTextService;
  const testSessionId = "test-session-123";
  const testResponseId = "resp-456";
  const testItemId = "item-789";

  beforeEach(async () => {
    service = new RealtimeSpeechToTextService();
    await service.initialize(testSessionId);
  });

  afterEach(() => {
    service.dispose();
  });

  describe("Initialization and Lifecycle", () => {
    it("should initialize successfully with session ID", async () => {
      const newService = new RealtimeSpeechToTextService();
      await newService.initialize("session-xyz");

      assert.strictEqual(newService.isInitialized(), true);
      newService.dispose();
    });

    it("should allow setting session ID after initialization", () => {
      service.setSessionId("new-session-456");
      // No error should be thrown
      assert.ok(true);
    });

    it("should dispose cleanly and clear state", () => {
      service.dispose();
      assert.strictEqual(service.isInitialized(), false);
      assert.strictEqual(service.getActiveUtterances().length, 0);
    });

    it("should throw error when ingesting events before initialization", async () => {
      const uninitializedService = new RealtimeSpeechToTextService();
      const event: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "test",
      };

      assert.throws(
        () => uninitializedService.ingestRealtimeEvent(event),
        /must be initialized/,
      );
    });
  });

  describe("Delta Aggregation", () => {
    it("should aggregate text deltas from response.output_text.delta events", () => {
      const receivedEvents: TranscriptEvent[] = [];
  service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Hello ",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "World!",
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      assert.strictEqual(receivedEvents.length, 2);
      assert.strictEqual(receivedEvents[0].type, "transcript-delta");
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).delta, "Hello ");
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).content, "Hello ");
      assert.strictEqual(receivedEvents[1].type, "transcript-delta");
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).delta, "World!");
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).content, "Hello World!");
    });

    it("should aggregate audio transcript deltas from response.output_audio_transcript.delta events", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => {
        receivedEvents.push(event);
      });

      const delta1: ResponseOutputAudioTranscriptDeltaEvent = {
        type: "response.output_audio_transcript.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: { transcript: "This is " },
      };

      const delta2: ResponseOutputAudioTranscriptDeltaEvent = {
        type: "response.output_audio_transcript.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: { transcript: "a test" },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      assert.strictEqual(receivedEvents.length, 2);
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).content, "This is ");
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).content, "This is a test");
    });

    it("should handle legacy response.text.delta events", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseTextDeltaEvent = {
        type: "response.text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        content_index: 0,
        delta: "Legacy delta",
      };

      service.ingestRealtimeEvent(delta);

      assert.strictEqual(receivedEvents.length, 1);
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).content, "Legacy delta");
    });

    it("should handle legacy response.audio_transcript.delta events", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseAudioTranscriptDeltaEvent = {
        type: "response.audio_transcript.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        content_index: 0,
        delta: { text: "Legacy audio" },
      };

      service.ingestRealtimeEvent(delta);

      assert.strictEqual(receivedEvents.length, 1);
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).content, "Legacy audio");
    });

    it("should track chunk count in metadata", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "First ",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Second ",
      };

      const delta3: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Third",
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(delta3);

      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).metadata.chunkCount, 1);
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).metadata.chunkCount, 2);
      assert.strictEqual((receivedEvents[2] as TranscriptDeltaEvent).metadata.chunkCount, 3);
    });

    it("should assign unique utterance IDs based on response_id and item_id", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-1",
        item_id: "item-1",
        output_index: 0,
        delta: "First utterance",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-2",
        item_id: "item-2",
        output_index: 0,
        delta: "Second utterance",
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).utteranceId, "resp-1-item-1");
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).utteranceId, "resp-2-item-2");
    });
  });

  describe("Finalization on response.done", () => {
    it("should finalize all utterances for a response when response.done is received", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Complete message",
      };

      const done: ResponseDoneEvent = {
        type: "response.done",
        response: {
          id: testResponseId,
          object: "realtime.response",
          status: "completed",
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta);
      assert.strictEqual(service.getActiveUtterances().length, 1);

      service.ingestRealtimeEvent(done);

      // Should have delta event + final event
      assert.strictEqual(receivedEvents.length, 2);
      assert.strictEqual(receivedEvents[0].type, "transcript-delta");
      assert.strictEqual(receivedEvents[1].type, "transcript-final");

      const finalEvent = receivedEvents[1] as TranscriptFinalEvent;
      assert.strictEqual(finalEvent.utteranceId, `${testResponseId}-${testItemId}`);
      assert.strictEqual(finalEvent.content, "Complete message");
      assert.strictEqual(finalEvent.sessionId, testSessionId);

      // Active utterances should be cleared after finalization
      assert.strictEqual(service.getActiveUtterances().length, 0);
    });

    it("should finalize multiple utterances from the same response", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: "item-1",
        output_index: 0,
        delta: "First item",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: "item-2",
        output_index: 0,
        delta: "Second item",
      };

      const done: ResponseDoneEvent = {
        type: "response.done",
        response: {
          id: testResponseId,
          object: "realtime.response",
          status: "completed",
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(done);

      // Should have 2 delta + 2 final events
      assert.strictEqual(receivedEvents.length, 4);
      const finalEvents = receivedEvents.filter(
        (e) => e.type === "transcript-final",
      ) as TranscriptFinalEvent[];
      assert.strictEqual(finalEvents.length, 2);

      assert.ok(
        finalEvents.some((e) => e.content === "First item"),
        "Should finalize first item",
      );
      assert.ok(
        finalEvents.some((e) => e.content === "Second item"),
        "Should finalize second item",
      );

      assert.strictEqual(service.getActiveUtterances().length, 0);
    });

    it("should not finalize utterances from other responses", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-1",
        item_id: testItemId,
        output_index: 0,
        delta: "Response 1",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-2",
        item_id: testItemId,
        output_index: 0,
        delta: "Response 2",
      };

      const done: ResponseDoneEvent = {
        type: "response.done",
        response: {
          id: "resp-1",
          object: "realtime.response",
          status: "completed",
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(done);

      // Only resp-1 should be finalized
      const finalEvents = receivedEvents.filter(
        (e) => e.type === "transcript-final",
      ) as TranscriptFinalEvent[];
      assert.strictEqual(finalEvents.length, 1);
      assert.strictEqual(finalEvents[0].content, "Response 1");

      // resp-2 should still be active
      const activeUtterances = service.getActiveUtterances();
      assert.strictEqual(activeUtterances.length, 1);
      assert.strictEqual(activeUtterances[0].content, "Response 2");
    });

    it("should set endOffsetMs in metadata when finalizing", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Test",
      };

      const done: ResponseDoneEvent = {
        type: "response.done",
        response: {
          id: testResponseId,
          object: "realtime.response",
          status: "completed",
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta);
      service.ingestRealtimeEvent(done);

      const finalEvent = receivedEvents.find(
        (e) => e.type === "transcript-final",
      ) as TranscriptFinalEvent;
      assert.ok(finalEvent);
      assert.ok(
        finalEvent.metadata.endOffsetMs !== undefined,
        "Should set endOffsetMs",
      );
      assert.ok(
        finalEvent.metadata.endOffsetMs! > 0,
        "endOffsetMs should be positive",
      );
    });

    it("should finalize utterances on response.output_text.done events", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Partial content",
      };

      const done: ResponseOutputTextDoneEvent = {
        type: "response.output_text.done",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        text: "Finalized content",
      };

      service.ingestRealtimeEvent(delta);
      service.ingestRealtimeEvent(done);

      const finalEvents = receivedEvents.filter(
        (event) => event.type === "transcript-final",
      ) as TranscriptFinalEvent[];

      assert.strictEqual(finalEvents.length, 1);
      assert.strictEqual(finalEvents[0].content, "Finalized content");
      assert.strictEqual(finalEvents[0].utteranceId, `${testResponseId}-${testItemId}`);
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed events with missing delta gracefully", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const malformedEvent: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: undefined as any,
      };

      // Should not throw, just log warning
      service.ingestRealtimeEvent(malformedEvent);

      // No events should be emitted
      assert.strictEqual(receivedEvents.length, 0);
    });

    it("should handle events without session ID by logging warning", async () => {
      const serviceWithoutSession = new RealtimeSpeechToTextService();
      await serviceWithoutSession.initialize(); // No session ID

      const receivedEvents: TranscriptEvent[] = [];
      serviceWithoutSession.subscribeTranscript((event) =>
        { receivedEvents.push(event); }
      );

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Test",
      };

      // Should log warning and ignore event
      serviceWithoutSession.ingestRealtimeEvent(delta);

      assert.strictEqual(receivedEvents.length, 0);
      serviceWithoutSession.dispose();
    });

    it("should ignore unsupported event types without errors", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const unsupportedEvent = {
        type: "session.updated",
        session: {},
      };

      // Should not throw
      service.ingestRealtimeEvent(unsupportedEvent as any);

      // No transcript events should be emitted
      assert.strictEqual(receivedEvents.length, 0);
    });

    it("should handle delta extraction from various payload formats", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      // String delta
      const stringDelta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: "item-1",
        output_index: 0,
        delta: "String delta",
      };

      // Object with text property
      const textDelta: ResponseOutputAudioTranscriptDeltaEvent = {
        type: "response.output_audio_transcript.delta",
        response_id: testResponseId,
        item_id: "item-2",
        output_index: 0,
        delta: { text: "Text property" },
      };

      // Object with transcript property
      const transcriptDelta: ResponseOutputAudioTranscriptDeltaEvent = {
        type: "response.output_audio_transcript.delta",
        response_id: testResponseId,
        item_id: "item-3",
        output_index: 0,
        delta: { transcript: "Transcript property" },
      };

      service.ingestRealtimeEvent(stringDelta);
      service.ingestRealtimeEvent(textDelta);
      service.ingestRealtimeEvent(transcriptDelta);

      assert.strictEqual(receivedEvents.length, 3);
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).content, "String delta");
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).content, "Text property");
      assert.strictEqual(
        (receivedEvents[2] as TranscriptDeltaEvent).content,
        "Transcript property",
      );
    });
  });

  describe("Active Utterances Management", () => {
    it("should track active utterances before finalization", () => {
      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-1",
        item_id: "item-1",
        output_index: 0,
        delta: "First",
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: "resp-2",
        item_id: "item-2",
        output_index: 0,
        delta: "Second",
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      const active = service.getActiveUtterances();
      assert.strictEqual(active.length, 2);
      assert.ok(active.some((u) => u.content === "First"));
      assert.ok(active.some((u) => u.content === "Second"));
    });

    it("should clear all active utterances when clearActiveUtterances is called", () => {
      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Test content",
      };

      service.ingestRealtimeEvent(delta);
      assert.strictEqual(service.getActiveUtterances().length, 1);

      service.clearActiveUtterances();

      assert.strictEqual(service.getActiveUtterances().length, 0);
    });

    it("should reset sequence counter when clearing utterances", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: "item-1",
        output_index: 0,
        delta: "First",
      };

      service.ingestRealtimeEvent(delta1);
      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).sequence, 0);

      service.clearActiveUtterances();

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: "item-2",
        output_index: 0,
        delta: "Second",
      };

      service.ingestRealtimeEvent(delta2);
      assert.strictEqual((receivedEvents[1] as TranscriptDeltaEvent).sequence, 0);
    });
  });

  describe("Subscription Management", () => {
    it("should allow multiple subscribers", () => {
      const events1: TranscriptEvent[] = [];
      const events2: TranscriptEvent[] = [];

      service.subscribeTranscript((event) => { events1.push(event); });
      service.subscribeTranscript((event) => { events2.push(event); });

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Test",
      };

      service.ingestRealtimeEvent(delta);

      assert.strictEqual(events1.length, 1);
      assert.strictEqual(events2.length, 1);
    });

    it("should allow unsubscribing via disposable", () => {
      const events: TranscriptEvent[] = [];
      const subscription = service.subscribeTranscript((event) => { events.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "First",
      };

      service.ingestRealtimeEvent(delta1);
      assert.strictEqual(events.length, 1);

      subscription.dispose();

      const delta2: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Second",
      };

      service.ingestRealtimeEvent(delta2);

      // Should not receive second event
      assert.strictEqual(events.length, 1);
    });
  });

  describe("Session ID Updates", () => {
    it("should use updated session ID in transcript events", () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      service.setSessionId("new-session-id");

      const delta: ResponseOutputTextDeltaEvent = {
        type: "response.output_text.delta",
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: "Test",
      };

      service.ingestRealtimeEvent(delta);

      assert.strictEqual((receivedEvents[0] as TranscriptDeltaEvent).sessionId, "new-session-id");
    });
  });
});

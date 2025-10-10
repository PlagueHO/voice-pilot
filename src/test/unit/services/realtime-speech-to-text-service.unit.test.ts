// @ts-nocheck
import { RealtimeSpeechToTextService } from '../../../services/realtime-speech-to-text-service';
import type {
  ResponseAudioTranscriptDeltaEvent,
  ResponseDoneEvent,
  ResponseOutputAudioTranscriptDeltaEvent,
  ResponseOutputTextDeltaEvent,
  ResponseOutputTextDoneEvent,
  ResponseTextDeltaEvent
} from '../../../types/realtime-events';
import type {
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent,
} from '../../../types/speech-to-text';
import { expect } from '../../helpers/chai-setup';
import { afterEach, beforeEach, suite, test } from '../../mocha-globals';

suite('Unit: RealtimeSpeechToTextService', () => {
  let service: RealtimeSpeechToTextService;
  const testSessionId = 'test-session-123';
  const testResponseId = 'resp-456';
  const testItemId = 'item-789';

  beforeEach(async () => {
    service = new RealtimeSpeechToTextService();
    await service.initialize(testSessionId);
  });

  afterEach(() => {
    service.dispose();
  });

  suite('Initialization and Lifecycle', () => {
    test('should initialize successfully with session ID', async () => {
      const newService = new RealtimeSpeechToTextService();
      await newService.initialize('session-xyz');

      expect(newService.isInitialized()).to.equal(true);
      newService.dispose();
    });

    test('should allow setting session ID after initialization', () => {
      expect(() => service.setSessionId('new-session-456')).to.not.throw();
    });

    test('should dispose cleanly and clear state', () => {
      service.dispose();
      expect(service.isInitialized()).to.equal(false);
      expect(service.getActiveUtterances()).to.have.lengthOf(0);
    });

    test('should throw error when ingesting events before initialization', async () => {
      const uninitializedService = new RealtimeSpeechToTextService();
      const event: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'test',
      };

      expect(() => uninitializedService.ingestRealtimeEvent(event)).to.throw(/must be initialized/);
    });
  });

  suite('Delta Aggregation', () => {
    test('should aggregate text deltas from response.output_text.delta events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Hello ',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'World!',
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      expect(receivedEvents).to.have.lengthOf(2);
      expect(receivedEvents[0].type).to.equal('transcript-delta');
      expect((receivedEvents[0] as TranscriptDeltaEvent).delta).to.equal('Hello ');
      expect((receivedEvents[0] as TranscriptDeltaEvent).content).to.equal('Hello ');
      expect(receivedEvents[1].type).to.equal('transcript-delta');
      expect((receivedEvents[1] as TranscriptDeltaEvent).delta).to.equal('World!');
      expect((receivedEvents[1] as TranscriptDeltaEvent).content).to.equal('Hello World!');
    });

    test('should aggregate audio transcript deltas from response.output_audio_transcript.delta events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => {
        receivedEvents.push(event);
      });

      const delta1: ResponseOutputAudioTranscriptDeltaEvent = {
        type: 'response.output_audio_transcript.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: { transcript: 'This is ' },
      };

      const delta2: ResponseOutputAudioTranscriptDeltaEvent = {
        type: 'response.output_audio_transcript.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: { transcript: 'a test' },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      expect(receivedEvents).to.have.lengthOf(2);
      expect((receivedEvents[0] as TranscriptDeltaEvent).content).to.equal('This is ');
      expect((receivedEvents[1] as TranscriptDeltaEvent).content).to.equal('This is a test');
    });

    test('should handle legacy response.text.delta events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseTextDeltaEvent = {
        type: 'response.text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        content_index: 0,
        delta: 'Legacy delta',
      };

      service.ingestRealtimeEvent(delta);

      expect(receivedEvents).to.have.lengthOf(1);
      expect((receivedEvents[0] as TranscriptDeltaEvent).content).to.equal('Legacy delta');
    });

    test('should handle legacy response.audio_transcript.delta events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseAudioTranscriptDeltaEvent = {
        type: 'response.audio_transcript.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        content_index: 0,
        delta: { text: 'Legacy audio' },
      };

      service.ingestRealtimeEvent(delta);

      expect(receivedEvents).to.have.lengthOf(1);
      expect((receivedEvents[0] as TranscriptDeltaEvent).content).to.equal('Legacy audio');
    });

    test('should track chunk count in metadata', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'First ',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Second ',
      };

      const delta3: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Third',
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(delta3);

      expect((receivedEvents[0] as TranscriptDeltaEvent).metadata.chunkCount).to.equal(1);
      expect((receivedEvents[1] as TranscriptDeltaEvent).metadata.chunkCount).to.equal(2);
      expect((receivedEvents[2] as TranscriptDeltaEvent).metadata.chunkCount).to.equal(3);
    });

    test('should assign unique utterance IDs based on response_id and item_id', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-1',
        item_id: 'item-1',
        output_index: 0,
        delta: 'First utterance',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-2',
        item_id: 'item-2',
        output_index: 0,
        delta: 'Second utterance',
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      expect((receivedEvents[0] as TranscriptDeltaEvent).utteranceId).to.equal('resp-1-item-1');
      expect((receivedEvents[1] as TranscriptDeltaEvent).utteranceId).to.equal('resp-2-item-2');
    });
  });

  suite('Finalization on response.done', () => {
    test('should finalize all utterances for a response when response.done is received', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Complete message',
      };

      const done: ResponseDoneEvent = {
        type: 'response.done',
        response: {
          id: testResponseId,
          object: 'realtime.response',
          status: 'completed',
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta);
      expect(service.getActiveUtterances()).to.have.lengthOf(1);

      service.ingestRealtimeEvent(done);

      expect(receivedEvents).to.have.lengthOf(2);
      expect(receivedEvents[0].type).to.equal('transcript-delta');
      expect(receivedEvents[1].type).to.equal('transcript-final');

      const finalEvent = receivedEvents[1] as TranscriptFinalEvent;
      expect(finalEvent.utteranceId).to.equal(`${testResponseId}-${testItemId}`);
      expect(finalEvent.content).to.equal('Complete message');
      expect(finalEvent.sessionId).to.equal(testSessionId);

      expect(service.getActiveUtterances()).to.have.lengthOf(0);
    });

    test('should finalize multiple utterances from the same response', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: 'item-1',
        output_index: 0,
        delta: 'First item',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: 'item-2',
        output_index: 0,
        delta: 'Second item',
      };

      const done: ResponseDoneEvent = {
        type: 'response.done',
        response: {
          id: testResponseId,
          object: 'realtime.response',
          status: 'completed',
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(done);

      expect(receivedEvents).to.have.lengthOf(4);
      const finalEvents = receivedEvents.filter(
        (e) => e.type === 'transcript-final',
      ) as TranscriptFinalEvent[];
      expect(finalEvents).to.have.lengthOf(2);

      expect(finalEvents.some((e) => e.content === 'First item'), 'Should finalize first item').to.equal(true);
      expect(finalEvents.some((e) => e.content === 'Second item'), 'Should finalize second item').to.equal(true);

      expect(service.getActiveUtterances()).to.have.lengthOf(0);
    });

    test('should not finalize utterances from other responses', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-1',
        item_id: testItemId,
        output_index: 0,
        delta: 'Response 1',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-2',
        item_id: testItemId,
        output_index: 0,
        delta: 'Response 2',
      };

      const done: ResponseDoneEvent = {
        type: 'response.done',
        response: {
          id: 'resp-1',
          object: 'realtime.response',
          status: 'completed',
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);
      service.ingestRealtimeEvent(done);

      const finalEvents = receivedEvents.filter(
        (e) => e.type === 'transcript-final',
      ) as TranscriptFinalEvent[];
      expect(finalEvents).to.have.lengthOf(1);
      expect(finalEvents[0].content).to.equal('Response 1');

      const activeUtterances = service.getActiveUtterances();
      expect(activeUtterances).to.have.lengthOf(1);
      expect(activeUtterances[0].content).to.equal('Response 2');
    });

    test('should set endOffsetMs in metadata when finalizing', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Test',
      };

      const done: ResponseDoneEvent = {
        type: 'response.done',
        response: {
          id: testResponseId,
          object: 'realtime.response',
          status: 'completed',
          output: [],
        },
      };

      service.ingestRealtimeEvent(delta);
      service.ingestRealtimeEvent(done);

      const finalEvent = receivedEvents.find(
        (e) => e.type === 'transcript-final',
      ) as TranscriptFinalEvent;
      expect(finalEvent).to.exist;
      expect(finalEvent.metadata.endOffsetMs, 'Should set endOffsetMs').to.not.equal(undefined);
      expect(finalEvent.metadata.endOffsetMs!, 'endOffsetMs should be positive').to.be.greaterThan(0);
    });

    test('should finalize utterances on response.output_text.done events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event: TranscriptEvent) => {
        receivedEvents.push(event);
      });

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Partial content',
      };

      const done: ResponseOutputTextDoneEvent = {
        type: 'response.output_text.done',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        text: 'Finalized content',
      };

      service.ingestRealtimeEvent(delta);
      service.ingestRealtimeEvent(done);

      const finalEvents = receivedEvents.filter(
        (event) => event.type === 'transcript-final',
      ) as TranscriptFinalEvent[];

      expect(finalEvents).to.have.lengthOf(1);
      expect(finalEvents[0].content).to.equal('Finalized content');
      expect(finalEvents[0].utteranceId).to.equal(`${testResponseId}-${testItemId}`);
    });
  });

  suite('Error Handling', () => {
    test('should handle malformed events with missing delta gracefully', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const malformedEvent: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: undefined as any,
      };

      // Should not throw, just log warning
      expect(() => service.ingestRealtimeEvent(malformedEvent)).to.not.throw();

      expect(receivedEvents).to.have.lengthOf(0);
    });

    test('should handle events without session ID by logging warning', async () => {
      const serviceWithoutSession = new RealtimeSpeechToTextService();
      await serviceWithoutSession.initialize(); // No session ID

      const receivedEvents: TranscriptEvent[] = [];
      serviceWithoutSession.subscribeTranscript((event) =>
        { receivedEvents.push(event); }
      );

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Test',
      };

      // Should log warning and ignore event
      expect(() => serviceWithoutSession.ingestRealtimeEvent(delta)).to.not.throw();

      expect(receivedEvents).to.have.lengthOf(0);
      serviceWithoutSession.dispose();
    });

    test('should ignore unsupported event types without errors', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const unsupportedEvent = {
        type: 'session.updated',
        session: {},
      };

      expect(() => service.ingestRealtimeEvent(unsupportedEvent as any)).to.not.throw();

      expect(receivedEvents).to.have.lengthOf(0);
    });

    test('should handle delta extraction from various payload formats', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      // String delta
      const stringDelta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: 'item-1',
        output_index: 0,
        delta: 'String delta',
      };

      // Object with text property
      const textDelta: ResponseOutputAudioTranscriptDeltaEvent = {
        type: 'response.output_audio_transcript.delta',
        response_id: testResponseId,
        item_id: 'item-2',
        output_index: 0,
        delta: { text: 'Text property' },
      };

      // Object with transcript property
      const transcriptDelta: ResponseOutputAudioTranscriptDeltaEvent = {
        type: 'response.output_audio_transcript.delta',
        response_id: testResponseId,
        item_id: 'item-3',
        output_index: 0,
        delta: { transcript: 'Transcript property' },
      };

      service.ingestRealtimeEvent(stringDelta);
      service.ingestRealtimeEvent(textDelta);
      service.ingestRealtimeEvent(transcriptDelta);

      expect(receivedEvents).to.have.lengthOf(3);
      expect((receivedEvents[0] as TranscriptDeltaEvent).content).to.equal('String delta');
      expect((receivedEvents[1] as TranscriptDeltaEvent).content).to.equal('Text property');
      expect((receivedEvents[2] as TranscriptDeltaEvent).content).to.equal('Transcript property');
    });
  });

  suite('Active Utterances Management', () => {
    test('should track active utterances before finalization', () => {
      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-1',
        item_id: 'item-1',
        output_index: 0,
        delta: 'First',
      };

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: 'resp-2',
        item_id: 'item-2',
        output_index: 0,
        delta: 'Second',
      };

      service.ingestRealtimeEvent(delta1);
      service.ingestRealtimeEvent(delta2);

      const active = service.getActiveUtterances();
      expect(active).to.have.lengthOf(2);
      expect(active.some((u) => u.content === 'First')).to.equal(true);
      expect(active.some((u) => u.content === 'Second')).to.equal(true);
    });

    test('should clear all active utterances when clearActiveUtterances is called', () => {
      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Test content',
      };

      service.ingestRealtimeEvent(delta);
      expect(service.getActiveUtterances()).to.have.lengthOf(1);

      service.clearActiveUtterances();

      expect(service.getActiveUtterances()).to.have.lengthOf(0);
    });

    test('should reset sequence counter when clearing utterances', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: 'item-1',
        output_index: 0,
        delta: 'First',
      };

      service.ingestRealtimeEvent(delta1);
      expect((receivedEvents[0] as TranscriptDeltaEvent).sequence).to.equal(0);

      service.clearActiveUtterances();

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: 'item-2',
        output_index: 0,
        delta: 'Second',
      };

      service.ingestRealtimeEvent(delta2);
      expect((receivedEvents[1] as TranscriptDeltaEvent).sequence).to.equal(0);
    });
  });

  suite('Subscription Management', () => {
    test('should allow multiple subscribers', () => {
      const events1: TranscriptEvent[] = [];
      const events2: TranscriptEvent[] = [];

      service.subscribeTranscript((event) => { events1.push(event); });
      service.subscribeTranscript((event) => { events2.push(event); });

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Test',
      };

      service.ingestRealtimeEvent(delta);

      expect(events1).to.have.lengthOf(1);
      expect(events2).to.have.lengthOf(1);
    });

    test('should allow unsubscribing via disposable', () => {
      const events: TranscriptEvent[] = [];
      const subscription = service.subscribeTranscript((event) => { events.push(event); });

      const delta1: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'First',
      };

      service.ingestRealtimeEvent(delta1);
      expect(events).to.have.lengthOf(1);

      subscription.dispose();

      const delta2: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Second',
      };

      service.ingestRealtimeEvent(delta2);

      expect(events).to.have.lengthOf(1);
    });
  });

  suite('Session ID Updates', () => {
    test('should use updated session ID in transcript events', () => {
      const receivedEvents: TranscriptEvent[] = [];
      service.subscribeTranscript((event) => { receivedEvents.push(event); });

      service.setSessionId('new-session-id');

      const delta: ResponseOutputTextDeltaEvent = {
        type: 'response.output_text.delta',
        response_id: testResponseId,
        item_id: testItemId,
        output_index: 0,
        delta: 'Test',
      };

      service.ingestRealtimeEvent(delta);

      expect((receivedEvents[0] as TranscriptDeltaEvent).sessionId).to.equal('new-session-id');
    });
  });
});

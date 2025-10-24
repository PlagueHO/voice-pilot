"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const realtime_speech_to_text_service_1 = require("../../src/../services/realtime-speech-to-text-service");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
(0, mocha_globals_1.suite)('Unit: RealtimeSpeechToTextService', () => {
    let service;
    const testSessionId = 'test-session-123';
    const testResponseId = 'resp-456';
    const testItemId = 'item-789';
    (0, mocha_globals_1.beforeEach)(async () => {
        service = new realtime_speech_to_text_service_1.RealtimeSpeechToTextService();
        await service.initialize(testSessionId);
    });
    (0, mocha_globals_1.afterEach)(() => {
        service.dispose();
    });
    (0, mocha_globals_1.suite)('Initialization and Lifecycle', () => {
        (0, mocha_globals_1.test)('should initialize successfully with session ID', async () => {
            const newService = new realtime_speech_to_text_service_1.RealtimeSpeechToTextService();
            await newService.initialize('session-xyz');
            (0, chai_setup_1.expect)(newService.isInitialized()).to.equal(true);
            newService.dispose();
        });
        (0, mocha_globals_1.test)('should allow setting session ID after initialization', () => {
            (0, chai_setup_1.expect)(() => service.setSessionId('new-session-456')).to.not.throw();
        });
        (0, mocha_globals_1.test)('should dispose cleanly and clear state', () => {
            service.dispose();
            (0, chai_setup_1.expect)(service.isInitialized()).to.equal(false);
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should throw error when ingesting events before initialization', async () => {
            const uninitializedService = new realtime_speech_to_text_service_1.RealtimeSpeechToTextService();
            const event = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'test',
            };
            (0, chai_setup_1.expect)(() => uninitializedService.ingestRealtimeEvent(event)).to.throw(/must be initialized/);
        });
    });
    (0, mocha_globals_1.suite)('Delta Aggregation', () => {
        (0, mocha_globals_1.test)('should aggregate text deltas from response.output_text.delta events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Hello ',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'World!',
            };
            service.ingestRealtimeEvent(delta1);
            service.ingestRealtimeEvent(delta2);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(2);
            (0, chai_setup_1.expect)(receivedEvents[0].type).to.equal('transcript-delta');
            (0, chai_setup_1.expect)(receivedEvents[0].delta).to.equal('Hello ');
            (0, chai_setup_1.expect)(receivedEvents[0].content).to.equal('Hello ');
            (0, chai_setup_1.expect)(receivedEvents[1].type).to.equal('transcript-delta');
            (0, chai_setup_1.expect)(receivedEvents[1].delta).to.equal('World!');
            (0, chai_setup_1.expect)(receivedEvents[1].content).to.equal('Hello World!');
        });
        (0, mocha_globals_1.test)('should aggregate audio transcript deltas from response.output_audio_transcript.delta events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta1 = {
                type: 'response.output_audio_transcript.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: { transcript: 'This is ' },
            };
            const delta2 = {
                type: 'response.output_audio_transcript.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: { transcript: 'a test' },
            };
            service.ingestRealtimeEvent(delta1);
            service.ingestRealtimeEvent(delta2);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(2);
            (0, chai_setup_1.expect)(receivedEvents[0].content).to.equal('This is ');
            (0, chai_setup_1.expect)(receivedEvents[1].content).to.equal('This is a test');
        });
        (0, mocha_globals_1.test)('should handle legacy response.text.delta events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta = {
                type: 'response.text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                content_index: 0,
                delta: 'Legacy delta',
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(receivedEvents[0].content).to.equal('Legacy delta');
        });
        (0, mocha_globals_1.test)('should handle legacy response.audio_transcript.delta events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta = {
                type: 'response.audio_transcript.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                content_index: 0,
                delta: { text: 'Legacy audio' },
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(receivedEvents[0].content).to.equal('Legacy audio');
        });
        (0, mocha_globals_1.test)('should track chunk count in metadata', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'First ',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Second ',
            };
            const delta3 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Third',
            };
            service.ingestRealtimeEvent(delta1);
            service.ingestRealtimeEvent(delta2);
            service.ingestRealtimeEvent(delta3);
            (0, chai_setup_1.expect)(receivedEvents[0].metadata.chunkCount).to.equal(1);
            (0, chai_setup_1.expect)(receivedEvents[1].metadata.chunkCount).to.equal(2);
            (0, chai_setup_1.expect)(receivedEvents[2].metadata.chunkCount).to.equal(3);
        });
        (0, mocha_globals_1.test)('should assign unique utterance IDs based on response_id and item_id', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: 'resp-1',
                item_id: 'item-1',
                output_index: 0,
                delta: 'First utterance',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: 'resp-2',
                item_id: 'item-2',
                output_index: 0,
                delta: 'Second utterance',
            };
            service.ingestRealtimeEvent(delta1);
            service.ingestRealtimeEvent(delta2);
            (0, chai_setup_1.expect)(receivedEvents[0].utteranceId).to.equal('resp-1-item-1');
            (0, chai_setup_1.expect)(receivedEvents[1].utteranceId).to.equal('resp-2-item-2');
        });
    });
    (0, mocha_globals_1.suite)('Finalization on response.done', () => {
        (0, mocha_globals_1.test)('should finalize all utterances for a response when response.done is received', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Complete message',
            };
            const done = {
                type: 'response.done',
                response: {
                    id: testResponseId,
                    object: 'realtime.response',
                    status: 'completed',
                    output: [],
                },
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(1);
            service.ingestRealtimeEvent(done);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(2);
            (0, chai_setup_1.expect)(receivedEvents[0].type).to.equal('transcript-delta');
            (0, chai_setup_1.expect)(receivedEvents[1].type).to.equal('transcript-final');
            const finalEvent = receivedEvents[1];
            (0, chai_setup_1.expect)(finalEvent.utteranceId).to.equal(`${testResponseId}-${testItemId}`);
            (0, chai_setup_1.expect)(finalEvent.content).to.equal('Complete message');
            (0, chai_setup_1.expect)(finalEvent.sessionId).to.equal(testSessionId);
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should finalize multiple utterances from the same response', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: 'item-1',
                output_index: 0,
                delta: 'First item',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: 'item-2',
                output_index: 0,
                delta: 'Second item',
            };
            const done = {
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
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(4);
            const finalEvents = receivedEvents.filter((e) => e.type === 'transcript-final');
            (0, chai_setup_1.expect)(finalEvents).to.have.lengthOf(2);
            (0, chai_setup_1.expect)(finalEvents.some((e) => e.content === 'First item'), 'Should finalize first item').to.equal(true);
            (0, chai_setup_1.expect)(finalEvents.some((e) => e.content === 'Second item'), 'Should finalize second item').to.equal(true);
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should not finalize utterances from other responses', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: 'resp-1',
                item_id: testItemId,
                output_index: 0,
                delta: 'Response 1',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: 'resp-2',
                item_id: testItemId,
                output_index: 0,
                delta: 'Response 2',
            };
            const done = {
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
            const finalEvents = receivedEvents.filter((e) => e.type === 'transcript-final');
            (0, chai_setup_1.expect)(finalEvents).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(finalEvents[0].content).to.equal('Response 1');
            const activeUtterances = service.getActiveUtterances();
            (0, chai_setup_1.expect)(activeUtterances).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(activeUtterances[0].content).to.equal('Response 2');
        });
        (0, mocha_globals_1.test)('should set endOffsetMs in metadata when finalizing', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Test',
            };
            const done = {
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
            const finalEvent = receivedEvents.find((e) => e.type === 'transcript-final');
            (0, chai_setup_1.expect)(finalEvent).to.exist;
            (0, chai_setup_1.expect)(finalEvent.metadata.endOffsetMs, 'Should set endOffsetMs').to.not.equal(undefined);
            (0, chai_setup_1.expect)(finalEvent.metadata.endOffsetMs, 'endOffsetMs should be positive').to.be.greaterThan(0);
        });
        (0, mocha_globals_1.test)('should finalize utterances on response.output_text.done events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => {
                receivedEvents.push(event);
            });
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Partial content',
            };
            const done = {
                type: 'response.output_text.done',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                text: 'Finalized content',
            };
            service.ingestRealtimeEvent(delta);
            service.ingestRealtimeEvent(done);
            const finalEvents = receivedEvents.filter((event) => event.type === 'transcript-final');
            (0, chai_setup_1.expect)(finalEvents).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(finalEvents[0].content).to.equal('Finalized content');
            (0, chai_setup_1.expect)(finalEvents[0].utteranceId).to.equal(`${testResponseId}-${testItemId}`);
        });
    });
    (0, mocha_globals_1.suite)('Error Handling', () => {
        (0, mocha_globals_1.test)('should handle malformed events with missing delta gracefully', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const malformedEvent = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: undefined,
            };
            // Should not throw, just log warning
            (0, chai_setup_1.expect)(() => service.ingestRealtimeEvent(malformedEvent)).to.not.throw();
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should handle events without session ID by logging warning', async () => {
            const serviceWithoutSession = new realtime_speech_to_text_service_1.RealtimeSpeechToTextService();
            await serviceWithoutSession.initialize(); // No session ID
            const receivedEvents = [];
            serviceWithoutSession.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Test',
            };
            // Should log warning and ignore event
            (0, chai_setup_1.expect)(() => serviceWithoutSession.ingestRealtimeEvent(delta)).to.not.throw();
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(0);
            serviceWithoutSession.dispose();
        });
        (0, mocha_globals_1.test)('should ignore unsupported event types without errors', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const unsupportedEvent = {
                type: 'session.updated',
                session: {},
            };
            (0, chai_setup_1.expect)(() => service.ingestRealtimeEvent(unsupportedEvent)).to.not.throw();
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should handle delta extraction from various payload formats', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            // String delta
            const stringDelta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: 'item-1',
                output_index: 0,
                delta: 'String delta',
            };
            // Object with text property
            const textDelta = {
                type: 'response.output_audio_transcript.delta',
                response_id: testResponseId,
                item_id: 'item-2',
                output_index: 0,
                delta: { text: 'Text property' },
            };
            // Object with transcript property
            const transcriptDelta = {
                type: 'response.output_audio_transcript.delta',
                response_id: testResponseId,
                item_id: 'item-3',
                output_index: 0,
                delta: { transcript: 'Transcript property' },
            };
            service.ingestRealtimeEvent(stringDelta);
            service.ingestRealtimeEvent(textDelta);
            service.ingestRealtimeEvent(transcriptDelta);
            (0, chai_setup_1.expect)(receivedEvents).to.have.lengthOf(3);
            (0, chai_setup_1.expect)(receivedEvents[0].content).to.equal('String delta');
            (0, chai_setup_1.expect)(receivedEvents[1].content).to.equal('Text property');
            (0, chai_setup_1.expect)(receivedEvents[2].content).to.equal('Transcript property');
        });
    });
    (0, mocha_globals_1.suite)('Active Utterances Management', () => {
        (0, mocha_globals_1.test)('should track active utterances before finalization', () => {
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: 'resp-1',
                item_id: 'item-1',
                output_index: 0,
                delta: 'First',
            };
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: 'resp-2',
                item_id: 'item-2',
                output_index: 0,
                delta: 'Second',
            };
            service.ingestRealtimeEvent(delta1);
            service.ingestRealtimeEvent(delta2);
            const active = service.getActiveUtterances();
            (0, chai_setup_1.expect)(active).to.have.lengthOf(2);
            (0, chai_setup_1.expect)(active.some((u) => u.content === 'First')).to.equal(true);
            (0, chai_setup_1.expect)(active.some((u) => u.content === 'Second')).to.equal(true);
        });
        (0, mocha_globals_1.test)('should clear all active utterances when clearActiveUtterances is called', () => {
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Test content',
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(1);
            service.clearActiveUtterances();
            (0, chai_setup_1.expect)(service.getActiveUtterances()).to.have.lengthOf(0);
        });
        (0, mocha_globals_1.test)('should reset sequence counter when clearing utterances', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: 'item-1',
                output_index: 0,
                delta: 'First',
            };
            service.ingestRealtimeEvent(delta1);
            (0, chai_setup_1.expect)(receivedEvents[0].sequence).to.equal(0);
            service.clearActiveUtterances();
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: 'item-2',
                output_index: 0,
                delta: 'Second',
            };
            service.ingestRealtimeEvent(delta2);
            (0, chai_setup_1.expect)(receivedEvents[1].sequence).to.equal(0);
        });
    });
    (0, mocha_globals_1.suite)('Subscription Management', () => {
        (0, mocha_globals_1.test)('should allow multiple subscribers', () => {
            const events1 = [];
            const events2 = [];
            service.subscribeTranscript((event) => { events1.push(event); });
            service.subscribeTranscript((event) => { events2.push(event); });
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Test',
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(events1).to.have.lengthOf(1);
            (0, chai_setup_1.expect)(events2).to.have.lengthOf(1);
        });
        (0, mocha_globals_1.test)('should allow unsubscribing via disposable', () => {
            const events = [];
            const subscription = service.subscribeTranscript((event) => { events.push(event); });
            const delta1 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'First',
            };
            service.ingestRealtimeEvent(delta1);
            (0, chai_setup_1.expect)(events).to.have.lengthOf(1);
            subscription.dispose();
            const delta2 = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Second',
            };
            service.ingestRealtimeEvent(delta2);
            (0, chai_setup_1.expect)(events).to.have.lengthOf(1);
        });
    });
    (0, mocha_globals_1.suite)('Session ID Updates', () => {
        (0, mocha_globals_1.test)('should use updated session ID in transcript events', () => {
            const receivedEvents = [];
            service.subscribeTranscript((event) => { receivedEvents.push(event); });
            service.setSessionId('new-session-id');
            const delta = {
                type: 'response.output_text.delta',
                response_id: testResponseId,
                item_id: testItemId,
                output_index: 0,
                delta: 'Test',
            };
            service.ingestRealtimeEvent(delta);
            (0, chai_setup_1.expect)(receivedEvents[0].sessionId).to.equal('new-session-id');
        });
    });
});
//# sourceMappingURL=realtime-speech-to-text-service.unit.test.js.map
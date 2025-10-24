"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// @ts-nocheck
const realtime_speech_to_text_service_1 = require("../../src/../services/realtime-speech-to-text-service");
const session_manager_1 = require("../../src/../session/session-manager");
const session_1 = require("../../src/../types/session");
const chai_setup_1 = require("../../src/helpers/chai-setup");
const mocha_globals_1 = require("../../src/mocha-globals");
class RecordingRealtimeSpeechService extends realtime_speech_to_text_service_1.RealtimeSpeechToTextService {
    ingested = [];
    constructor(logger) {
        super(logger);
    }
    ingestRealtimeEvent(event) {
        this.ingested.push(event);
        super.ingestRealtimeEvent(event);
    }
}
(0, mocha_globals_1.suite)('Unit: SessionManager realtime transcript integration', () => {
    (0, mocha_globals_1.test)('forwards realtime events to transcript subscribers', async () => {
        const loggerStub = {
            info() { },
            warn() { },
            error() { },
            debug() { },
        };
        const manager = new session_manager_1.SessionManagerImpl(undefined, undefined, undefined, loggerStub);
        const realtimeService = new RecordingRealtimeSpeechService(loggerStub);
        await realtimeService.initialize('test-session');
        manager.setRealtimeSpeechToTextService(realtimeService);
        const sessionInfo = {
            sessionId: 'test-session',
            state: session_1.SessionState.Active,
            startedAt: new Date(),
            lastActivity: new Date(),
            config: {
                renewalMarginSeconds: 10,
                inactivityTimeoutMinutes: 5,
                heartbeatIntervalSeconds: 30,
                maxRetryAttempts: 3,
                retryBackoffMs: 500,
                enableHeartbeat: true,
                enableInactivityTimeout: true,
            },
            statistics: {
                renewalCount: 0,
                failedRenewalCount: 0,
                heartbeatCount: 0,
                inactivityResets: 0,
                totalDurationMs: 0,
                averageRenewalLatencyMs: 0,
            },
            connectionInfo: {
                webrtcState: 'connected',
                reconnectAttempts: 0,
            },
        };
        manager.sessions.set(sessionInfo.sessionId, sessionInfo);
        const receivedEvents = [];
        manager.onRealtimeTranscript((event) => {
            receivedEvents.push(event);
        });
        const deltaEvent = {
            type: 'response.output_text.delta',
            response_id: 'resp-1',
            item_id: 'item-1',
            output_index: 0,
            delta: 'Hello',
        };
        manager.handleRealtimeTranscriptEvent(deltaEvent);
        await new Promise((resolve) => setTimeout(resolve, 0));
        (0, chai_setup_1.expect)(realtimeService.ingested.length).to.equal(1);
        (0, chai_setup_1.expect)(receivedEvents.length).to.equal(1);
        const event = receivedEvents[0];
        (0, chai_setup_1.expect)(event.type).to.equal('transcript-delta');
        (0, chai_setup_1.expect)(event.utteranceId).to.equal('resp-1-item-1');
    });
});
//# sourceMappingURL=session-manager-realtime.unit.test.js.map
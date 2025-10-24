// @ts-nocheck
import { RealtimeSpeechToTextService } from '../../../src/services/realtime-speech-to-text-service';
import { SessionManagerImpl } from '../../../src/session/session-manager';
import type {
  RealtimeEvent,
  ResponseOutputTextDeltaEvent,
} from '../../../src/types/realtime-events';
import {
  SessionState,
  type SessionInfo,
} from '../../../src/types/session';
import type { TranscriptEvent } from '../../../src/types/speech-to-text';
import { expect } from '../../helpers/chai-setup';
import { suite, test } from '../../mocha-globals';

class RecordingRealtimeSpeechService extends RealtimeSpeechToTextService {
  public readonly ingested: RealtimeEvent[] = [];

  constructor(logger: any) {
    super(logger);
  }

  ingestRealtimeEvent(event: RealtimeEvent): void {
    this.ingested.push(event);
    super.ingestRealtimeEvent(event);
  }
}

suite('Unit: SessionManager realtime transcript integration', () => {
  test('forwards realtime events to transcript subscribers', async () => {
    const loggerStub = {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as any;

    const manager = new SessionManagerImpl(
      undefined,
      undefined,
      undefined,
      loggerStub,
    );
    const realtimeService = new RecordingRealtimeSpeechService(loggerStub);
  await realtimeService.initialize('test-session');

    manager.setRealtimeSpeechToTextService(realtimeService);

    const sessionInfo: SessionInfo = {
  sessionId: 'test-session',
      state: SessionState.Active,
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

    (manager as any).sessions.set(sessionInfo.sessionId, sessionInfo);

    const receivedEvents: TranscriptEvent[] = [];
    manager.onRealtimeTranscript((event) => {
      receivedEvents.push(event);
    });

    const deltaEvent: ResponseOutputTextDeltaEvent = {
  type: 'response.output_text.delta',
  response_id: 'resp-1',
  item_id: 'item-1',
      output_index: 0,
  delta: 'Hello',
    };

    manager.handleRealtimeTranscriptEvent(deltaEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(realtimeService.ingested.length).to.equal(1);
    expect(receivedEvents.length).to.equal(1);
    const event = receivedEvents[0];
    expect(event.type).to.equal('transcript-delta');
    expect(event.utteranceId).to.equal('resp-1-item-1');
  });
});

import * as assert from 'assert';
import { ConversationStateMachine, CopilotResponseEvent } from '../../conversation/conversation-state-machine';
import { Logger } from '../../core/logger';
import { ConnectionInfo, SessionConfig, SessionInfo, SessionState, SessionStatistics } from '../../types/session';
import { TranscriptDeltaEvent, TranscriptFinalEvent, TranscriptionStatusEvent } from '../../types/speech-to-text';
import { TtsPlaybackEvent } from '../../types/tts';
import { afterEach, beforeEach, describe, it } from '../mocha-globals';

function createSessionInfo(): SessionInfo {
  const config: SessionConfig = {
    renewalMarginSeconds: 10,
    inactivityTimeoutMinutes: 5,
    heartbeatIntervalSeconds: 30,
    maxRetryAttempts: 3,
    retryBackoffMs: 1000,
    enableHeartbeat: true,
    enableInactivityTimeout: true
  };

  const statistics: SessionStatistics = {
    renewalCount: 0,
    failedRenewalCount: 0,
    heartbeatCount: 0,
    inactivityResets: 0,
    totalDurationMs: 0,
    averageRenewalLatencyMs: 0
  };

  const connectionInfo: ConnectionInfo = {
    webrtcState: 'connected',
    reconnectAttempts: 0
  };

  return {
    sessionId: 'session-001',
    state: SessionState.Active,
    startedAt: new Date(),
    lastActivity: new Date(),
    config,
    statistics,
    connectionInfo
  };
}

describe('ConversationStateMachine', () => {
  let logger: Logger;
  let machine: ConversationStateMachine;
  let sessionInfo: SessionInfo;

  beforeEach(async () => {
    logger = new Logger('ConversationStateMachineTest');
    logger.setLevel('debug');
    machine = new ConversationStateMachine({ logger });
    sessionInfo = createSessionInfo();
    await machine.initialize(sessionInfo);
  });

  afterEach(() => {
    machine.dispose();
    logger.dispose();
  });

  it('should transition from idle to listening on start', async () => {
    const transitions: Array<{ from: string; to: string }> = [];
    machine.onStateChanged(event => {
      transitions.push({ from: event.transition.from, to: event.transition.to });
    });

    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    const expected = transitions.map(t => `${t.from}->${t.to}`);
    assert.ok(expected.includes('idle->preparing'));
    assert.ok(expected.includes('preparing->listening'));
    const state = machine.getState();
    assert.strictEqual(state.state, 'listening');
  });

  it('should enter processing after final transcript', async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    const statusEvent: TranscriptionStatusEvent = {
      type: 'transcription-status',
      sessionId: sessionInfo.sessionId,
      status: 'speech-started',
      timestamp: new Date().toISOString()
    };
    await machine.notifyTranscriptionStatus(statusEvent);

    const deltaEvent: TranscriptDeltaEvent = {
      type: 'transcript-delta',
      sessionId: sessionInfo.sessionId,
      utteranceId: 'utt-1',
      delta: 'hello',
      content: 'hello',
      confidence: 0.92,
      timestamp: new Date().toISOString(),
      sequence: 1,
      metadata: {
        startOffsetMs: 0,
        endOffsetMs: 400,
        chunkCount: 1,
        locale: 'en-US'
      }
    };
    await machine.notifyTranscript(deltaEvent);

    const finalEvent: TranscriptFinalEvent = {
      type: 'transcript-final',
      sessionId: sessionInfo.sessionId,
      utteranceId: 'utt-1',
      content: 'hello world',
      confidence: 0.94,
      timestamp: new Date().toISOString(),
      metadata: {
        startOffsetMs: 0,
        endOffsetMs: 1450,
        chunkCount: 2,
        locale: 'en-US'
      }
    };
    await machine.notifyTranscript(finalEvent);

    const state = machine.getState();
    assert.strictEqual(state.state, 'processing');
  });

  it('should reach speaking state after copilot completion and tts playback', async () => {
    await machine.startConversation({ sessionId: sessionInfo.sessionId });

    const finalEvent: TranscriptFinalEvent = {
      type: 'transcript-final',
      sessionId: sessionInfo.sessionId,
      utteranceId: 'utt-2',
      content: 'test question',
      confidence: 0.9,
      timestamp: new Date().toISOString(),
      metadata: {
        startOffsetMs: 0,
        endOffsetMs: 1300,
        chunkCount: 1,
        locale: 'en-US'
      }
    };
    await machine.notifyTranscript(finalEvent);

    const pendingCopilot: CopilotResponseEvent = {
      requestId: 'req-1',
      status: 'pending',
      timestamp: new Date().toISOString()
    };
    await machine.notifyCopilot(pendingCopilot);

    const completeCopilot: CopilotResponseEvent = {
      requestId: 'req-1',
      status: 'completed',
      timestamp: new Date().toISOString(),
      content: 'assistant reply'
    };
    await machine.notifyCopilot(completeCopilot);

    const speakingEvent: TtsPlaybackEvent = {
      type: 'speaking-state-changed',
      handleId: 'handle-tts-1',
      timestamp: Date.now(),
      data: { state: 'speaking' }
    };
    await machine.notifyTts(speakingEvent);

    const state = machine.getState();
    assert.strictEqual(state.state, 'speaking');
  });
});

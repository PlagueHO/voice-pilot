// @ts-nocheck
import * as assert from "assert";
import { RealtimeSpeechToTextService } from "../../../services/realtime-speech-to-text-service";
import { SessionManagerImpl } from "../../../session/session-manager";
import type {
    RealtimeEvent,
    ResponseOutputTextDeltaEvent,
} from "../../../types/realtime-events";
import {
    SessionState,
    type SessionInfo,
} from "../../../types/session";
import type { TranscriptEvent } from "../../../types/speech-to-text";

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

describe("SessionManager realtime transcript integration", () => {
  it("forwards realtime events to transcript subscribers", async () => {
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
    await realtimeService.initialize("test-session");

    manager.setRealtimeSpeechToTextService(realtimeService);

    const sessionInfo: SessionInfo = {
      sessionId: "test-session",
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
        webrtcState: "connected",
        reconnectAttempts: 0,
      },
    };

    (manager as any).sessions.set(sessionInfo.sessionId, sessionInfo);

    const receivedEvents: TranscriptEvent[] = [];
    manager.onRealtimeTranscript((event) => {
      receivedEvents.push(event);
    });

    const deltaEvent: ResponseOutputTextDeltaEvent = {
      type: "response.output_text.delta",
      response_id: "resp-1",
      item_id: "item-1",
      output_index: 0,
      delta: "Hello",
    };

    manager.handleRealtimeTranscriptEvent(deltaEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(realtimeService.ingested.length, 1);
    assert.strictEqual(receivedEvents.length, 1);
    const event = receivedEvents[0];
    assert.strictEqual(event.type, "transcript-delta");
    assert.strictEqual(event.utteranceId, "resp-1-item-1");
  });
});

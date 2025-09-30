import { extractTranscriptText } from "../audio/realtime-transcript-utils";
import { Logger } from "../core/logger";
import { ServiceInitializable } from "../core/service-initializable";
import type {
  RealtimeEvent,
  ResponseDoneEvent,
} from "../types/realtime-events";
import type {
  TranscriptDeltaEvent,
  TranscriptEvent,
  TranscriptFinalEvent,
  UtteranceMetadata,
  UtteranceSnapshot,
} from "../types/speech-to-text";

const DEFAULT_LOCALE = "en-US";

const SUPPORTED_DELTA_EVENT_TYPES = new Set<string>([
  "response.output_text.delta",
  "response.text.delta",
  "response.audio_transcript.delta",
  "response.output_audio_transcript.delta",
  "response.output_audio_transcription.delta",
  "conversation.item.audio_transcription.delta",
]);

const SUPPORTED_FINAL_EVENT_TYPES = new Set<string>([
  "response.output_text.done",
  "response.text.done",
  "response.audio_transcript.done",
  "response.output_audio_transcript.done",
  "response.output_audio_transcription.done",
  "conversation.item.audio_transcription.completed",
]);

interface TranscriptSubscriber {
  (event: TranscriptEvent): void | Promise<void>;
}

interface UtteranceState {
  utteranceId: string;
  responseId: string;
  itemId: string;
  sessionId: string;
  content: string;
  chunkCount: number;
  sequence: number;
  startTimestamp: number;
  lastUpdated: number;
  metadata: UtteranceMetadata;
  confidence?: number;
}

function now(): number {
  return Date.now();
}

function buildUtteranceId(responseId: string, itemId: string | undefined): string {
  return itemId ? `${responseId}-${itemId}` : responseId;
}

function cloneMetadata(metadata: UtteranceMetadata): UtteranceMetadata {
  return {
    startOffsetMs: metadata.startOffsetMs,
    endOffsetMs: metadata.endOffsetMs,
    locale: metadata.locale,
    serverVad: metadata.serverVad,
    clientVad: metadata.clientVad,
    redactionsApplied: metadata.redactionsApplied,
    chunkCount: metadata.chunkCount,
  };
}

export class RealtimeSpeechToTextService implements ServiceInitializable {
  private readonly logger: Logger;
  private initialized = false;
  private sessionId?: string;
  private readonly subscribers = new Set<TranscriptSubscriber>();
  private readonly activeUtterances = new Map<string, UtteranceState>();

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("RealtimeSpeechToTextService");
  }

  async initialize(sessionId?: string): Promise<void> {
    if (this.initialized) {
      if (sessionId) {
        this.sessionId = sessionId;
      }
      return;
    }

    this.sessionId = sessionId;
    this.initialized = true;
    this.logger.debug("RealtimeSpeechToTextService initialized", {
      sessionId,
    });
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.debug("Disposing RealtimeSpeechToTextService");
    this.initialized = false;
    this.sessionId = undefined;
    this.subscribers.clear();
    this.activeUtterances.clear();
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  subscribeTranscript(handler: TranscriptSubscriber): { dispose(): void } {
    this.subscribers.add(handler);
    return {
      dispose: () => {
        this.subscribers.delete(handler);
      },
    };
  }

  ingestRealtimeEvent(event: RealtimeEvent): void {
    if (!this.initialized) {
      throw new Error(
        "RealtimeSpeechToTextService must be initialized before ingesting events",
      );
    }

    if (!this.sessionId) {
      this.logger.warn(
        "RealtimeSpeechToTextService received event without an active session",
        { type: event.type },
      );
      return;
    }

    if (SUPPORTED_DELTA_EVENT_TYPES.has(event.type)) {
      this.handleDeltaEvent(event);
      return;
    }

    if (event.type === "response.done") {
      this.handleResponseDone(event as ResponseDoneEvent);
      return;
    }

    if (SUPPORTED_FINAL_EVENT_TYPES.has(event.type)) {
      this.handleUtteranceFinalEvent(event);
      return;
    }

    this.logger.debug("RealtimeSpeechToTextService ignoring event", {
      type: event.type,
    });
  }

  getActiveUtterances(): UtteranceSnapshot[] {
    return Array.from(this.activeUtterances.values()).map((state) => ({
      utteranceId: state.utteranceId,
      sessionId: state.sessionId,
      speaker: "user",
      content: state.content,
      confidence: state.confidence,
      createdAt: new Date(state.startTimestamp).toISOString(),
      updatedAt: new Date(state.lastUpdated).toISOString(),
      status: "partial",
      metadata: cloneMetadata(state.metadata),
    }));
  }

  clearActiveUtterances(): void {
    this.activeUtterances.clear();
  }

  private handleDeltaEvent(event: RealtimeEvent): void {
    const responseId = (event as { response_id?: string }).response_id;
    const itemId = (event as { item_id?: string }).item_id;

    if (!responseId) {
      this.logger.warn("Delta event missing response_id", { type: event.type });
      return;
    }

    const utteranceId = buildUtteranceId(responseId, itemId);
    const transcript = extractTranscriptText(event);
    if (!transcript) {
      this.logger.debug("Delta event missing textual payload", {
        type: event.type,
      });
      return;
    }

    const sessionId = this.sessionId!;
    const state = this.ensureUtteranceState(
      utteranceId,
      responseId,
      itemId,
      sessionId,
    );

    state.chunkCount += 1;
    state.sequence += 1;
    state.content += transcript;
    state.lastUpdated = now();
    state.metadata.chunkCount = state.chunkCount;

    const confidence = this.extractConfidence(event);
    if (confidence !== undefined) {
      state.confidence = confidence;
    }

    const deltaEvent: TranscriptDeltaEvent = {
      type: "transcript-delta",
      sessionId,
      utteranceId,
      delta: transcript,
      content: state.content,
      confidence: state.confidence,
      timestamp: new Date(state.lastUpdated).toISOString(),
      sequence: state.sequence - 1,
      metadata: cloneMetadata(state.metadata),
    };

    this.dispatch(deltaEvent);
  }

  private handleResponseDone(event: ResponseDoneEvent): void {
    if (!event.response?.id) {
      this.logger.warn("response.done missing response id");
      return;
    }

    const responseId = event.response.id;
    const utterances = Array.from(this.activeUtterances.values()).filter(
      (state) => state.responseId === responseId,
    );

    if (utterances.length === 0) {
      this.logger.debug("No active utterances for response", { responseId });
      return;
    }

    for (const state of utterances) {
      this.emitFinalEvent(state);
      this.activeUtterances.delete(state.utteranceId);
    }
  }

  private handleUtteranceFinalEvent(event: RealtimeEvent): void {
    const responseId = (event as { response_id?: string }).response_id;
    const itemId = (event as { item_id?: string }).item_id;

    if (!responseId) {
      this.logger.warn("Final event missing response_id", { type: event.type });
      return;
    }

    const utteranceId = buildUtteranceId(responseId, itemId);
    const state = this.activeUtterances.get(utteranceId);
    if (!state) {
      this.logger.debug("Final event received for unknown utterance", {
        responseId,
        itemId,
      });
      return;
    }

    const finalText = extractTranscriptText(event);
    if (finalText) {
      state.content = finalText;
    }

    const confidence = this.extractConfidence(event);
    if (confidence !== undefined) {
      state.confidence = confidence;
    }

    this.emitFinalEvent(state);
    this.activeUtterances.delete(utteranceId);
  }

  private emitFinalEvent(state: UtteranceState): void {
    const completedAt = now();
    const metadata = cloneMetadata(state.metadata);
    metadata.endOffsetMs = Math.max(1, completedAt - state.startTimestamp);

    const finalEvent: TranscriptFinalEvent = {
      type: "transcript-final",
      sessionId: state.sessionId,
      utteranceId: state.utteranceId,
      content: state.content,
      confidence: state.confidence,
      timestamp: new Date(completedAt).toISOString(),
      metadata,
    };

    this.dispatch(finalEvent);
  }

  private ensureUtteranceState(
    utteranceId: string,
    responseId: string,
    itemId: string | undefined,
    sessionId: string,
  ): UtteranceState {
    const existing = this.activeUtterances.get(utteranceId);
    if (existing) {
      return existing;
    }

    const createdAt = now();
    const metadata: UtteranceMetadata = {
      startOffsetMs: 0,
      locale: DEFAULT_LOCALE,
      chunkCount: 0,
    };

    const state: UtteranceState = {
      utteranceId,
      responseId,
      itemId: itemId ?? "default",
      sessionId,
      content: "",
      chunkCount: 0,
      sequence: 0,
      startTimestamp: createdAt,
      lastUpdated: createdAt,
      metadata,
    };

    this.activeUtterances.set(utteranceId, state);
    return state;
  }

  private extractConfidence(event: RealtimeEvent): number | undefined {
    const delta = (event as { delta?: unknown }).delta;
    if (delta && typeof delta === "object" && "confidence" in delta) {
      const value = (delta as { confidence?: unknown }).confidence;
      if (typeof value === "number") {
        return value;
      }
    }

    const final = (event as { final?: { confidence?: number } }).final;
    if (final && typeof final.confidence === "number") {
      return final.confidence;
    }

    return undefined;
  }

  private dispatch(event: TranscriptEvent): void {
    for (const subscriber of Array.from(this.subscribers)) {
      try {
        const result = subscriber(event);
        if (result && typeof (result as Promise<void>).then === "function") {
          void (result as Promise<void>).catch((error) => {
            this.logger.warn("Transcript subscriber failed", {
              error: error?.message ?? error,
            });
          });
        }
      } catch (error: any) {
        this.logger.warn("Transcript subscriber threw synchronously", {
          error: error?.message ?? error,
        });
      }
    }
  }
}

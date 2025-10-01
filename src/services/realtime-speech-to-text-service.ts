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

/**
 * Describes a callback that receives realtime transcript events as they are emitted.
 *
 * @param event - Transcript payload containing partial or final speech-to-text content.
 */
interface TranscriptSubscriber {
  (event: TranscriptEvent): void | Promise<void>;
}

/**
 * Maintains mutable state for an in-flight utterance emitted by the realtime service.
 */
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

/**
 * Returns the current timestamp in milliseconds.
 *
 * @returns Current epoch timestamp in milliseconds.
 */
function now(): number {
  return Date.now();
}

/**
 * Builds a stable utterance identifier using the response and item identifiers.
 *
 * @param responseId - Identifier assigned to the parent realtime response.
 * @param itemId - Optional response item identifier for multi-item responses.
 * @returns Stable utterance identifier.
 */
function buildUtteranceId(
  responseId: string,
  itemId: string | undefined,
): string {
  return itemId ? `${responseId}-${itemId}` : responseId;
}

/**
 * Creates a defensive copy of utterance metadata so callers cannot mutate shared state.
 *
 * @param metadata - Metadata associated with the utterance.
 * @returns A shallow clone of the provided metadata object.
 */
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

/**
 * Manages realtime speech-to-text events, tracking partial transcripts and notifying subscribers.
 */
export class RealtimeSpeechToTextService implements ServiceInitializable {
  private readonly logger: Logger;
  private initialized = false;
  private sessionId?: string;
  private readonly subscribers = new Set<TranscriptSubscriber>();
  private readonly activeUtterances = new Map<string, UtteranceState>();

  /**
   * Creates a new instance of the realtime speech-to-text service.
   *
   * @param logger - Optional logger instance for structured diagnostics.
   */
  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("RealtimeSpeechToTextService");
  }

  /**
   * Initializes the service with an optional session identifier.
   *
   * @param sessionId - Optional session identifier associated with the realtime connection.
   * @throws Error if initialization occurs in an invalid state.
   */
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

  /**
   * Indicates whether the service has completed initialization.
   *
   * @returns True when the service is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Disposes internal resources, clearing subscribers and tracked utterances.
   */
  dispose(): void {
    this.logger.debug("Disposing RealtimeSpeechToTextService");
    this.initialized = false;
    this.sessionId = undefined;
    this.subscribers.clear();
    this.activeUtterances.clear();
  }

  /**
   * Updates the active session identifier.
   *
   * @param sessionId - Identifier for the active realtime session.
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Registers a subscriber to receive transcript events emitted by the service.
   *
   * @param handler - Callback invoked for each transcript event.
   * @returns Disposable used to unregister the subscriber.
   */
  subscribeTranscript(handler: TranscriptSubscriber): { dispose(): void } {
    this.subscribers.add(handler);
    return {
      dispose: () => {
        this.subscribers.delete(handler);
      },
    };
  }

  /**
   * Processes a realtime event emitted by the Azure OpenAI Realtime API.
   *
   * @param event - Event payload received from the realtime session.
   * @throws Error when invoked prior to initialization.
   */
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

  /**
   * Retrieves the current collection of active (partial) utterances.
   *
   * @returns Array of utterance snapshots describing partial transcript state.
   */
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

  /**
   * Removes all active utterances tracked by the service.
   */
  clearActiveUtterances(): void {
    this.activeUtterances.clear();
  }

  /**
   * Handles incremental transcript updates emitted by the realtime API.
   *
   * @param event - Realtime delta event containing partial transcript content.
   */
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

  /**
   * Handles `response.done` events to finalize any remaining utterances for the response.
   *
   * @param event - Response completion event payload.
   */
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

  /**
   * Finalizes utterances when a terminal transcript event is received.
   *
   * @param event - Realtime event representing the final transcript payload.
   */
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

  /**
   * Emits a final transcript event to subscribers and removes the utterance from active tracking.
   *
   * @param state - Utterance state to finalize.
   */
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

  /**
   * Ensures an utterance state exists for the provided identifiers, creating one when absent.
   *
   * @param utteranceId - Combined utterance identifier.
   * @param responseId - Parent response identifier.
   * @param itemId - Optional response item identifier.
   * @param sessionId - Active realtime session identifier.
   * @returns Mutable utterance state reference.
   */
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

  /**
   * Extracts confidence values from realtime delta or final events.
   *
   * @param event - Realtime transcript event payload.
   * @returns Confidence score when provided by the event; otherwise undefined.
   */
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

  /**
   * Dispatches transcript events to subscribers and logs any synchronous or asynchronous failures.
   *
   * @param event - Transcript event to deliver.
   */
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

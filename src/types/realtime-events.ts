/**
 * Azure OpenAI Realtime API event type definitions.
 *
 * @remarks
 * Shapes mirror the official Realtime API specification for WebRTC
 * integrations and are grouped by functional area for easier discrimination.
 */

/**
 * Base event interface shared by all realtime messages.
 */
export interface RealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

/**
 * Delta payload used by text and transcript streaming events.
 */
export type RealtimeDeltaPayload =
  | string
  | {
      text?: string;
      transcript?: string;
      confidence?: number;
      [key: string]: unknown;
    };

/**
 * Outgoing request used to update session configuration.
 */
export interface SessionUpdateEvent extends RealtimeEvent {
  type: "session.update";
  session: {
    modalities?: ["audio"] | ["text"] | ["audio", "text"];
    output_modalities?: ["audio"] | ["text"] | ["audio", "text"];
    instructions?: string;
    voice?: string;
    locale?: string;
    input_audio_format?:
      | "pcm16"
      | "pcm24"
      | "pcm32"
      | "g711_ulaw"
      | "g711_alaw";
    output_audio_format?:
      | "pcm16"
      | "pcm24"
      | "pcm32"
      | "g711_ulaw"
      | "g711_alaw";
    input_audio_transcription?: {
      model?: string;
    };
    turn_detection?: {
      type: "server_vad" | "semantic_vad" | "none";
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
      create_response?: boolean;
      interrupt_response?: boolean;
      eagerness?: "low" | "auto" | "high";
    };
    tools?: any[];
    tool_choice?:
      | "auto"
      | "none"
      | "required"
      | { type: "function"; name: string };
    temperature?: number;
    max_response_output_tokens?: number;
  };
}

/**
 * Event emitted when the realtime service creates a new session.
 */
export interface SessionCreatedEvent extends RealtimeEvent {
  type: "session.created";
  session: {
    id: string;
    object: "realtime.session";
    model: string;
    modalities: string[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription?: any;
    turn_detection?: any;
    tools: any[];
    tool_choice: string;
    temperature: number;
    max_response_output_tokens?: number;
  };
}

/**
 * Event emitted when existing session properties are updated.
 */
export interface SessionUpdatedEvent extends RealtimeEvent {
  type: "session.updated";
  session: {
    id: string;
    object: "realtime.session";
    model: string;
    modalities: string[];
    instructions: string;
    voice: string;
    input_audio_format: string;
    output_audio_format: string;
    input_audio_transcription?: any;
    turn_detection?: any;
    tools: any[];
    tool_choice: string;
    temperature: number;
    max_response_output_tokens?: number;
  };
}

/**
 * Event used to append base64-encoded audio to the input buffer.
 */
export interface InputAudioBufferAppendEvent extends RealtimeEvent {
  type: "input_audio_buffer.append";
  audio: string; // Base64 encoded audio data
}

/**
 * Event finalizing the current input audio buffer frame.
 */
export interface InputAudioBufferCommitEvent extends RealtimeEvent {
  type: "input_audio_buffer.commit";
}

/**
 * Event clearing staged audio from the input buffer.
 */
export interface InputAudioBufferClearEvent extends RealtimeEvent {
  type: "input_audio_buffer.clear";
}

/**
 * Notification that server-side VAD detected speech start in the buffer.
 */
export interface InputAudioBufferSpeechStartedEvent extends RealtimeEvent {
  type: "input_audio_buffer.speech_started";
  audio_start_ms: number;
  item_id: string;
}

/**
 * Notification that the server detected end of speech in the buffer.
 */
export interface InputAudioBufferSpeechStoppedEvent extends RealtimeEvent {
  type: "input_audio_buffer.speech_stopped";
  audio_end_ms: number;
  item_id: string;
}

/**
 * Event emitted when an in-flight response is interrupted.
 */
export interface ResponseInterruptedEvent extends RealtimeEvent {
  type: "response.interrupted";
  response_id?: string;
  reason?: string;
}

/**
 * Command to create a new conversation item in the realtime session.
 */
export interface ConversationItemCreateEvent extends RealtimeEvent {
  type: "conversation.item.create";
  previous_item_id?: string;
  item: {
    id?: string;
    type: "message" | "function_call" | "function_call_output";
    status?: "completed" | "incomplete";
    role?: "user" | "assistant" | "system";
    content?: Array<{
      type: "input_text" | "input_audio" | "text" | "audio";
      text?: string;
      audio?: string; // Base64 encoded audio
      transcript?: string;
    }>;
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
  };
}

/**
 * Event emitted once a conversation item is persisted by the service.
 */
export interface ConversationItemCreatedEvent extends RealtimeEvent {
  type: "conversation.item.created";
  previous_item_id?: string;
  item: {
    id: string;
    object: "realtime.item";
    type: "message" | "function_call" | "function_call_output";
    status: "completed" | "incomplete";
    role?: "user" | "assistant" | "system";
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
  };
}

/**
 * Command to delete a conversation item by identifier.
 */
export interface ConversationItemDeleteEvent extends RealtimeEvent {
  type: "conversation.item.delete";
  item_id: string;
}

/**
 * Event indicating that a conversation item was removed.
 */
export interface ConversationItemDeletedEvent extends RealtimeEvent {
  type: "conversation.item.deleted";
  item_id: string;
}

/**
 * Command to truncate audio content at a specific index for an item.
 */
export interface ConversationItemTruncateEvent extends RealtimeEvent {
  type: "conversation.item.truncate";
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

/**
 * Event confirming a conversation item was truncated server-side.
 */
export interface ConversationItemTruncatedEvent extends RealtimeEvent {
  type: "conversation.item.truncated";
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

/**
 * Command instructing the service to begin generating a response.
 */
export interface ResponseCreateEvent extends RealtimeEvent {
  type: "response.create";
  response?: {
    modalities?: ["audio"] | ["text"] | ["audio", "text"];
    output_modalities?: ["audio"] | ["text"] | ["audio", "text"];
    instructions?: string;
    voice?: string;
    output_audio_format?: "pcm16" | "g711_ulaw" | "g711_alaw";
    tools?: any[];
    tool_choice?:
      | "auto"
      | "none"
      | "required"
      | { type: "function"; name: string };
    temperature?: number;
    max_output_tokens?: number;
  };
}

/**
 * Event emitted when the service acknowledges response creation.
 */
export interface ResponseCreatedEvent extends RealtimeEvent {
  type: "response.created";
  response: {
    id: string;
    object: "realtime.response";
    status: "in_progress" | "completed" | "cancelled" | "incomplete" | "failed";
    status_details?: any;
    output: any[];
    usage?: any;
  };
}

/**
 * Event emitted when response generation has finished.
 */
export interface ResponseDoneEvent extends RealtimeEvent {
  type: "response.done";
  response: {
    id: string;
    object: "realtime.response";
    status: "completed" | "cancelled" | "incomplete" | "failed";
    status_details?: any;
    output: any[];
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      input_token_details?: {
        cached_tokens?: number;
        text_tokens?: number;
        audio_tokens?: number;
      };
      output_token_details?: {
        text_tokens?: number;
        audio_tokens?: number;
      };
    };
  };
}

/**
 * Event emitted when an output item is appended to the response payload.
 */
export interface ResponseOutputItemAddedEvent extends RealtimeEvent {
  type: "response.output_item.added";
  response_id: string;
  output_index: number;
  item: {
    id: string;
    object: "realtime.item";
    type: "message" | "function_call";
    status: "in_progress" | "completed" | "incomplete";
    role?: "assistant";
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
  };
}

/**
 * Event emitted when an output item completes generation.
 */
export interface ResponseOutputItemDoneEvent extends RealtimeEvent {
  type: "response.output_item.done";
  response_id: string;
  output_index: number;
  item: {
    id: string;
    object: "realtime.item";
    type: "message" | "function_call";
    status: "completed" | "incomplete";
    role?: "assistant";
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
  };
}

/**
 * Event emitted when a content part is added to a response item.
 */
export interface ResponseContentPartAddedEvent extends RealtimeEvent {
  type: "response.content_part.added";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: "text" | "audio";
    text?: string;
    audio?: string;
    transcript?: string;
  };
}

/**
 * Event emitted when a content part finishes streaming.
 */
export interface ResponseContentPartDoneEvent extends RealtimeEvent {
  type: "response.content_part.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: "text" | "audio";
    text?: string;
    audio?: string;
    transcript?: string;
  };
}

/**
 * Delta carrying incremental text output for a response.
 */
export interface ResponseTextDeltaEvent extends RealtimeEvent {
  type: "response.text.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: RealtimeDeltaPayload;
}

/**
 * Event emitted when text output for a response item is finalized.
 */
export interface ResponseTextDoneEvent extends RealtimeEvent {
  type: "response.text.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

/**
 * Delta carrying incremental audio transcript output.
 */
export interface ResponseAudioTranscriptDeltaEvent extends RealtimeEvent {
  type: "response.audio_transcript.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: RealtimeDeltaPayload;
}

/**
 * Event emitted when audio transcript output completes.
 */
export interface ResponseAudioTranscriptDoneEvent extends RealtimeEvent {
  type: "response.audio_transcript.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

/**
 * Delta carrying incremental output text in the response object graph.
 */
export interface ResponseOutputTextDeltaEvent extends RealtimeEvent {
  type: "response.output_text.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index?: number;
  delta: RealtimeDeltaPayload;
}

/**
 * Event emitted when output text generation completes.
 */
export interface ResponseOutputTextDoneEvent extends RealtimeEvent {
  type: "response.output_text.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index?: number;
  text?: string;
}

/**
 * Delta carrying incremental audio transcription from response output.
 */
export interface ResponseOutputAudioTranscriptDeltaEvent extends RealtimeEvent {
  type:
    | "response.output_audio_transcript.delta"
    | "response.output_audio_transcription.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index?: number;
  delta: RealtimeDeltaPayload;
}

/**
 * Event emitted when response audio transcription is complete.
 */
export interface ResponseOutputAudioTranscriptDoneEvent extends RealtimeEvent {
  type:
    | "response.output_audio_transcript.done"
    | "response.output_audio_transcription.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index?: number;
  transcript?: string;
}

/**
 * Delta carrying base64 audio chunks emitted by the response pipeline.
 */
export interface ResponseAudioDeltaEvent extends RealtimeEvent {
  type: "response.audio.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // Base64 encoded audio data
}

/**
 * Event emitted when audio output for a response item finishes streaming.
 */
export interface ResponseAudioDoneEvent extends RealtimeEvent {
  type: "response.audio.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

/**
 * Delta event carrying incremental function call argument content.
 */
export interface ResponseFunctionCallArgumentsDeltaEvent extends RealtimeEvent {
  type: "response.function_call_arguments.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

/**
 * Event emitted when function call arguments are finalized.
 */
export interface ResponseFunctionCallArgumentsDoneEvent extends RealtimeEvent {
  type: "response.function_call_arguments.done";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  arguments: string;
}

/**
 * Event emitted when rate limiting metadata is updated.
 */
export interface RateLimitsUpdatedEvent extends RealtimeEvent {
  type: "rate_limits.updated";
  rate_limits: Array<{
    name: string;
    limit: number;
    remaining: number;
    reset_seconds: number;
  }>;
}

/**
 * Event emitted when the realtime service reports an error condition.
 */
export interface ErrorEvent extends RealtimeEvent {
  type: "error";
  error: {
    type: string;
    code?: string;
    message: string;
    param?: string;
    event_id?: string;
  };
}

/**
 * Union encompassing every supported realtime event type.
 */
export type AnyRealtimeEvent =
  | SessionUpdateEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | ResponseInterruptedEvent
  | ConversationItemCreateEvent
  | ConversationItemCreatedEvent
  | ConversationItemDeleteEvent
  | ConversationItemDeletedEvent
  | ConversationItemTruncateEvent
  | ConversationItemTruncatedEvent
  | ResponseCreateEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseOutputTextDeltaEvent
  | ResponseOutputTextDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseOutputAudioTranscriptDeltaEvent
  | ResponseOutputAudioTranscriptDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | RateLimitsUpdatedEvent
  | ErrorEvent;

/**
 * Determines if an event relates to session management.
 */
export function isSessionEvent(
  event: RealtimeEvent,
): event is SessionUpdateEvent | SessionCreatedEvent | SessionUpdatedEvent {
  return event.type.startsWith("session.");
}

/**
 * Determines if an event is part of the input audio buffer workflow.
 */
export function isAudioBufferEvent(
  event: RealtimeEvent,
): event is
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent {
  return event.type.startsWith("input_audio_buffer.");
}

/**
 * Determines if an event affects the conversation item graph.
 */
export function isConversationEvent(
  event: RealtimeEvent,
): event is
  | ConversationItemCreateEvent
  | ConversationItemCreatedEvent
  | ConversationItemDeleteEvent
  | ConversationItemDeletedEvent
  | ConversationItemTruncateEvent
  | ConversationItemTruncatedEvent {
  return event.type.startsWith("conversation.");
}

/**
 * Determines if an event relates to response lifecycle management.
 */
export function isResponseEvent(
  event: RealtimeEvent,
): event is
  | ResponseCreateEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent {
  return event.type.startsWith("response.") && !event.type.includes(".");
}

/**
 * Determines if an event relates to content streaming (text or audio).
 */
export function isContentEvent(
  event: RealtimeEvent,
): event is
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent {
  return (
    event.type.includes("text.") ||
    event.type.includes("audio.") ||
    event.type.includes("content_part.")
  );
}

/**
 * Determines if an event is an error notification.
 */
export function isErrorEvent(event: RealtimeEvent): event is ErrorEvent {
  return event.type === "error";
}

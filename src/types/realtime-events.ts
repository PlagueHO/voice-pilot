/**
 * Azure OpenAI Realtime API event type definitions
 * Based on the official Realtime API specification for WebRTC integration
 */

// Base event interface
export interface RealtimeEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

// Session management events
export interface SessionUpdateEvent extends RealtimeEvent {
  type: 'session.update';
  session: {
    modalities?: ['audio'] | ['text'] | ['audio', 'text'];
    instructions?: string;
    voice?: 'alloy' | 'shimmer' | 'nova' | 'echo' | 'fable' | 'onyx';
    input_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
    output_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
    input_audio_transcription?: {
      model?: 'whisper-1';
    };
    turn_detection?: {
      type: 'server_vad' | 'none';
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };
    tools?: any[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string };
    temperature?: number;
    max_response_output_tokens?: number;
  };
}

export interface SessionCreatedEvent extends RealtimeEvent {
  type: 'session.created';
  session: {
    id: string;
    object: 'realtime.session';
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

export interface SessionUpdatedEvent extends RealtimeEvent {
  type: 'session.updated';
  session: {
    id: string;
    object: 'realtime.session';
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

// Audio buffer events
export interface InputAudioBufferAppendEvent extends RealtimeEvent {
  type: 'input_audio_buffer.append';
  audio: string; // Base64 encoded audio data
}

export interface InputAudioBufferCommitEvent extends RealtimeEvent {
  type: 'input_audio_buffer.commit';
}

export interface InputAudioBufferClearEvent extends RealtimeEvent {
  type: 'input_audio_buffer.clear';
}

export interface InputAudioBufferSpeechStartedEvent extends RealtimeEvent {
  type: 'input_audio_buffer.speech_started';
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedEvent extends RealtimeEvent {
  type: 'input_audio_buffer.speech_stopped';
  audio_end_ms: number;
  item_id: string;
}

// Conversation events
export interface ConversationItemCreateEvent extends RealtimeEvent {
  type: 'conversation.item.create';
  previous_item_id?: string;
  item: {
    id?: string;
    type: 'message' | 'function_call' | 'function_call_output';
    status?: 'completed' | 'incomplete';
    role?: 'user' | 'assistant' | 'system';
    content?: Array<{
      type: 'input_text' | 'input_audio' | 'text' | 'audio';
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

export interface ConversationItemCreatedEvent extends RealtimeEvent {
  type: 'conversation.item.created';
  previous_item_id?: string;
  item: {
    id: string;
    object: 'realtime.item';
    type: 'message' | 'function_call' | 'function_call_output';
    status: 'completed' | 'incomplete';
    role?: 'user' | 'assistant' | 'system';
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
    output?: string;
  };
}

export interface ConversationItemDeleteEvent extends RealtimeEvent {
  type: 'conversation.item.delete';
  item_id: string;
}

export interface ConversationItemDeletedEvent extends RealtimeEvent {
  type: 'conversation.item.deleted';
  item_id: string;
}

export interface ConversationItemTruncateEvent extends RealtimeEvent {
  type: 'conversation.item.truncate';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

export interface ConversationItemTruncatedEvent extends RealtimeEvent {
  type: 'conversation.item.truncated';
  item_id: string;
  content_index: number;
  audio_end_ms: number;
}

// Response events
export interface ResponseCreateEvent extends RealtimeEvent {
  type: 'response.create';
  response?: {
    modalities?: ['audio'] | ['text'] | ['audio', 'text'];
    instructions?: string;
    voice?: string;
    output_audio_format?: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
    tools?: any[];
    tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string };
    temperature?: number;
    max_output_tokens?: number;
  };
}

export interface ResponseCreatedEvent extends RealtimeEvent {
  type: 'response.created';
  response: {
    id: string;
    object: 'realtime.response';
    status: 'in_progress' | 'completed' | 'cancelled' | 'incomplete' | 'failed';
    status_details?: any;
    output: any[];
    usage?: any;
  };
}

export interface ResponseDoneEvent extends RealtimeEvent {
  type: 'response.done';
  response: {
    id: string;
    object: 'realtime.response';
    status: 'completed' | 'cancelled' | 'incomplete' | 'failed';
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

export interface ResponseOutputItemAddedEvent extends RealtimeEvent {
  type: 'response.output_item.added';
  response_id: string;
  output_index: number;
  item: {
    id: string;
    object: 'realtime.item';
    type: 'message' | 'function_call';
    status: 'in_progress' | 'completed' | 'incomplete';
    role?: 'assistant';
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
  };
}

export interface ResponseOutputItemDoneEvent extends RealtimeEvent {
  type: 'response.output_item.done';
  response_id: string;
  output_index: number;
  item: {
    id: string;
    object: 'realtime.item';
    type: 'message' | 'function_call';
    status: 'completed' | 'incomplete';
    role?: 'assistant';
    content?: any[];
    call_id?: string;
    name?: string;
    arguments?: string;
  };
}

// Content delta events
export interface ResponseContentPartAddedEvent extends RealtimeEvent {
  type: 'response.content_part.added';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: 'text' | 'audio';
    text?: string;
    audio?: string;
    transcript?: string;
  };
}

export interface ResponseContentPartDoneEvent extends RealtimeEvent {
  type: 'response.content_part.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  part: {
    type: 'text' | 'audio';
    text?: string;
    audio?: string;
    transcript?: string;
  };
}

export interface ResponseTextDeltaEvent extends RealtimeEvent {
  type: 'response.text.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseTextDoneEvent extends RealtimeEvent {
  type: 'response.text.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseAudioTranscriptDeltaEvent extends RealtimeEvent {
  type: 'response.audio_transcript.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseAudioTranscriptDoneEvent extends RealtimeEvent {
  type: 'response.audio_transcript.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

export interface ResponseAudioDeltaEvent extends RealtimeEvent {
  type: 'response.audio.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // Base64 encoded audio data
}

export interface ResponseAudioDoneEvent extends RealtimeEvent {
  type: 'response.audio.done';
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

// Function call events
export interface ResponseFunctionCallArgumentsDeltaEvent extends RealtimeEvent {
  type: 'response.function_call_arguments.delta';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent extends RealtimeEvent {
  type: 'response.function_call_arguments.done';
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  arguments: string;
}

// Rate limit events
export interface RateLimitsUpdatedEvent extends RealtimeEvent {
  type: 'rate_limits.updated';
  rate_limits: Array<{
    name: string;
    limit: number;
    remaining: number;
    reset_seconds: number;
  }>;
}

// Error events
export interface ErrorEvent extends RealtimeEvent {
  type: 'error';
  error: {
    type: string;
    code?: string;
    message: string;
    param?: string;
    event_id?: string;
  };
}

// Union type for all possible events
export type AnyRealtimeEvent =
  | SessionUpdateEvent
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
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
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | RateLimitsUpdatedEvent
  | ErrorEvent;

// Event type discrimination helpers
export function isSessionEvent(event: RealtimeEvent): event is SessionUpdateEvent | SessionCreatedEvent | SessionUpdatedEvent {
  return event.type.startsWith('session.');
}

export function isAudioBufferEvent(event: RealtimeEvent): event is InputAudioBufferAppendEvent | InputAudioBufferCommitEvent | InputAudioBufferClearEvent | InputAudioBufferSpeechStartedEvent | InputAudioBufferSpeechStoppedEvent {
  return event.type.startsWith('input_audio_buffer.');
}

export function isConversationEvent(event: RealtimeEvent): event is ConversationItemCreateEvent | ConversationItemCreatedEvent | ConversationItemDeleteEvent | ConversationItemDeletedEvent | ConversationItemTruncateEvent | ConversationItemTruncatedEvent {
  return event.type.startsWith('conversation.');
}

export function isResponseEvent(event: RealtimeEvent): event is ResponseCreateEvent | ResponseCreatedEvent | ResponseDoneEvent | ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent {
  return event.type.startsWith('response.') && !event.type.includes('.');
}

export function isContentEvent(event: RealtimeEvent): event is ResponseContentPartAddedEvent | ResponseContentPartDoneEvent | ResponseTextDeltaEvent | ResponseTextDoneEvent | ResponseAudioTranscriptDeltaEvent | ResponseAudioTranscriptDoneEvent | ResponseAudioDeltaEvent | ResponseAudioDoneEvent {
  return event.type.includes('text.') || event.type.includes('audio.') || event.type.includes('content_part.');
}

export function isErrorEvent(event: RealtimeEvent): event is ErrorEvent {
  return event.type === 'error';
}

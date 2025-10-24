---
title: Text-to-Speech Output Service
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-27
owner: VoicePilot Project
tags: [tool, audio, tts, azure, realtime]
---
<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the text-to-speech (TTS) output capability for VoicePilot, enabling Azure OpenAI Realtime models to synthesize natural speech for conversational responses inside the VS Code extension. It covers streaming synthesis, playback orchestration, interruption handling, and UI integration needed to deliver low-latency, full-duplex audio experiences that align with the project’s webview-based audio architecture.

## 1. Purpose & Scope

This specification establishes the requirements and interfaces for converting generated text into audible speech within VoicePilot. Scope includes:

- Invoking Azure OpenAI Realtime speech synthesis with ephemeral authentication.
- Managing streaming audio buffers from the Realtime API in the webview context.
- Coordinating playback with UI state transitions (Listening, Speaking, Thinking).
- Supporting interruption, cancellation, and voice selection.
- Ensuring accessibility-compliant audio behaviour and resource cleanup.

**Intended Audience**: Extension developers, audio engineers, QA engineers, and interaction designers.

**Assumptions**:

- Core extension lifecycle satisfies SP-001 requirements.
- Microphone capture and input pipeline follow SP-007 architecture.
- WebRTC transport (SP-006) or WebSocket fallback already established.
- VS Code webview reuses the shared Web Audio API 1.1 `AudioContext` (default render quantum size 128 frames) provisioned by SP-007 for both capture and playback; TTS MUST NOT allocate additional contexts.
- GitHub Copilot integration may deliver long-form text requiring chunked rendering.

## 2. Definitions

- **Text-to-Speech (TTS)**: Automated conversion of text into spoken audio.
- **Realtime Synthesis Session**: Active Azure OpenAI Realtime connection producing audio responses.
- **Audio Chunk**: Base64 or binary PCM16 segment received from the Realtime API.
- **Playback Queue**: Ordered buffer of audio chunks awaiting decoding or playback.
- **Interruption Event**: Signal requesting the current audio response to stop immediately.
- **Voice Profile**: Azure OpenAI model parameter describing voice timbre and language locale.
- **Prosody Controls**: Rate, pitch, and volume adjustments applied to synthesized speech.
- **Latency Budget**: Maximum allowable delay between text generation and audible speech (target <300 ms).

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The TTS service SHALL stream synthesized audio from Azure OpenAI Realtime models in PCM16 format compatible with the audio playback pipeline defined in SP-007.
- **REQ-002**: The TTS service SHALL start playback within 300 ms of receiving the first audio chunk, assuming network RTT <100 ms.
- **REQ-003**: The TTS service SHALL expose controls to start, pause, resume, and stop playback, with stop mapped to immediate flush of pending audio buffers.
- **REQ-004**: The TTS service SHALL publish speaking state updates to the extension host so the UI can reflect “Speaking” status per UI design guidelines.
- **REQ-005**: The TTS service SHALL support configurable voice profiles (voice name, locale, speaking style) and persist the last-used profile in configuration. Voice changes MUST be applied by establishing a fresh realtime session before additional audio is emitted, because Azure Realtime voices become immutable once a session streams audio.
- **REQ-006**: The service SHALL synchronize text captions/transcripts with audio chunk timestamps for accessibility (closed captioning) and logging, deriving caption latency from Azure `response.audio_transcript.delta` / `.done` events rather than client-side timers.
- **REQ-007**: The service SHALL honour user interruption events by fading out active audio within 250 ms and cancelling any in-flight Azure response. This includes issuing `response.cancel` and, for WebRTC sessions, `output_audio_buffer.clear`, followed by `conversation.item.truncate` when transcript synchronization is required.
- **REQ-008**: The service SHALL provide audio-level metrics for playback to support UI visualizations and diagnostics.
- **REQ-009**: The service SHALL send an initial `session.update` configuring `modalities: ["text","audio"]`, selected voice, `output_audio_format: "pcm16"`, and any turn detection settings before creating audio responses.
- **REQ-010**: The service SHALL default to Azure Realtime API version `2025-04-01-preview`, unless a newer supported version is explicitly configured.
- **REQ-011**: The service SHALL consume the shared Web Audio API 1.1 `AudioContext`, validating `audioContext.renderQuantumSize` remains 128 frames (or another negotiated size agreed with SP-007) before starting playback, and SHALL avoid creating additional contexts.
- **REQ-012**: The playback pipeline SHALL stream audio through Web Audio API 1.1 `AudioWorkletNode` processors and SHALL NOT instantiate deprecated `ScriptProcessorNode` objects.
- **SEC-001**: Ephemeral credentials SHALL be used for initiating synthesis sessions; long-lived keys SHALL NOT be exposed to the webview.
- **SEC-002**: Audio output buffers SHALL be cleared from memory after playback or cancellation to avoid accidental reuse.
- **CON-001**: Playback MUST operate entirely within the webview context; no Node.js audio APIs are permitted due to VS Code sandboxing.
- **CON-002**: Offline or degraded mode MUST fall back to textual responses with explicit notification when Azure TTS is unavailable.
- **CON-003**: Maximum concurrent TTS sessions per workspace SHALL be limited to one; new sessions MUST cancel the active one before starting.
- **GUD-001**: Prefer incremental rendering of long responses by playing chunks while the remaining text is still being generated.
- **GUD-002**: Apply harmonic smoothing to avoid audible clicks when splitting or resuming playback.
- **GUD-003**: Emit structured telemetry (if enabled) using anonymized playback metrics only; never log raw audio data.
- **GUD-004**: Align audible cues with UI states described in `docs/design/UI.md`, including thinking and interruption transitions.
- **GUD-005**: Preload and share AudioWorklet processor modules during initialization so render quanta stay synchronized across capture and playback paths.
- **PAT-001**: Use Observer pattern for state updates to interested UI and session components.
- **PAT-002**: Use Command pattern for playback control requests (start, pause, resume, stop) originating from host commands or voice triggers.
- **PAT-003**: Apply Circuit Breaker pattern for Azure synthesis calls to throttle repeated failures and trigger degraded mode.

## 4. Interfaces & Data Contracts

### TTS Service Interface

```typescript
import { ServiceInitializable } from '../core/service-initializable';
import { TtsVoiceProfile, TtsPlaybackEvent } from '../types/tts';

export interface TextToSpeechService extends ServiceInitializable {
  initialize(config: TtsServiceConfig): Promise<void>;
  speak(request: TtsSpeakRequest): Promise<TtsSpeakHandle>;
  stop(handleId?: string): Promise<void>;
  pause(handleId: string): Promise<void>;
  resume(handleId: string): Promise<void>;
  updateVoiceProfile(profile: Partial<TtsVoiceProfile>): Promise<void>;
  onPlaybackEvent(listener: (event: TtsPlaybackEvent) => void): Disposable;
  getActiveHandle(): TtsSpeakHandle | null;
  getMetrics(): TtsPlaybackMetrics;
}

export interface TtsServiceConfig {
  endpoint: string;
  deployment: string;
  apiVersion: string;
  transport: 'webrtc' | 'websocket';
  defaultVoice: TtsVoiceProfile;
  fallbackMode: 'text-only' | 'retry';
  maxInitialLatencyMs: number;
  audioContext: BaseAudioContext; // Shared Web Audio API 1.1 context from SP-007
  expectedRenderQuantumSize?: number; // Defaults to 128 frames (Web Audio API 1.1)
}

export interface TtsSpeakRequest {
  text: string;
  voice?: Partial<TtsVoiceProfile>;
  surfaceHints?: string[]; // e.g., ['summary', 'action-items']
  prosody?: ProsodyConfig;
  metadata?: {
    conversationId: string;
    copilotRequestId?: string;
  };
}

export interface TtsSpeakHandle {
  id: string;
  state: 'pending' | 'speaking' | 'paused' | 'stopped' | 'completed' | 'failed';
  enqueuedAt: number;
  startedAt?: number;
  stoppedAt?: number;
}
```

### Playback Events (Host ↔ Webview)

```typescript
type TtsPlaybackEventType =
  | 'speaking-state-changed'
  | 'chunk-received'
  | 'chunk-played'
  | 'playback-error'
  | 'playback-complete'
  | 'interrupted'
  | 'metrics-updated';

interface TtsPlaybackEvent {
  type: TtsPlaybackEventType;
  handleId: string;
  timestamp: number;
  data?: {
    state?: 'idle' | 'speaking' | 'paused' | 'stopping';
    chunkSize?: number;
    transcriptDelta?: string;
    latencyMs?: number;
    audioLevel?: number;
    error?: TtsError;
  };
}

interface TtsError {
  code: 'AUTH_FAILED' | 'NETWORK_ERROR' | 'STREAM_TIMEOUT' | 'UNSUPPORTED_VOICE' | 'UNKNOWN';
  message: string;
  recoverable: boolean;
}
```

### Webview Playback Pipeline Contract

```typescript
export interface PlaybackPipeline {
  attachAudioContext(context: BaseAudioContext): Promise<void>;
  prime(): Promise<void>;
  enqueue(chunk: ArrayBuffer, metadata: ChunkMetadata): Promise<void>;
  fadeOut(durationMs: number): Promise<void>;
  flush(): Promise<void>;
  getBufferedDuration(): number;
  onStateChange(callback: (state: PlaybackState) => void): Disposable;
  getRenderQuantumSize(): number;
}

export interface ChunkMetadata {
  sequence: number;
  durationMs: number;
  transcript?: string;
}

export interface PlaybackState {
  status: 'idle' | 'buffering' | 'speaking' | 'paused';
  bufferMs: number;
  activeVoice: string;
  averageLatencyMs: number;
}
```

### Host ↔ Webview Message Schema

```json
{
  "type": "tts.speak",
  "payload": {
    "handleId": "uuid",
    "text": "string",
    "voice": { "name": "alloy", "locale": "en-US", "style": "narration" },
    "prosody": { "rate": 1.0, "pitch": 0, "volume": 0 }
  }
}

{
  "type": "tts.control",
  "payload": { "handleId": "uuid", "command": "pause" }
}

{
  "type": "tts.event",
  "payload": {
    "handleId": "uuid",
    "event": "speaking-state-changed",
    "state": "speaking",
    "timestamp": 17326452123
  }
}
```

### Realtime Session Configuration Example

```json
{
  "type": "session.update",
  "session": {
    "modalities": ["text", "audio"],
    "voice": "alloy",
    "output_audio_format": "pcm16",
    "turn_detection": {
      "type": "server_vad",
      "threshold": 0.5,
      "prefix_padding_ms": 300,
      "silence_duration_ms": 200,
      "create_response": true,
      "interrupt_response": true
    }
  }
}
```

> Voice selections become immutable after the session streams audio, so any subsequent voice change MUST initialize a new session before issuing another `response.create`. This update MUST succeed before requesting audio output to guarantee PCM16 delivery and caption deltas.

> Playback pipelines attach to the shared Web Audio API 1.1 `AudioContext` before priming so AudioWorklet processors load exactly once and render quantum telemetry can be surfaced to diagnostics.

## 5. Acceptance Criteria

- **AC-001**: Given a synthesized response, When the first audio chunk arrives, Then playback begins within 300 ms and the UI status changes to “Speaking”.
- **AC-002**: Given the user issues an interruption (voice or UI), When `stop()` is invoked, Then playback fades out within 250 ms, the client emits `response.cancel` (and `output_audio_buffer.clear` for WebRTC sessions) followed by `conversation.item.truncate` if needed, and the server returns `response.cancelled`, `output_audio_buffer.cleared`, and/or `conversation.item.truncated` to confirm cancellation.
- **AC-003**: Given a voice profile change, When `updateVoiceProfile()` is called, Then the service tears down or refreshes the realtime session before the next `speak()` so the updated voice is honored by Azure.
- **AC-004**: Given network loss during playback, When a stream timeout occurs, Then the service emits a `playback-error` event and transitions to degraded text-only mode with user notification.
- **AC-005**: Given captions are enabled, When audio is played, Then transcript deltas are emitted within 150 ms of each audio chunk for caption rendering.
- **AC-006**: Given a conversation session restarts, When `initialize()` is invoked again, Then all previous playback resources are disposed and no residual audio remains.
- **AC-007**: Given no API version override is provided, When the service initializes, Then it uses Azure Realtime API version `2025-04-01-preview`.
- **AC-008**: Given playback is active, When diagnostics run, Then telemetry confirms only the shared Web Audio API 1.1 `AudioContext` is in use and that `renderQuantumSize` matches the configured expectation (default 128).

## 6. Test Automation Strategy

- **Test Levels**:
  - Unit: Validate state machine transitions, chunk scheduling, and voice profile validation with Jest/Mocha.
  - Integration: Stub Azure Realtime endpoints with WebSocket fixtures to verify streaming playback inside a headless browser (Playwright).
  - End-to-End: Launch VS Code extension host tests validating UI state transitions (`voicepilot.speakingState`) via `@vscode/test-electron`.
- **Frameworks**: Mocha + ts-sinon for extension logic, Playwright for webview audio harness, jest-worker (or vitest) for web audio pipeline simulations.
- **Test Data Management**: Use deterministic PCM fixtures (short tone, speech sample) and transcript JSON fixtures stored under `test/fixtures/tts`.
- **CI/CD Integration**: Extend `Test Extension` task with optional `TTS_STUB_ENDPOINT` environment variable pointing to mocked Azure Realtime server.
- **Coverage Requirements**: ≥90% branch coverage on playback state machine, 100% coverage on interruption handling paths.
- **Performance Testing**: Add `npm run test:perf` probe measuring synthesis-to-playback latency using synthetic responses; fail build if average latency exceeds 350 ms.
- **Accessibility Testing**: Automated check ensuring captions events fire when accessibility flag is enabled, and manual screen reader validation before release.
- **Web Audio Compliance Testing**: Assert that the playback pipeline attaches to the shared `AudioContext`, loads AudioWorklet processors, and reports a consistent render quantum size without creating additional contexts.

## 7. Rationale & Context

Streaming TTS is essential to VoicePilot’s conversational UX, enabling full-duplex dialog where speech overlaps text responses. Aligning with SP-001 ensures services initialize and dispose predictably. Session Manager responsibilities in SP-005 orchestrate session restarts for voice changes and interruption sequencing, while SP-006 defines the transport primitives leveraged by this spec’s realtime events. Integration with SP-007 guarantees audio playback uses the same Web Audio infrastructure as capture, simplifying device management and echo prevention. UI design documents mandate distinct “Speaking” cues, so this spec enforces state propagation and accessible captions. Azure Realtime provides unified STT/TTS transport; using shared infrastructure minimizes latency and authentication complexity.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Realtime API – Provides streaming audio synthesis over WebRTC/WebSocket.
- **EXT-002**: GitHub Copilot Chat APIs – Source of textual responses that require spoken playback.

### Third-Party Services

- **SVC-001**: Azure Identity (DefaultAzureCredential) – Supplies bearer tokens for TTS sessions with ephemeral key fallback.
- **SVC-002**: Optional CDN for caching static audio prompts (future enhancement).

### Infrastructure Dependencies

- **INF-001**: Ephemeral Key Service (SP-004) – Issues TTS session credentials.
- **INF-002**: Session Manager (SP-005) – Coordinates session lifecycle, interruption, and renewal logic.

### Data Dependencies

- **DAT-001**: Conversation transcripts stored in memory for the active session; used for caption alignment.
- **DAT-002**: User configuration settings (`voicepilot.audio.voiceProfile`) persisted via Configuration Manager (SP-002).

### Technology Platform Dependencies

- **PLT-001**: VS Code webview runtime with Web Audio API support.
- **PLT-002**: WebRTC transport layer (SP-006) or OpenAI realtime WebSocket fallback in environments lacking WebRTC.
- **PLT-003**: Web Audio API 1.1 runtime (Chromium) – Provides the shared `AudioContext`, `AudioWorklet`, and render quantum guarantees consumed by capture and playback services.

### Compliance Dependencies

- **COM-001**: Accessibility (WCAG 2.1 AA) – Captions and user controls must meet accessibility standards.
- **COM-002**: Privacy policy (SP-027 future) – Audio output must respect retention and masking rules.

## 9. Examples & Edge Cases

```typescript
const audioContext = capturePipeline.getSharedAudioContext(); // Provided by SP-007
await playbackPipeline.attachAudioContext(audioContext);
await playbackPipeline.prime();

const ttsService = container.resolve<TextToSpeechService>('TextToSpeechService');

await ttsService.initialize({
  endpoint: config.azure.endpoint,
  deployment: config.azure.deploymentName,
  apiVersion: config.azure.apiVersion ?? '2025-04-01-preview',
  transport: 'webrtc',
  defaultVoice: {
    name: 'alloy',
    locale: 'en-US',
    style: 'conversational',
    gender: 'unspecified'
  },
  fallbackMode: 'text-only',
  maxInitialLatencyMs: 300,
  audioContext,
  expectedRenderQuantumSize: audioContext.renderQuantumSize ?? 128
});

ttsService.onPlaybackEvent((event) => {
  if (event.type === 'speaking-state-changed') {
    vscode.commands.executeCommand('setContext', 'voicepilot.speaking', event.data?.state === 'speaking');
  }
});

const handle = await ttsService.speak({
  text: 'Here are the top three architecture considerations for the authentication feature...',
  surfaceHints: ['summary', 'architecture'],
  prosody: { rate: 0.95, pitch: -1 }
});

// User interrupts via voice
sessionEvents.on('user-interrupt', async () => {
  await ttsService.stop(handle.id);
});
```

### Edge Case: Network Timeout During Playback

```typescript
try {
  await ttsService.speak({ text: longResponse });
} catch (error) {
  if (error.code === 'STREAM_TIMEOUT') {
    notificationService.warn('Speech playback interrupted. Continuing in text-mode.');
    await ttsService.stop();
  }
}
```

### Edge Case: Voice Profile Not Supported

```typescript
try {
  await ttsService.updateVoiceProfile({ name: 'voice-that-does-not-exist' });
} catch (error) {
  logger.warn('Falling back to default voice profile', { error });
  await ttsService.updateVoiceProfile({ name: 'alloy' }); // Implementation MUST restart the realtime session before the next speak call.
}
```

## 10. Validation Criteria

- TTS playback aligns with UI state transitions and indicator behaviour defined in `docs/design/UI.md`.
- Audio buffers are streamed, decoded, and disposed without memory growth over a 10-minute conversation.
- Interruption tests demonstrate fade-out and cancellation within required timing budgets, including emission of `response.cancel`, `output_audio_buffer.clear` (WebRTC), and `conversation.item.truncate` events.
- Voice selection persists across sessions and correctly reflects configuration updates by restarting the realtime session before additional audio is requested.
- Accessibility review confirms captions and controls operate with keyboard and screen readers.
- Degraded mode notifications appear whenever Azure synthesis is unreachable for more than 2 retries.
- Configuration validation enforces `apiVersion = '2025-04-01-preview'` when not explicitly overridden and verifies the initial `session.update` payload includes `modalities`, `voice`, and `output_audio_format: "pcm16"`.
- Web Audio validation confirms the playback pipeline is attached to the shared `AudioContext`, reports the expected render quantum size, and uses AudioWorklet processors exclusively.

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline Architecture](sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-009: Speech-to-Text Integration](sp-009-spec-tool-realtime-stt.md)
- [VoicePilot Extension UI Design](../docs/design/UI.md)
- [VoicePilot Extension Components Design](../docs/design/COMPONENTS.md)
- Azure OpenAI GPT Realtime API documentation
- [Web Audio API 1.1 Specification](https://webaudio.github.io/web-audio-api/)

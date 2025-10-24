---
title: Interruption & Turn-Taking Engine Specification
version: 1.0
date_created: 2025-09-26
last_updated: 2025-09-26
owner: VoicePilot Project
tags: [design, conversation, audio, realtime, azure]
---

<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the interruption and turn-taking engine that coordinates conversational control across VoicePilot’s realtime audio pipeline. The engine orchestrates user and assistant turns, manages barge-in behaviour, synchronizes with Azure OpenAI GPT Realtime API signals, and keeps UI states aligned with speech activity. It bridges voice activity detection (SP-008), realtime transcription (SP-009), text-to-speech playback (SP-010), and the forthcoming conversation state machine (SP-012) to deliver a natural, low-latency dialogue experience consistent with the UI principles documented in `docs/design/UI.md` and the component responsibilities in `docs/design/COMPONENTS.md`.

## 1. Purpose & Scope

The specification covers the functional rules, interfaces, and operational workflows needed for the interruption and turn-taking engine (ITE):

- Mediate transitions between Listening, Thinking, Speaking, and Idle states across the session lifecycle.
- Coordinate Azure server VAD events, local heuristics, and manual overrides to detect turn boundaries and interruptions.
- Control speech synthesis playback and transcription flow to support barge-in, polite handoffs, and conversation pausing.
- Provide deterministic state propagation to UI components, Copilot orchestration, and downstream analytics.
- Enforce security, accessibility, and performance constraints consistent with VoicePilot architecture.

The scope excludes the detailed state machine specification (covered by SP-012 once authored) and low-level audio capture/decoding (SP-007). The ITE depends on those components but focuses on orchestration and policy.

**Intended Audience**: VoicePilot extension engineers, audio/session orchestrators, QA automation engineers, and interaction designers.

**Assumptions**:

1. Azure Realtime sessions are established over WebRTC per SP-006, with server VAD enabled by default (SP-008).
2. Realtime transcription (SP-009) and TTS (SP-010) services emit structured events via the extension’s message bus.
3. Session Manager (SP-005) maintains session identity, timers, and credential rotation.
4. Conversation state machine spec (SP-012) will formalize state transitions; until then, this document defines interim guardrails.
5. UI states and accessibility requirements follow `docs/design/UI.md`, including listening/thinking/speaking cues and interruption affordances.

## 2. Definitions

- **Interruption & Turn-Taking Engine (ITE)**: Service responsible for detecting speaker turns, managing barge-in, and broadcasting authoritative conversation state.
- **Turn**: Contiguous segment of speech from a single participant (user or assistant) bounded by VAD or manual cues.
- **Barge-In**: User speech that interrupts assistant playback, requiring immediate transition back to user turn.
- **Graceful Handoff**: Non-interruptive transition where assistant finishes speaking before yielding control.
- **Hybrid Mode**: Operating mode combining server VAD with client hint heuristics for latency-sensitive UI.
- **Conversation State**: Aggregate status (`idle`, `listening`, `thinking`, `speaking`, `recovering`) shared with UI and Copilot integrations.
- **Turn Token**: Internal grant ensuring only one participant holds the speaking role at a time.
- **Interruption Budget**: Maximum allowable time between detecting user speech and stopping assistant audio (target ≤250 ms).
- **Policy Profile**: Configuration bundle describing how aggressively to interrupt (e.g., `default`, `assertive`, `hands-free`).
- **Recovery Window**: Period after interruption during which the assistant must discard queued audio and resume listening.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The ITE SHALL own the authoritative conversation state and broadcast updates to registered consumers (UI, session manager, Copilot adapter) within 50 ms of state change detection.
- **REQ-002**: The ITE SHALL integrate Azure server VAD events (`input_audio_buffer.speech_started`, `speech_stopped`, `response.done`) as primary turn boundary signals, with client hint VAD (SP-008) used as advisory input only.
- **REQ-003**: The ITE SHALL detect user barge-in by observing speech-start events while assistant playback is active and SHALL trigger assistant interruption within the defined interruption budget (≤250 ms), invoking TTS cancellation hooks (`response.cancel`, `output_audio_buffer.clear`) per SP-010.
- **REQ-004**: The ITE SHALL coordinate with the Speech-to-Text service (SP-009) to suspend or resume transcript aggregation during interruptions, ensuring utterance metadata correctly reflects turn ownership changes.
- **REQ-005**: The ITE SHALL expose a policy configuration surface via Configuration Manager (SP-002) enabling selection of policy profiles, thresholds, and whether barge-in is allowed, with validation boundaries documented in Technical Reference Index sources.
- **REQ-006**: The ITE SHALL guarantee mutual exclusion of turn tokens, preventing simultaneous assistant and user speaking states except during the defined recovery window.
- **REQ-007**: The ITE SHALL surface detailed interruption context (timestamps, source, policy profile, latency) to structured logs while redacting audio content per privacy roadmap (SP-027).
- **REQ-008**: The ITE SHALL provide explicit APIs for forced handoff (assistant yield) and manual resume, enabling Copilot-driven flows to request control changes.
- **REQ-009**: The ITE SHALL detect degraded conditions (missing VAD events for >5 seconds, STT stall, TTS failure) and transition to `recovering` state, publishing user-facing guidance and enabling manual controls.
- **REQ-010**: The ITE SHALL emit `response.create` commands when policy requires immediate assistant reply after a user turn completes and `create_response` is false, aligning with SP-009 expectations.
- **REQ-011**: The ITE SHALL support multi-modal transcripts by synchronizing `response.output_audio_transcript.delta` events with turn states, ensuring captions remain consistent during interruptions.
- **REQ-012**: The ITE SHALL notify the forthcoming conversation state machine (SP-012) via event contracts, ensuring compatibility once that component is delivered.
- **SEC-001**: The ITE SHALL treat all interruption metadata as sensitive and avoid transmitting it outside the extension host except via secure UI channels.
- **SEC-002**: The ITE SHALL enforce configuration limits to prevent denial-of-service (e.g., minimum silence duration 150 ms, maximum interruption budget 750 ms) and reject unsafe overrides.
- **CON-001**: The ITE MUST operate entirely within the webview/extension messaging constraints—no blocking operations exceeding 5 ms per event handler.
- **CON-002**: The ITE MUST degrade gracefully during offline mode by enabling manual commit controls and disabling auto-response triggers.
- **CON-003**: Turn state transitions MUST align with UI.md indicators; inconsistent states are considered defects.
- **GUD-001**: Default policy profile SHALL favour accessibility by allowing immediate user interruption while providing audible feedback fade-outs (per UI.md audio guidance).
- **GUD-002**: Record latency metrics (`speech_start → interruption` and `speech_stop → assistant start`) for later perf analysis (SP-030 future).
- **GUD-003**: Provide developer tooling (diagnostic command) to visualize turn history for debugging conversation flows.
- **PAT-001**: Implement Observer pattern for consumers to subscribe to turn state changes without tight coupling.
- **PAT-002**: Employ State Machine pattern (aligned with SP-012) to maintain deterministic transitions and guard conditions.
- **PAT-003**: Use Strategy pattern to swap policy profiles and VAD sources at runtime without restarting the session.

## 4. Interfaces & Data Contracts

```typescript
import { Disposable } from 'vscode';
import { ServiceInitializable } from '../core/service-initializable';

export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'recovering';

export interface TurnDescriptor {
  turnId: string;
  role: 'user' | 'assistant';
  startedAt: string; // ISO timestamp
  endedAt?: string;
  interruption?: InterruptionInfo;
  policyProfile: PolicyProfileId;
}

export interface InterruptionInfo {
  type: 'barge-in' | 'manual-stop' | 'policy-yield';
  detectedAt: string;
  latencyMs: number;
  source: 'azure-vad' | 'client-hint' | 'ui-command' | 'system';
  reasonCode?: string;
}

export type PolicyProfileId = 'default' | 'assertive' | 'hands-free' | 'custom';

export interface InterruptionPolicyConfig {
  profile: PolicyProfileId;
  allowBargeIn: boolean;
  interruptionBudgetMs: number; // default 250
  completionGraceMs: number; // assistant grace period before yielding
  speechStopDebounceMs: number; // default 200
  fallbackMode: 'manual' | 'hybrid';
}

export interface TurnEvent {
  type:
    | 'state-changed'
    | 'turn-started'
    | 'turn-ended'
    | 'interruption'
    | 'policy-updated'
    | 'degraded'
    | 'recovered';
  state: ConversationState;
  turn?: TurnDescriptor;
  timestamp: string;
  diagnostics?: Record<string, unknown>;
}

export interface InterruptionEngine extends ServiceInitializable {
  configure(policy: InterruptionPolicyConfig): Promise<void>;
  handleSpeechEvent(event: SpeechActivityEvent): Promise<void>;
  handlePlaybackEvent(event: PlaybackActivityEvent): Promise<void>;
  requestAssistantYield(reason: string): Promise<void>;
  grantAssistantTurn(hints?: TurnHints): Promise<void>;
  getConversationState(): ConversationState;
  getActiveTurn(): TurnDescriptor | null;
  onEvent(listener: (event: TurnEvent) => void): Disposable;
}

export interface SpeechActivityEvent {
  type: 'user-speech-start' | 'user-speech-stop' | 'assistant-speech-start' | 'assistant-speech-stop' | 'vad-degraded';
  source: 'azure-vad' | 'client-hint' | 'manual';
  timestamp: string;
  latencyMs?: number;
}

export interface PlaybackActivityEvent {
  type: 'assistant-playback-started' | 'assistant-playback-ended' | 'assistant-playback-cancelled';
  handleId?: string;
  timestamp: string;
  latencyMs?: number;
}

export interface TurnHints {
  expectResponse?: boolean;
  autoResponseDelayMs?: number;
  copilotRequestId?: string;
}
```

Messaging payloads exchanged between the webview and extension host SHALL follow the pattern:

```json
{
  "type": "voicepilot.turn.event",
  "payload": {
    "state": "listening",
    "turn": {
      "turnId": "turn-123",
      "role": "user",
      "startedAt": "2025-09-26T17:10:32.123Z",
      "policyProfile": "default"
    },
    "timestamp": "2025-09-26T17:10:32.150Z"
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given server VAD emits `speech_started` while assistant audio is playing, When barge-in is allowed, Then ITE transitions to `listening`, cancels playback within 250 ms, and emits an `interruption` event with latency details.
- **AC-002**: Given a user finishes speaking and policy `expectResponse=true`, When `speech_stopped` is received, Then ITE enters `thinking`, waits for transcript finalization, and issues `response.create` unless Copilot has already produced a response.
- **AC-003**: Given policy profile `hands-free` disables barge-in, When user speaks during assistant playback, Then ITE queues a pending user turn and resumes listening only after assistant playback ends.
- **AC-004**: Given Azure VAD degrades (no events for >5 seconds), When fallback mode is `hybrid`, Then ITE enables client hint VAD, marks state `recovering`, and surfaces a diagnostic toast per UI guidelines.
- **AC-005**: Given manual yield command (`requestAssistantYield`) is invoked, When assistant playback is active, Then ITE stops audio, transitions to `listening`, and logs the reason code.
- **AC-006**: Given configuration changes via settings, When policy is updated, Then subscribers receive `policy-updated` event and new thresholds apply without restarting the session.
- **AC-007**: Given consecutive interruptions (≥3 within 60 seconds), When policy dictates cooldown, Then ITE enforces a 2-second minimum assistant completion window before allowing subsequent barge-ins.
- **AC-008**: Given conversation resumes after recovery, When server VAD events normalize, Then ITE transitions out of `recovering` and clears fallback indicators within 1 second.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for state machine transitions and policy application; integration tests with simulated Azure realtime events and mocked TTS/STT services; VS Code extension host tests verifying UI context updates (`voicepilot.conversationState`).
- **Frameworks**: Mocha + Sinon for unit/integration (Node context), Playwright for webview event sequencing, `@vscode/test-electron` for end-to-end interruption scenarios.
- **Test Data Management**: JSON fixtures representing Azure event sequences (normal, barge-in, degraded), audio playback mocks, and configuration permutations stored under `test/fixtures/turn-engine`.
- **CI/CD Integration**: Include deterministic interruption suites in `npm run test:unit`; gate release builds with integration scenarios executed via `Test Extension`. Provide optional `TURN_ENGINE_TRACE=1` env flag to emit verbose logs during CI diagnostics.
- **Coverage Requirements**: ≥95% branch coverage on state machine logic, ≥90% statement coverage overall, explicit assertions on interruption budget timing.
- **Performance Testing**: Extend `npm run test:perf` harness to measure state transition latency using synthetic timestamps; fail if average exceeds 200 ms for speech-start or 300 ms for speech-stop sequences.
- **Resilience Testing**: Simulate packet loss, delayed events, and repeated interruptions; verify cooldown enforcement and fallback activation.
- **Accessibility Testing**: Validate screen reader announcements of state changes via Voice Control Panel and confirm keyboard shortcuts trigger manual yield/stop commands.

## 7. Rationale & Context

Azure’s GPT Realtime API provides authoritative turn detection signals and supports interruption features such as `interrupt_response` and `output_audio_buffer.clear`. Leveraging these capabilities (per the Technical Reference Index quickstart and reference documents) minimizes custom DSP complexity while enabling synchronized captions and playback control. The ITE centralizes policy decisions so that STT (SP-009) and TTS (SP-010) remain focused on streaming, while Session Manager (SP-005) handles lifecycle. UI guidelines demand immediate, accessible feedback when users interrupt VoicePilot, and component architecture (COMPONENTS.md) assigns coordination responsibilities to the session layer; this spec formalizes the contracts ensuring cohesive behaviour. Future state machine work (SP-012) will refine transitions, but the patterns and interfaces defined here ensure forward compatibility.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI GPT Realtime API – Source of VAD, transcript, and interruption control events.

### Third-Party Services

- **SVC-001**: Azure Identity (DefaultAzureCredential) – Supplies tokens for realtime sessions through Ephemeral Key Service (SP-004).

### Infrastructure Dependencies

- **INF-001**: Session Manager (SP-005) – Manages session lifecycle, timers, and credential rotation.
- **INF-002**: WebRTC Transport (SP-006) – Provides realtime audio channel delivering VAD and audio streams.
- **INF-003**: Audio Capture Pipeline (SP-007) – Supplies microphone audio and client hint VAD metrics.

### Data Dependencies

- **DAT-001**: Transcript events from STT service (SP-009) for turn validation and captions.
- **DAT-002**: Playback metrics from TTS service (SP-010) to determine speaking state and latency.
- **DAT-003**: Configuration settings (`voicepilot.conversation.policyProfile`, etc.) managed by Configuration Manager (SP-002).

### Technology Platform Dependencies

- **PLT-001**: VS Code webview messaging channel for real-time state propagation.
- **PLT-002**: Extension host command registry for manual interruption controls (`voicepilot.stopSession`, future `voicepilot.interruptAssistant`).
- **PLT-003**: Upcoming Conversation State Machine module (SP-012) for deterministic transitions.

### Compliance Dependencies

- **COM-001**: Privacy & Data Handling Policy (SP-027, pending) to govern logging of interruption metadata.
- **COM-002**: Accessibility requirements per UI design (WCAG 2.1 AA alignment) to ensure state changes are perceivable.

## 9. Examples & Edge Cases

```typescript
const engine = container.resolve<InterruptionEngine>('InterruptionEngine');

await engine.configure({
  profile: 'default',
  allowBargeIn: true,
  interruptionBudgetMs: 250,
  completionGraceMs: 150,
  speechStopDebounceMs: 200,
  fallbackMode: 'hybrid'
});

engine.onEvent(event => {
  if (event.type === 'interruption') {
    logger.info('User barge-in detected', event.diagnostics);
    vscode.commands.executeCommand('setContext', 'voicepilot.conversationState', event.state);
  }
});

// Handle Azure VAD speech start while assistant is speaking
await engine.handleSpeechEvent({
  type: 'user-speech-start',
  source: 'azure-vad',
  timestamp: new Date().toISOString(),
  latencyMs: 95
});

// Assistant playback event from TTS service
await engine.handlePlaybackEvent({
  type: 'assistant-playback-started',
  timestamp: new Date().toISOString(),
  latencyMs: 40
});
```

### Edge Cases

```typescript
// Cooldown enforcement after repeated interruptions
const cooldownPolicy = {
  profile: 'assertive',
  allowBargeIn: true,
  interruptionBudgetMs: 200,
  completionGraceMs: 500,
  speechStopDebounceMs: 180,
  fallbackMode: 'hybrid'
};

await engine.configure(cooldownPolicy);

// After third interruption within 60 seconds
engine.onEvent(event => {
  if (event.type === 'interruption' && event.diagnostics?.interruptionCount >= 3) {
    notificationService.info('Assistant will finish speaking before accepting new input.');
  }
});

// Degraded VAD fallback
await engine.handleSpeechEvent({
  type: 'vad-degraded',
  source: 'azure-vad',
  timestamp: new Date().toISOString()
});
```

## 10. Validation Criteria

- Comprehensive test suite covers acceptance criteria AC-001 through AC-008 with automated assertions.
- Latency metrics collected during integration tests confirm interruption budget adherence (<250 ms) and assistant start delay (<300 ms) across sample dialogs.
- UI state context (`voicepilot.conversationState`) mirrors engine state transitions during manual and automated tests.
- Fallback and recovery pathways execute without leaving dangling playback sessions or inconsistent turns.
- Configuration validation rejects unsafe values and logs remediation guidance.
- Structured logs redact sensitive content while preserving diagnostics for troubleshooting.
- Manual accessibility walkthrough verifies screen reader announcements and keyboard controls remain functional during interruptions.

## 11. Related Specifications / Further Reading

- [SP-005: Session Management & Renewal](sp-005-spec-design-session-management.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline Architecture](sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-008: Voice Activity & Turn Detection Integration](sp-008-spec-algorithm-voice-activity-detection.md)
- [SP-009: Realtime Speech-to-Text Integration](sp-009-spec-tool-realtime-stt.md)
- [SP-010: Text-to-Speech Output Service](sp-010-spec-tool-text-to-speech.md)
- [docs/design/UI.md](../docs/design/UI.md)
- [docs/design/COMPONENTS.md](../docs/design/COMPONENTS.md)
- Azure OpenAI GPT Realtime API Quickstart *(Technical Reference Index)*
- Azure OpenAI Realtime API Reference *(Technical Reference Index)*

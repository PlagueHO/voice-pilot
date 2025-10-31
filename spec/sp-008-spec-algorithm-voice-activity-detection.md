---
title: Voice Activity & Turn Detection Integration
version: 1.0
date_created: 2025-09-24
last_updated: 2025-09-24
owner: Agent Voice Project
tags: [architecture, audio, vad, realtime, azure]
---

This specification defines how Agent Voice integrates Azure OpenAI GPT Realtime API voice activity and turn detection. The goal is to orchestrate server-provided turn detection signals, configure sensitivity, and provide graceful fallbacks instead of implementing a full custom client-side VAD engine. Client heuristics remain optional for latency-sensitive UI hints or offline diagnostics, but server-managed VAD is the authoritative source for session control.

## 1. Purpose & Scope

The specification covers:

- Configuring `turn_detection` parameters exposed by the Azure GPT Realtime API (`server_vad` and `semantic_vad`).
- Handling server events such as `input_audio_buffer.speech_started`, `input_audio_buffer.speech_stopped`, and automatic response triggers.
- Coordinating interruption, barge-in, and UI state transitions in conjunction with the WebRTC pipeline (SP-006) and UI design.
- Providing fallback guidance when server VAD is unavailable, degraded, or intentionally disabled.
- Defining telemetry and configuration surfaces in line with Configuration Manager (SP-002) and Session Management (SP-005).

Out of scope: implementing standalone speech detection DSP pipelines, persistent audio storage, or ML training.

**Intended Audience**: Agent Voice extension developers, session orchestration engineers, and QA validating conversational flow.

**Assumptions**:

- The Azure GPT Realtime models expose `turn_detection` via the session configuration API (per Microsoft docs updated 2025-09-16).
- WebRTC transport (SP-006) and Audio Capture Pipeline (SP-007) deliver PCM16 audio to the Azure service.
- Network latency is generally <150 ms, allowing reliance on server signals for turn-taking.
- UI design (docs/design/UI.md) expects Agent Voice to display responsive status changes (Listening, Thinking, Speaking).

## 2. Definitions

- **Server VAD**: Azure Realtime API turn detection where the service analyzes streamed audio and emits speech start/stop events and automatically commits buffers.
- **Semantic VAD**: Turn detection mode where conversation semantics influence end-of-turn detection; available via `turn_detection.type = "semantic_vad"`.
- **Client Hint VAD**: Lightweight local heuristics used for UI hints only; non-authoritative.
- **Turn Detection Coordinator (TDC)**: Agent Voice component managing configuration, event wiring, and failover logic.
- **Barge-In**: User speech that interrupts current assistant audio output; server VAD optionally emits interruption events.
- **Prefix Padding**: Milliseconds of pre-roll audio preserved when speech start is detected.
- **Silence Duration**: Milliseconds of trailing quiet required before speech stop is emitted.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Agent Voice SHALL enable Azure server turn detection (`server_vad`) by default via `session.update` immediately after session creation.
- **REQ-002**: Agent Voice SHALL expose configuration for `threshold`, `prefix_padding_ms`, and `silence_duration_ms` through Configuration Manager (SP-002), reflecting Microsoft documentation ranges (0.0–1.0 for threshold, ≥0 ms).
- **REQ-003**: Agent Voice SHALL consume `input_audio_buffer.speech_started` and `input_audio_buffer.speech_stopped` events to drive UI state and session logic.
- **REQ-004**: Agent Voice SHALL honor server-managed `create_response` and `interrupt_response` flags to decide when to auto-trigger `response.create` or allow manual control.
- **REQ-005**: Agent Voice SHALL support switching to `semantic_vad` when conversation semantics outperform pure energy thresholds, respecting `eagerness` options (`low`, `auto`, `high`).
- **REQ-006**: Agent Voice SHALL detect server VAD disablement or failure (e.g., via lack of speech events) and degrade gracefully by enabling client hint VAD or manual commit controls.
- **REQ-007**: Agent Voice SHALL synchronize assistant playback cancellation (`output_audio_buffer.clear`) upon receiving server speech start events when `interrupt_response` is true.
- **REQ-008**: Agent Voice SHALL log diagnostic metrics (latency between speech start and UI update, event drop counts) while redacting audio content.
- **SEC-001**: Agent Voice SHALL avoid transmitting raw audio outside Azure endpoints; client hint VAD must operate purely on transient buffers.
- **SEC-002**: Configuration updates SHALL be validated to prevent extreme thresholds that cause denial-of-service or excessive auto-responses.
- **CON-001**: Agent Voice MUST tolerate network latency; UI cannot assume sub-50 ms reaction and must indicate pending state while awaiting server confirmation.
- **CON-002**: Agent Voice MUST avoid simultaneous server and client commitments of audio buffers; client commits are only used in fallback mode.
- **GUD-001**: Keep `silence_duration_ms` ≥ 150 ms for natural conversation unless user explicitly opts-in to aggressive cutting.
- **GUD-002**: Mirror server event timestamps to user-visible timelines for accessibility logs.
- **PAT-001**: Implement Observer pattern for event propagation to UI, Session Manager, and Audio Feedback.
- **PAT-002**: Implement Strategy pattern to switch between server-managed, hybrid, and fallback manual modes without changing consumers.

## 4. Interfaces & Data Contracts

```typescript
export interface TurnDetectionCoordinator extends ServiceInitializable {
  configure(params: TurnDetectionConfig): Promise<void>;
  handleServerEvent(event: RealtimeTurnEvent): void;
  requestModeChange(mode: TurnDetectionMode): Promise<void>;
  getState(): TurnDetectionState;
  on(event: TurnDetectionEventType, listener: TurnDetectionEventListener): Disposable;
}

export type TurnDetectionMode = 'server_vad' | 'semantic_vad' | 'manual';

export interface TurnDetectionConfig {
  mode: TurnDetectionMode;
  threshold?: number; // 0.0 - 1.0, server_vad only
  prefixPaddingMs?: number; // default 300
  silenceDurationMs?: number; // default 200
  createResponse?: boolean; // default true
  interruptResponse?: boolean; // default true
  eagerness?: 'low' | 'auto' | 'high'; // semantic_vad only
}

export interface RealtimeTurnEvent {
  type: 'speech-start' | 'speech-stop' | 'response-interrupted' | 'degraded';
  timestamp: number;
  serverEvent?: any; // raw Azure event for logging (redacted)
  latencyMs?: number;
}

export interface TurnDetectionState {
  mode: TurnDetectionMode;
  lastSpeechStart?: number;
  lastSpeechStop?: number;
  pendingResponse?: boolean;
  diagnostics: TurnDetectionDiagnostics;
}

export interface TurnDetectionDiagnostics {
  avgStartLatencyMs: number;
  avgStopLatencyMs: number;
  missedEvents: number;
  fallbackActive: boolean;
}

export type TurnDetectionEventType =
  | 'mode-changed'
  | 'speech-start-detached'
  | 'speech-stop-detached'
  | 'fallback-engaged'
  | 'config-updated';

export interface HybridFallbackAdapter {
  enable(): Promise<void>;
  disable(): Promise<void>;
  processFrame(frame: Int16Array, timestamp: number): void;
}
```

Session payload sent to Azure:

```json
{
  "type": "session.update",
  "session": {
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

## 5. Acceptance Criteria

- **AC-001**: Given server VAD enabled, When user speaks, Then Agent Voice surfaces a Listening UI state within 150 ms of receiving `speech_started` and logs latency.
- **AC-002**: Given speech stops, When `speech_stopped` arrives, Then Agent Voice transitions to Thinking state and either triggers `response.create` automatically or hands control to Session Manager per configuration.
- **AC-003**: Given assistant audio is playing, When server emits `speech_started` with `interrupt_response: true`, Then playback is interrupted and truncated via `output_audio_buffer.clear`.
- **AC-004**: Given threshold is adjusted in settings, When TDC reconfigures session, Then server acknowledges via `session.updated` and subsequent detections reflect new sensitivity.
- **AC-005**: Given server ceases to emit speech events for 5 seconds while audio is captured, Then fallback mode activates, a warning toast appears, and client hint VAD begins providing non-authoritative UI signals.
- **AC-006**: Given semantic VAD mode, When `eagerness` = `high`, Then responses begin within 300 ms after semantic turn detection (validated via integration tests with scripted dialog).
- **AC-007**: Given manual mode, When user stops speaking, Then operator can commit input buffer and session remains stable without server automation.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for configuration mapping, event routing, fallback activation; integration tests using mocked Realtime API events; end-to-end tests in VS Code Extension Host using recorded sessions.
- **Frameworks**: Vitest/Jest for unit; Playwright + mocked WebRTC for integration; Mocha extension tests to validate VS Code UI updates.
- **Mocks**: Synthetic Azure events for `session.created`, `session.updated`, `input_audio_buffer.*`; latency injection harness.
- **CI/CD**: Include mocked server test suite in `npm run test:unit`; run full integration tests (`npm test`) before release.
- **Coverage**: ≥95% statement coverage for TDC logic, 100% branch coverage for mode switching state machine.
- **Performance**: Measure event handling latency and ensure <1 ms processing per event; track fallback engagement frequency.
- **Resilience**: Simulate network drops, missing events, and invalid configuration responses.

## 7. Rationale & Context

Microsoft’s 2025 documentation shows Azure GPT Realtime sessions expose configurable `turn_detection` with server-managed VAD. The service emits speech start/stop events and can automatically commit audio buffers and launch responses. Leveraging this capability avoids duplicating complex DSP logic and keeps Agent Voice aligned with upstream improvements. Client hint VAD remains valuable when server signals are delayed or unavailable (e.g., offline mode, degraded network), and for instant UI feedback, but it is treated as advisory. Hybrid strategy simplifies maintenance, reduces CPU usage, and ensures parity with Azure semantics such as semantic VAD.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI GPT Realtime API – Primary source of turn detection and speech events.

### Third-Party Services

- **SVC-001**: WebRTC transport endpoints per region (`https://<region>.realtimeapi-preview.ai.azure.com/v1/realtimertc`).

### Infrastructure Dependencies

- **INF-001**: VS Code Webview runtime with WebRTC and fetch support.

### Data Dependencies

- **DAT-001**: Audio Capture Pipeline metrics (noise floor, buffer health) for diagnostics.

### Technology Platform Dependencies

- **PLT-001**: Azure Realtime API session schema fields `turn_detection`, `input_audio_buffer.*` events.
- **PLT-002**: Configuration Manager (SP-002) and Session Manager (SP-005) message contracts.

### Compliance Dependencies

- **COM-001**: Privacy & Data Handling Policy (SP-027) for event logging redaction.

## 9. Examples & Edge Cases

```typescript
// Enable server VAD with custom sensitivity
await realtimeClient.send({
  type: 'session.update',
  session: {
    turn_detection: {
      type: 'server_vad',
      threshold: 0.55,
      prefix_padding_ms: 250,
      silence_duration_ms: 220,
      create_response: true,
      interrupt_response: true
    }
  }
});

turnDetectionCoordinator.on('speech-start-detached', evt => {
  ui.setStatus('● Listening');
  metrics.recordStartLatency(evt.latencyMs ?? 0);
});

turnDetectionCoordinator.on('fallback-engaged', () => {
  notifications.warn('Server turn detection degraded, using local estimates.');
});

// Switch to semantic VAD for narrative planning sessions
await turnDetectionCoordinator.requestModeChange('semantic_vad');
```

Edge Cases:

- **Network Jitter**: Delay > 300 ms before speech events; system should show “Detecting…” state while waiting.
- **Server Downtime**: No `session.updated` acknowledgment; revert to manual mode and surface error.
- **Aggressive Threshold**: User sets threshold <0.1 causing false positives; validation clamps to safe minimum and notifies user.
- **Barge-In with Disabled Interrupt**: If `interrupt_response = false`, Agent Voice must still let user manually cancel playback.

## 10. Validation Criteria

- Successful session update logs confirm active `turn_detection` configuration.
- UI transition latency metrics stay within agreed budget (<150 ms after server event).
- Fallback mode engages within 5 seconds of missing speech events and disengages when server recovers.
- Integration tests confirm `create_response` automation matches configuration toggles.
- Manual mode walkthrough demonstrates user-controlled commits without server automation.

## 11. Related Specifications / Further Reading

- [SP-002: Configuration & Settings Management](sp-002-spec-design-configuration-management.md)
- [SP-005: Session Management & Renewal](sp-005-spec-design-session-management.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline Architecture](sp-007-spec-architecture-audio-capture-pipeline.md)
- [Agent Voice UI Design](../docs/design/UI.md)
- [Agent Voice Extension Components Design](../docs/design/COMPONENTS.md)
- Azure documentation: [Use the GPT Realtime API via WebRTC](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)
- Azure documentation: [GPT Realtime API Quickstart](https://learn.microsoft.com/azure/ai-foundry/openai/realtime-audio-quickstart)
- Azure documentation: [Realtime Audio API Reference](https://learn.microsoft.com/azure/ai-foundry/openai/realtime-audio-reference)

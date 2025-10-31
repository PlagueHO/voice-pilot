---
title: Audio Feedback and Sound Design Specification
version: 1.0
date_created: 2025-10-01
last_updated: 2025-10-01
owner: Agent Voice Project
tags: [design, audio, ui, accessibility]
---

<!-- markdownlint-disable-next-line MD025 -->
# Introduction

This specification defines the audio feedback and sound design system for Agent Voice. It translates conversation state changes, microphone activity, and Azure OpenAI response events into short-form audio cues rendered within the shared Web Audio API 1.1 context. The document describes requirements for cue authoring, playback coordination alongside the text-to-speech (TTS) pipeline, resilience expectations, and integration contracts for both the extension host and the webview.

## 1. Purpose & Scope

The purpose of this specification is to standardize the auditory experience that complements Agent Voice’s voice interaction loop. Scope covers audio cue taxonomy, playback sequencing, volume scaling, accessibility compliance, and coordination with the microphone capture pipeline (SP-007) and the Azure Realtime TTS subsystem (SP-010). It targets extension developers, UX designers, and QA engineers responsible for authoring, integrating, or validating audio feedback. Assumptions include availability of the shared AudioContext provided by SP-007, an operational TTS stream per SP-010, and adherence to VS Code webview security constraints.

## 2. Definitions

- **Audio Cue**: Short sound effect signaling UI or conversation events (e.g., start, stop, error).
- **Cue Pack**: Group of related audio cues sharing a theme or locale.
- **Render Quantum**: The fixed-size audio processing block dictated by the shared `AudioContext.renderQuantumSize` (default 128 frames).
- **Duck/Ducking**: Temporarily lowering the volume of one audio source (e.g., TTS) while another cue plays.
- **Accessibility Gain Profile**: Predefined volume scaling curve tailored to accessibility needs.
- **Cue Scheduler**: Component that sequences cue playback relative to TTS and microphone activity.
- **Fallback Mode**: Degraded state where textual notifications replace unavailable audio cues.
- **Telemetry Sample**: Structured metrics payload describing cue latency, peak amplitude, and playback outcome.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The audio feedback system SHALL provide a canonical cue taxonomy covering at minimum: session start/stop, listening, thinking, speaking, interruption, error, and degraded mode notifications.
- **REQ-002**: Cue playback SHALL occur within 150 ms of the triggering event when the audio buffer is preloaded and the shared AudioContext is active.
- **REQ-003**: The cue scheduler SHALL coordinate with the TTS pipeline so cues duck or pause TTS audio when overlapping, resuming normal volume within 250 ms after cue completion.
- **REQ-004**: Cue assets SHALL be authored at 24 kHz PCM16 mono to align with SP-007 capture settings and SP-010 playback expectations; resampling SHALL occur offline, not at runtime.
- **REQ-005**: The system SHALL expose configuration settings for cue enablement, category-specific volume scaling, and accessibility gain profiles, persisted via the extension configuration manager.
- **REQ-006**: Cue playback SHALL emit structured state events (`audioFeedback.event`) to the host, including cue identifier, latency, and success/failure outcome for telemetry.
- **REQ-007**: When entering degraded mode, the system SHALL disable further cue playback, notify the host, and display equivalent textual notifications until audio subsystems recover.
- **REQ-008**: The system SHALL preload AudioWorklet processors and cue buffers during initialization to avoid runtime fetches, following Web Audio API 1.1 best practices.
- **SEC-001**: Audio cue assets SHALL be packaged with the extension and SHALL NOT be fetched from external URLs at runtime.
- **SEC-002**: The system SHALL purge in-memory cue buffers on disposal to prevent unauthorized reuse.
- **CON-001**: Only the shared AudioContext established by SP-007 may be used; additional contexts are prohibited.
- **CON-002**: Maximum simultaneous cue voices SHALL be limited to two (primary + ducked overlay) to prevent clipping and maintain CPU budgets.
- **GUD-001**: Use psychoacoustic spacing (minimum 500 ms) between consecutive cues in the same category to reduce auditory fatigue.
- **GUD-002**: Provide silent variants for environments requiring muted operation while preserving state transitions via telemetry.
- **GUD-003**: Author cues under −3 dBFS peak with 10 ms fade in/out envelopes to prevent clicks.
- **PAT-001**: Apply the Observer pattern for cue state notifications consumed by status indicators and logging services.
- **PAT-002**: Use the Strategy pattern to swap ducking behaviors (pause, volume dip, crossfade) based on configuration or accessibility settings.
- **PAT-003**: Implement a Circuit Breaker pattern guarding repeated cue playback failures, transitioning to degraded mode after three consecutive errors within 60 seconds.

## 4. Interfaces & Data Contracts

### Host ↔ Webview Messaging Contracts

```json
{
  "type": "audioFeedback.control",
  "payload": {
    "command": "play",
    "cueId": "session.start",
    "priority": "high",
    "duckStrategy": "attenuate"
  }
}

{
  "type": "audioFeedback.event",
  "payload": {
    "cueId": "session.start",
    "status": "played",
    "latencyMs": 42,
    "telemetry": {
      "peakDb": -6.5,
      "durationMs": 380,
      "ducking": "attenuate"
    }
  }
}
```

### Cue Scheduler Interface

```typescript
import { ServiceInitializable } from '../core/service-initializable';

export interface AudioCueScheduler extends ServiceInitializable {
  initialize(config: AudioCueSchedulerConfig): Promise<void>;
  playCue(request: AudioCueRequest): Promise<CueHandle>;
  stopCue(handleId: string): Promise<void>;
  setDuckingStrategy(strategy: DuckingStrategy): void;
  getMetrics(): AudioCueMetrics;
}

export interface AudioCueSchedulerConfig {
  audioContext: BaseAudioContext;
  expectedRenderQuantumSize: number; // Must equal shared context renderQuantumSize
  preloadCueIds: string[];
  defaultDucking: DuckingStrategy;
  degradedModeNotifier: (state: boolean) => Promise<void>;
}

export interface AudioCueRequest {
  cueId: string;
  category: 'session' | 'state' | 'error' | 'accessibility';
  accessibilityProfile?: 'standard' | 'high-contrast' | 'silent';
  metadata?: Record<string, unknown>;
}

export interface AudioCueMetrics {
  averageLatencyMs: number;
  cueFailureRate: number;
  duckingEngagementRatio: number;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a session start event, When `audioFeedback.control` with `cueId = "session.start"` is sent, Then the cue plays within 150 ms and `audioFeedback.event` reports a `played` status with latency ≤150 ms.
- **AC-002**: Given TTS is active, When a high-priority cue plays with `duckStrategy = "attenuate"`, Then TTS volume is reduced by the configured attenuation within 50 ms and restored within 250 ms after cue completion.
- **AC-003**: Given three consecutive cue playback failures within 60 seconds, When the Circuit Breaker engages, Then degraded mode activates, cue playback stops, and the host receives a degraded notification event.
- **AC-004**: Given accessibility profile `high-contrast`, When cues play, Then output level increases according to the configured gain curve without exceeding −1 dBFS peak.
- **AC-005**: Given the shared AudioContext render quantum deviates from the expected value, When initialization occurs, Then the scheduler aborts startup, raises a configuration error, and cues remain disabled until alignment is restored.
- **AC-006**: Given the user disables cues via configuration, When events fire, Then no audio plays and telemetry records `status = "suppressed"` for each attempted cue.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for cue scheduling logic and ducking strategies; integration tests within the webview harness validating host↔webview messaging; end-to-end extension tests verifying UI state transitions and degraded mode handling.
- **Frameworks**: Mocha with Web Audio API mocks for unit tests; Playwright-based webview automation for integration; `@vscode/test-electron` for extension-level scenarios.
- **Test Data Management**: Use PCM16 fixture files under `test/fixtures/audio-feedback`, including clipped and silent samples for edge-case validation.
- **CI/CD Integration**: Extend the `Test Extension` task with environment variable `AUDIO_FEEDBACK_MOCK=1` to route cue playback to deterministic stubs; collect telemetry artifacts for regression detection.
- **Coverage Requirements**: Achieve ≥90% branch coverage on cue scheduler state machine and 100% coverage on Circuit Breaker fallback paths.
- **Performance Testing**: Introduce a `npm run test:perf:cues` script measuring cue latency and ducking recovery time; fail if average cue latency exceeds 180 ms or ducking recovery surpasses 300 ms.

## 7. Rationale & Context

Consistent audio feedback improves conversational ergonomics by signaling state transitions without relying solely on visual cues. Integrating with the shared AudioContext ensures parity between capture (SP-007) and playback (SP-010), minimizing resource usage and simplifying latency management. Aligning cue authoring with PCM16 standards avoids runtime resampling overhead, while preload requirements eliminate network-induced jitter. Ducking coordination prevents cue masking and maintains intelligibility for both cues and TTS speech.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI Realtime API – Provides TTS audio streams whose volume must be coordinated with cue playback.

### Third-Party Services

- **SVC-001**: None beyond the Azure OpenAI dependency noted above.

### Infrastructure Dependencies

- **INF-001**: Shared AudioContext infrastructure established by SP-007, including AudioWorklet processor registration.

### Data Dependencies

- **DAT-001**: Cue metadata definitions stored within the extension configuration and resource manifest.

### Technology Platform Dependencies

- **PLT-001**: VS Code webview environment with Web Audio API 1.1 support and AudioWorklet capability.

### Compliance Dependencies

- **COM-001**: Adherence to project privacy policies (SP-027) ensuring no audio cues capture or transmit user data.

## 9. Examples & Edge Cases

```typescript
const request: AudioCueRequest = {
  cueId: 'interruption.detected',
  category: 'state',
  accessibilityProfile: 'high-contrast',
  metadata: {
    speechOverlapMs: 120,
    duckingStrategy: 'pause'
  }
};

await scheduler.playCue(request);
```

Edge cases:

- Triggering a new cue while another with higher priority is in progress (should queue or replace based on strategy).
- Attempting to play cues when the AudioContext is suspended (should resume or report suppressed status).
- Cue playback under muted accessibility profile (should skip audio but emit telemetry).

## 10. Validation Criteria

1. Verify cue taxonomy coverage for all defined conversation states.
2. Confirm ducking strategies operate within specified latency budgets.
3. Validate degraded mode activation after consecutive failures and recovery once audio subsystems stabilize.
4. Ensure cue assets comply with PCM16 mono 24 kHz encoding and −3 dBFS peak threshold.
5. Confirm configuration changes propagate without reloading the webview and respect Observer notifications.

## 11. Related Specifications / Further Reading

- [SP-007: Audio Capture Pipeline Architecture](./sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-010: Text-to-Speech Output Service](./sp-010-spec-tool-text-to-speech.md)
- [SP-011: Interruption & Turn-Taking Engine](./sp-011-spec-design-interruption-management.md)
- [Azure OpenAI Realtime Audio Quickstart](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?tabs=keyless%2Cwindows&pivots=programming-language-typescript)

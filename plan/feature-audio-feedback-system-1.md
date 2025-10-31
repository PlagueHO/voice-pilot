---
goal: Implement Audio Feedback and Sound Design System
version: 1.0
date_created: 2025-10-01
last_updated: 2025-10-01
owner: Agent Voice Project
status: 'Completed'
tags: [feature, audio, accessibility]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

Deliver the end-to-end audio feedback system defined in `spec/sp-015-spec-design-audio-feedback-and-sound-design.md`, enabling deterministic cue playback, ducking, telemetry, and accessibility controls within the shared Web Audio API 1.1 pipeline.

## 1. Requirements & Constraints

- **REQ-001**: Implement the canonical cue taxonomy and playback latency budgets defined in SP-015 REQ-001 and REQ-002.
- **REQ-002**: Coordinate cue playback with the Azure Realtime TTS stream, fulfilling SP-015 REQ-003 and REQ-004.
- **REQ-003**: Expose configuration toggles, accessibility gain profiles, and telemetry required by SP-015 REQ-005 and REQ-006.
- **REQ-004**: Support degraded-mode behaviour per SP-015 REQ-007 and PAT-003.
- **SEC-001**: Package all cue assets within the extension and enforce in-memory buffer disposal (SP-015 SEC-001/SEC-002).
- **CON-001**: Operate exclusively on the shared AudioContext and limit simultaneous cue voices to two (SP-015 CON-001/CON-002).
- **GUD-001**: Apply psychoacoustic spacing and silent variants where required (SP-015 GUD-001/GUD-002).
- **PAT-001**: Use Observer and Strategy patterns for state notifications and ducking behaviours as mandated by SP-015 PAT-001/PAT-002.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Establish extension host services, configuration surfaces, and message contracts for audio feedback control.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/config/sections/audio-feedback-section.ts` registering cue enablement, category gain, accessibility profile, and telemetry toggles; wire default values into `ConfigurationManager`. |  |  |
| TASK-002 | Add `src/types/audio-feedback.ts` defining cue identifiers, ducking strategies, telemetry payloads, and degraded-mode enums referenced across host and webview layers. |  |  |
| TASK-003 | Implement `src/services/audio-feedback/audio-feedback-service.ts` that satisfies SP-015 interfaces: preload cue metadata, manage Observer subscriptions, and expose `playCue`, `stopCue`, `setDuckingStrategy`, and `getMetrics`. |  |  |
| TASK-004 | Update `src/core/ExtensionController.ts` to initialize and dispose the audio feedback service in the established Config → Auth → Session → UI order; ensure degraded-mode notifications propagate to session manager. |  |  |
| TASK-005 | Extend host↔webview messaging contracts by adding `audioFeedback.control` and `audioFeedback.event` handling to `src/ui/message-router.ts` (or equivalent) with validation using the new types. |  |  |

### Implementation Phase 2

- GOAL-002: Build webview-side cue scheduler, preload pipeline, and ducking integration within the shared AudioContext.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Introduce `media/audio-feedback-player.ts` implementing the AudioWorklet-backed cue scheduler that attaches to the shared `AudioContext`, preloads PCM16 buffers, and enforces render quantum validation. |  |  |
| TASK-007 | Update `media/voice-control-panel.js` (and TypeScript source if applicable) to instantiate the cue scheduler, subscribe to host commands, and publish `audioFeedback.event` telemetry, ensuring ducking requests reach the TTS player. |  |  |
| TASK-008 | Package cue assets under `media/audio/cues/` (PCM16 mono 24 kHz) with build-time manifest generation in `webpack.config.js` to guarantee offline availability and hashed cache keys. |  |  |
| TASK-009 | Implement ducking strategy handlers (pause, attenuate, crossfade) in `media/audio-feedback-player.ts`, configurable via incoming control payloads and mirrored accessibility profiles. |  |  |
| TASK-010 | Create degraded-mode handler in the webview to suppress playback after three consecutive failures, emitting notifications to the host per SP-015 PAT-003. |  |  |

### Implementation Phase 3

- GOAL-003: Deliver telemetry, testing, documentation, and non-regression validation across host and webview components.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Author unit tests `test/audio/audio-feedback-service.test.ts` covering Observer notifications, ducking state transitions, and degraded-mode triggers using mocha + sinon. |  |  |
| TASK-012 | Add webview integration tests using Playwright (`test/webview/audio-feedback.spec.ts`) validating cue latency, ducking recovery, and accessibility profiles with stubbed AudioContext. |  |  |
| TASK-013 | Extend `test/session/session-state.integration.test.ts` (or create new suite) to verify host↔webview messaging and fallback to textual notifications when cues are disabled. |  |  |
| TASK-014 | Wire telemetry events into existing logging (`src/core/logger.ts`) and update metrics export pipelines so average latency, failure rate, and ducking ratios surface to diagnostics. |  |  |
| TASK-015 | Update `docs/design/FEATURE-PLAN.md` status for SP-015 and document usage instructions in `README.md` accessibility section. |  |  |

## 3. Alternatives

- **ALT-001**: Use VS Code notification toasts instead of audio cues—rejected because it fails the hands/eyes-free accessibility requirement.
- **ALT-002**: Stream cues over the TTS channel—rejected due to increased latency and inability to guarantee immediate playback for interruption signals.

## 4. Dependencies

- **DEP-001**: Shared AudioContext provisioning from `src/audio/audio-context-provider.ts` must expose attachment hooks before cue scheduler initialization.
- **DEP-002**: Azure Realtime TTS player implementation (SP-010) must surface ducking controls invokable by the audio feedback service.

## 5. Files

- **FILE-001**: `src/config/sections/audio-feedback-section.ts` — new configuration section for cue settings.
- **FILE-002**: `src/services/audio-feedback/audio-feedback-service.ts` — host-side cue scheduling and degraded-mode orchestration.
- **FILE-003**: `media/audio-feedback-player.ts` — webview cue playback engine and ducking strategies.
- **FILE-004**: `media/audio/cues/*.pcm` — packaged PCM16 cue assets.
- **FILE-005**: `test/audio/audio-feedback-service.test.ts` — unit tests ensuring contract compliance.
- **FILE-006**: `media/voice-control-panel.js` — integration point for webview messaging and telemetry.

## 6. Testing

- **TEST-001**: Execute `npm run test:unit` verifying new audio feedback unit suites pass without regressions.
- **TEST-002**: Run Playwright-based webview tests (`npm run test:headless` or dedicated script) to confirm cue latency, ducking, and degraded-mode behaviour.
- **TEST-003**: Perform `npm run test:perf` (augmented with cue latency probe) to ensure playback meets ≤180 ms latency and ≤300 ms ducking recovery budgets.

## 7. Risks & Assumptions

- **RISK-001**: AudioWorklet support might be unavailable on older VS Code runtimes; mitigation: feature-detect and fall back to textual notifications.
- **RISK-002**: Packaging PCM assets increases extension size; mitigation: keep cues under 1 second and reuse shared envelopes.
- **ASSUMPTION-001**: Shared AudioContext render quantum size remains 128 frames as negotiated in SP-007; deviations trigger initialization abort per spec.

## 8. Related Specifications / Further Reading

- [SP-015: Audio Feedback and Sound Design Specification](../spec/sp-015-spec-design-audio-feedback-and-sound-design.md)
- [SP-007: Audio Capture Pipeline Architecture](../spec/sp-007-spec-architecture-audio-capture-pipeline.md)
- [SP-010: Text-to-Speech Output Service](../spec/sp-010-spec-tool-text-to-speech.md)

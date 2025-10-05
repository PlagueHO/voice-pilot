---
title: Audio Codec Standards for VoicePilot Realtime Streams
version: 1.0
date_created: 2025-10-04
last_updated: 2025-10-04
owner: VoicePilot Project
tags: [design, audio, codec, realtime, webrtc]
---

This specification defines the canonical audio formats, codec behaviors, adaptation rules, and negotiation workflows required for VoicePilot's realtime voice interaction system. It ensures consistent capture, processing, transport, and playback across the VS Code extension host, webview audio pipeline, and Azure OpenAI GPT Realtime endpoints.

## 1. Purpose & Scope

This document establishes normative requirements for audio encoding, sample rate management, channel configuration, framing, payload sizing, and compatibility guarantees spanning capture (SP-007), transport (SP-006), and downstream AI services. It applies to all components that produce, transform, or consume audio within VoicePilot, including unit test fixtures and diagnostic tooling. Intended readers are extension developers, audio engineers, QA specialists, and infrastructure operators responsible for realtime audio reliability.

Assumptions:

- The webview environment provides Web Audio API 1.1 primitives (`AudioContext`, `AudioWorkletNode`, `MediaStream*` nodes) with hardware-backed microphone access.
- Azure OpenAI GPT Realtime API supports PCM16 payloads at negotiated sample rates supplied through WebRTC SDP.
- The project continues to target single-channel (mono) conversational audio with optional dual-channel diagnostics.

## 2. Definitions

- **PCM16**: Linear Pulse Code Modulation with 16-bit signed integer samples.
- **Sample Rate**: Number of audio samples captured per second, expressed in Hertz (Hz).
- **Render Quantum**: The fixed-size audio processing block enforced by Web Audio API 1.1 (128 frames by default).
- **Codec Profile**: Bundled constraints describing sample rate, channel layout, bit depth, packet duration, and transport framing semantics.
- **DTX (Discontinuous Transmission)**: Transport optimization that suspends packet emission during silence periods.
- **Comfort Noise (CNG)**: Low-level synthetic noise injected during silence to prevent perceptual dropouts.
- **Jitter Buffer**: Receiver-side buffer smoothing packet arrival variability prior to playback.
- **Downsampling**: Conversion from a higher to a lower sample rate (e.g., 48 kHz to 24 kHz) while preserving voice intelligibility.
- **Opus Passthrough**: WebRTC codec leniency allowing Opus for fallback when PCM16 negotiation fails.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: VoicePilot SHALL define a primary PCM16/24 kHz mono codec profile for microphone capture, transport, and Azure ingestion.
- **REQ-002**: The system SHALL expose a secondary 16 kHz profile for low-bandwidth recovery while preserving PCM16 semantics.
- **REQ-003**: Codec negotiation SHALL complete during WebRTC SDP offer/answer exchange and be reflected in Web Audio `AudioContext.sampleRate`.
- **REQ-004**: All recorded fixtures and automated tests SHALL use canonical PCM16 WAV containers aligned with the active codec profile.
- **REQ-005**: Audio frame duration SHALL default to 20 ms (480 samples at 24 kHz) unless Azure imposes alternate framing.
- **SEC-001**: Codec configuration metadata SHALL NOT leak sensitive endpoint information when logged or surfaced to users.
- **PER-001**: Encode/decode operations SHALL maintain end-to-end latency below 40 ms for the capture-to-send pathway.
- **PER-002**: Downsampling or resampling SHALL introduce < 1 dB signal-to-noise ratio degradation.
- **CON-001**: Multichannel (stereo) capture is prohibited in production until a downstream consumer explicitly requires it.
- **CON-002**: ScriptProcessorNode-based resampling SHALL NOT be used; only AudioWorklet or native `OfflineAudioContext` approaches are permitted.
- **CON-003**: Opus fallback SHALL only be activated when PCM16 negotiation fails twice within a session.
- **CON-004**: Payload size per RTP packet SHALL NOT exceed 960 bytes to satisfy Azure Realtime WS failover limits.
- **CON-005**: Jitter buffers SHALL cap at 120 ms to preserve conversational responsiveness.
- **GUD-001**: Prefer resampling at the earliest capture stage to minimize cascading precision loss.
- **GUD-002**: Apply voice-optimized windowing (Hann) before FFT-based analysis to stabilize VAD amplitude measurements.
- **GUD-003**: Emit diagnostic metrics (sample rate, packet loss, jitter) every 5 seconds via the transport telemetry channel.
- **PAT-001**: Use Factory pattern to instantiate codec profiles, allowing dependency injection during testing.
- **PAT-002**: Implement Strategy pattern for dynamic DTX and CNG toggling based on transport feedback.
- **PAT-003**: Employ Observer pattern to synchronize codec profile changes across capture pipeline, WebRTC transport, and UI indicators.

## 4. Interfaces & Data Contracts

```typescript
export interface AudioCodecProfile {
  readonly id: 'pcm16-24k-mono' | 'pcm16-16k-mono' | 'opus-48k-fallback';
  readonly sampleRate: 16000 | 24000 | 48000;
  readonly channels: 1;
  readonly bitDepth: 16;
  readonly frameDurationMs: 10 | 20 | 40;
  readonly maxPacketBytes: number;
  readonly supportsDtx: boolean;
  readonly supportsComfortNoise: boolean;
  readonly defaultJitterBufferMs: number;
}

export interface CodecNegotiationRequest {
  preferredProfile: AudioCodecProfile['id'];
  fallbackProfiles: AudioCodecProfile['id'][];
  transportHint: 'webrtc' | 'websocket';
  enableDtx: boolean;
  enableComfortNoise: boolean;
}

export interface CodecNegotiationResult {
  agreedProfile: AudioCodecProfile;
  negotiationTimeMs: number;
  requiresResample: boolean;
  appliedResampleMethod?: 'webaudio-worklet' | 'native';
  warnings?: string[];
}

export interface AudioFormatDescriptor {
  mediaType: 'audio/pcm';
  sampleRate: number;
  channelCount: number;
  sampleSizeBits: number;
  littleEndian: boolean;
  blockAlign: number;
  bytesPerSecond: number;
}
```

All services SHALL exchange codec identifiers via structured events:

```json
{
  "type": "codec.profile.changed",
  "profileId": "pcm16-24k-mono",
  "transport": "webrtc",
  "timestamp": "2025-10-04T12:00:00Z",
  "metrics": {
    "jitterMs": 12,
    "packetLossPct": 0.2,
    "rttMs": 85
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given PCM16/24 kHz is the default, When a session initializes, Then the negotiated SDP SHALL advertise `ptime=20` and `maxptime<=40` with mono channel layout.
- **AC-002**: Given bandwidth degradation, When transport metrics drop below the adaptive threshold, Then the codec Strategy SHALL switch to the 16 kHz profile within 500 ms and emit a `codec.profile.changed` event.
- **AC-003**: Given codec negotiation succeeds, When `AudioContext.sampleRate` is inspected, Then it SHALL match the agreed profile's sample rate within ±1 Hz.
- **AC-004**: Given automated tests replay captured audio fixtures, When fixtures are validated, Then their WAV headers SHALL match the active codec profile.
- **AC-005**: Given Opus fallback is invoked, When PCM16 negotiation fails twice, Then the system SHALL log a single structured warning and continue streaming without requiring a session restart.

## 6. Test Automation Strategy

- **Test Levels**: Unit tests validate profile factories and negotiation logic; integration tests exercise WebRTC SDP negotiation in headless browsers; end-to-end tests replay audio fixtures through the full pipeline.
- **Frameworks**: Mocha with Sinon for unit tests; Playwright with Web Audio/WebRTC mocks for integration; `@vscode/test-electron` scenarios for extension-host validation.
- **Test Data Management**: Maintain a curated fixture set of PCM16 WAV samples at 16 kHz and 24 kHz; regenerate fixtures via deterministic scripts when codec parameters change.
- **CI/CD Integration**: Incorporate codec validation suites into `npm run test:all`; gate releases on passing transport negotiation checks within GitHub Actions.
- **Coverage Requirements**: Achieve ≥90% statement coverage on codec factories, negotiation strategies, and resampling utilities.
- **Performance Testing**: Implement periodic latency benchmarks verifying encode/decode pipeline stays within the 40 ms target and jitter buffers remain <120 ms.

## 7. Rationale & Context

VoicePilot prioritizes human-in-the-loop conversations where latency and intelligibility dominate user perception. Standardizing on PCM16 aligns with Azure OpenAI GPT Realtime ingestion expectations and simplifies signal processing in AudioWorklet nodes. Defining precise packet sizing, fallback behaviors, and diagnostic emission ensures audio capture (SP-007) and WebRTC transport (SP-006) remain interoperable without ad-hoc tuning.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Azure OpenAI GPT Realtime API – consumes PCM16 streams; mandates SDP parameter alignment.

### Third-Party Services

- **SVC-001**: Azure Media Relay (implicit via GPT Realtime) – enforces DTLS/SRTP requirements and packet limits.

### Infrastructure Dependencies

- **INF-001**: VoicePilot WebRTC signaling service – must relay codec negotiation metadata and propagate fallback decisions.

### Data Dependencies

- **DAT-001**: Audio fixture repository – stores canonical PCM16 WAV assets with provenance metadata.

### Technology Platform Dependencies

- **PLT-001**: Web Audio API 1.1 compliant runtime – required for AudioWorklet-based resampling and real-time analysis.
- **PLT-002**: Chromium-based webview engine (VS Code) – supplies WebRTC stack and SDP customization hooks.

### Compliance Dependencies

- **COM-001**: Regional audio export regulations – require mono PCM16 data to respect regional retention and encryption policies.

## 9. Examples & Edge Cases

```typescript
const preferred: AudioCodecProfile = codecFactory.create('pcm16-24k-mono');
const request: CodecNegotiationRequest = {
  preferredProfile: preferred.id,
  fallbackProfiles: ['pcm16-16k-mono', 'opus-48k-fallback'],
  transportHint: 'webrtc',
  enableDtx: true,
  enableComfortNoise: false
};

const result = await negotiateCodec(request);

if (result.requiresResample) {
  await audioPipeline.reconfigureContext({ sampleRate: result.agreedProfile.sampleRate });
}

// Edge case: enforce payload cap
if (result.agreedProfile.maxPacketBytes > 960) {
  throw new Error('Packet size exceeds Azure Realtime constraints');
}
```

## 10. Validation Criteria

- Verify SDP captures `a=ptime` and `a=maxptime` values consistent with the agreed codec profile.
- Confirm telemetry events report jitter, packet loss, and RTT within configured thresholds.
- Ensure regression tests reject audio fixtures whose metadata diverges from canonical profiles.
- Validate fallback activation logs and transport metrics during synthetic packet loss scenarios.
- Audit logs to confirm no sensitive endpoint identifiers appear in codec negotiation entries.

## 11. Related Specifications / Further Reading

- [SP-006: WebRTC Audio Transport Layer](./sp-006-spec-architecture-webrtc-audio.md)
- [SP-007: Audio Capture Pipeline Architecture](./sp-007-spec-architecture-audio-capture-pipeline.md)
- [RFC 7587: RTP Payload Format for Opus Audio](https://www.rfc-editor.org/rfc/rfc7587)
- [Web Audio API Editors Draft](https://webaudio.github.io/web-audio-api/)

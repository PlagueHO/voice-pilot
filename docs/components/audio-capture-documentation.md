---
title: AudioCapture - Technical Documentation
component_path: src/audio/audio-capture.ts
version: 1.0
date_created: 2025-09-28
last_updated: 2025-09-28
owner: VoicePilot Audio Team
tags: [component, audio, capture, pipeline, documentation, architecture]
---

<!-- markdownlint-disable-next-line MD025 -->
# AudioCapture Documentation

The `AudioCapture` service wraps browser media APIs and VoicePilot's processing chain to provide reliable microphone capture, adaptive metrics, and PCM output suitable for Azure OpenAI realtime sessions.

## 1. Component Overview

### Purpose/Responsibility

- **OVR-001**: Acquire microphone audio, apply Web Audio processing, and stream PCM buffers plus metrics to downstream realtime transports.
- **OVR-002**: Scope covers device validation, audio context lifecycle handling, and event telemetry.
- **OVR-003**: Operates inside browser-capable webviews and the extension host sandbox, coordinating with the shared `AudioContextProvider`, `WebAudioProcessingChain`, and session services.

## 2. Architecture Section

- **ARC-001**: Implements a service facade over Web Audio primitives combined with observer patterns for metrics and events.
- **ARC-002**: Internal dependencies include `Logger`, `AudioContextProvider`, `WebAudioProcessingChain`, `AudioDeviceValidator`, and shared metric helpers.
- **ARC-003**: Interaction flow — initialization configures the shared context, validation ensures device readiness, capture builds the processing graph, and telemetry/events propagate via listeners to subscribers such as the WebRTC transport.
- **ARC-004 / ARC-005**: The component diagram illustrates structure, dependencies, and data flow.

### Component Structure and Dependencies Diagram

```mermaid
graph TD
    subgraph 'Audio Capture Pipeline'
        AC[AudioCapture]
        PCP[WebAudioProcessingChain]
        ACP[AudioContextProvider]
        ADV[AudioDeviceValidator]
        LOG[Logger]
    end

    subgraph 'External Web APIs'
        MED[navigator.mediaDevices]
        WAC[Web Audio API]
        BUF[Node Buffer]
    end

    AC --> PCP
    AC --> ACP
    AC --> ADV
    AC --> LOG
    AC --> MED
    AC --> WAC
    PCP --> ACP
    PCP --> WAC
    ACP --> WAC
    AC --> BUF

    classDiagram
        class AudioCapture {
            -logger: Logger
            -audioContextProvider: AudioContextProvider
            -processingChain: WebAudioProcessingChain
            -deviceValidator: AudioDeviceValidator
            -listeners: Map~AudioCaptureEventType, Set~AudioCaptureEventHandler~~
            +initialize(config?, processingConfig?): Promise~void~
            +startCapture(): Promise~void~
            +stopCapture(): Promise~void~
            +replaceCaptureTrack(deviceId): Promise~MediaStreamTrack~
            +updateCaptureConfig(config): Promise~void~
            +updateProcessingConfig(config): Promise~void~
            +validateAudioDevice(deviceId): Promise~DeviceValidationResult~
            +getAudioMetrics(): AudioMetrics
            +getAudioLevel(): number
            +detectVoiceActivity(): Promise~VoiceActivityResult~
            +addEventListener(type, handler): void
            +removeEventListener(type, handler): void
            +onAudioData(callback): void
            +onError(callback): void
            +isCaptureActive(): boolean
        }
        class WebAudioProcessingChain {
            +createProcessingGraph(stream, config): Promise~AudioProcessingGraph~
            +updateProcessingParameters(graph, config): Promise~void~
            +analyzeAudioLevel(graph): AudioMetrics
            +measureLatency(context): Promise~number~
            +disposeGraph(graph): void
        }
        class AudioContextProvider {
            +configure(configuration): void
            +getOrCreateContext(): Promise~AudioContext~
            +resume(): Promise~void~
            +createGraphForStream(stream): Promise~AudioGraphNodes~
        }
        class AudioDeviceValidator {
            +validateDevice(deviceId): Promise~DeviceValidationResult~
        }
        AudioCapture --> WebAudioProcessingChain
        AudioCapture --> AudioContextProvider
        AudioCapture --> AudioDeviceValidator
        WebAudioProcessingChain --> AudioContextProvider
```

## 3. Interface Documentation

### Public API Surface

| Method/Property | Purpose | Parameters | Return Type | Usage Notes |
|-----------------|---------|------------|-------------|-------------|
| `initialize(config?, processingConfig?)` | Validates availability, merges overrides, and primes the shared audio context provider. | `config?`: partial `AudioCaptureConfig`; `processingConfig?`: partial `AudioProcessingConfig` | `Promise<void>` | Call before capture; reconfigures provider latency and sample-rate hints. |
| `isInitialized()` | Indicates whether initialization completed. | — | `boolean` | Guard subsequent calls. |
| `dispose()` | Stops capture, clears listeners, and releases state. | — | `void` | Safe to call repeatedly. |
| `startCapture()` | Validates target device, acquires stream, builds processing graph, and begins telemetry. | — | `Promise<void>` | Emits `captureStarted`, `deviceChanged`, and metrics events on success. |
| `stopCapture()` | Stops metrics, tears down processing graph, and releases stream. | — | `Promise<void>` | Fires `captureStopped` with context. |
| `isCaptureActive()` | Reports whether capture is currently running. | — | `boolean` | Useful for UI toggles. |
| `getCaptureStream()` | Fetches the active `MediaStream` when capturing. | — | `MediaStream \| null` | Use for WebRTC transport registration. |
| `getCaptureTrack()` | Returns the active microphone track. | — | `MediaStreamTrack \| null` | Primary track for realtime transport. |
| `replaceCaptureTrack(deviceId)` | Swaps the active track and processing graph without stopping capture. | `deviceId`: string | `Promise<MediaStreamTrack>` | Validates and rebuilds graph; emits `deviceChanged`. |
| `updateCaptureConfig(config)` | Applies new capture settings and restarts capture when active. | `config`: partial `AudioCaptureConfig` | `Promise<void>` | Triggers restart to honour hardware changes. |
| `updateProcessingConfig(config)` | Updates processing parameters live. | `config`: partial `AudioProcessingConfig` | `Promise<void>` | Delegates to processing chain; avoids restart. |
| `validateAudioDevice(deviceId)` | Runs capability and access probes for a device. | `deviceId`: string | `Promise<DeviceValidationResult>` | Useful for device picker UX. |
| `getAudioMetrics()` | Retrieves last merged metrics snapshot. | — | `AudioMetrics` | Merges level, latency, buffer health. |
| `getAudioLevel()` | Convenience getter for current level (0–1). | — | `number` | Drives UI meters. |
| `detectVoiceActivity()` | Performs threshold-based VAD using metrics. | — | `Promise<VoiceActivityResult>` | Uses configurable RMS threshold. |
| `addEventListener(type, handler)` | Subscribes to pipeline events. | `type`: `AudioCaptureEventType`; `handler`: callback | `void` | Handlers run in isolation to avoid propagation failures. |
| `removeEventListener(type, handler)` | Unsubscribes a handler. | same as above | `void` | Cleans up map entries when empty. |
| `onAudioData(callback)` | Registers PCM16 buffer consumer. | `callback`: `(Buffer) => void` | `void` | Receives raw audio frames from worklet. |
| `onError(callback)` | Registers handler for unrecoverable errors. | `callback`: `(Error) => void` | `void` | Invoked when `processingError` fires. |

### Event Contracts

- `captureStarted`: emitted with stream and track identifiers plus browser settings once capture begins.
- `captureStopped`: surfaces reason (for example `user-request`) and prior identifiers when capture halts.
- `deviceChanged`: indicates the active input device and label after validation or replacement.
- `audioLevelChanged`: delivers rolling level, peak, and RMS values.
- `metricsUpdated`: aggregates latency, signal-to-noise ratio, buffer health, and counters at configurable intervals.
- `voiceActivity`: triggered when RMS crosses configured threshold, including confidence.
- `processingError`: dispatches structured `AudioProcessingError`, supporting resiliency workflows.
- `qualityChanged`: reserved hook for downstream quality heuristics (not currently emitted).

## 4. Implementation Details

- **IMP-001**: `AudioCapture` orchestrates a `WebAudioProcessingChain` that builds a gain → analyser → worklet graph, enabling PCM encoding via an audio worklet identified by `PCM_ENCODER_WORKLET_NAME`.
- **IMP-002**: Initialization configures the shared `AudioContextProvider` with sample rate, channel, and latency hints, ensuring worklet modules load before capture.
- **IMP-003**: Voice activity detection compares RMS levels against a tunable sensitivity (clamped between 0.05 and 0.95), returning timestamped confidence for turn-taking logic.
- **IMP-004**: Metrics monitoring merges analyser output and latency probes through `mergeMetrics`, while timers honour `analysisIntervalMs`. Errors funnel through `handleError` to emit typed `AudioProcessingError` objects and invoke external handlers.
- **IMP-005**: Device replacement rebuilds the processing graph atomically, preventing audio gaps while ensuring previous stream resources are stopped to avoid leaks.
- **IMP-006**: Context suspension recovery registers a `statechange` listener; on suspension it attempts resume and emits diagnostic errors if browsers reject the resume attempt.
- **IMP-007**: `mapGetUserMediaError` normalises browser errors into domain codes for telemetry and resilience orchestration (for example permission denied versus configuration invalid).

## 5. Usage Examples

### Basic Usage

```typescript
import { AudioCapture } from '../audio/audio-capture';

const audioCapture = new AudioCapture();

await audioCapture.initialize();
audioCapture.onAudioData((pcmBuffer) => {
  // Forward PCM16 frames to a realtime transport or recorder
});

audioCapture.addEventListener('audioLevelChanged', (event) => {
  console.log('Input level', event.data?.level);
});

await audioCapture.startCapture();

// Later, when shutting down
await audioCapture.stopCapture();
audioCapture.dispose();
```

### Advanced Usage

```typescript
import { AudioCapture } from '../audio/audio-capture';
import { AudioContextProvider } from '../audio/audio-context-provider';
import { WebAudioProcessingChain } from '../audio/audio-processing-chain';
import { Logger } from '../core/logger';

const logger = new Logger('RealtimeSession');
const provider = new AudioContextProvider(logger);
const processingChain = new WebAudioProcessingChain(logger, provider);

const capture = new AudioCapture(
  {
    sampleRate: 24000,
    enableNoiseSuppression: true,
    enableEchoCancellation: true,
    enableAutoGainControl: true,
    channelCount: 1,
    bufferSize: 4096,
  },
  logger,
  {
    audioContextProvider: provider,
    processingChain,
  },
);

await capture.initialize(undefined, {
  autoGainControlLevel: 'low',
  voiceActivitySensitivity: 0.6,
});

capture.onAudioData((pcm) => {
  // Stream to WebRTC transport
});

capture.onError((error) => {
  logger.error('Capture failure', { error: error.message });
});

await capture.startCapture();
```

- **USE-001**: Basic sample shows default configuration with level monitoring.
- **USE-002**: Advanced sample injects custom dependencies, tunes processing sensitivity, and wires error handling.
- **USE-003**: Best practices include awaiting `initialize`, guarding cleanup with `stopCapture` and `dispose`, and wrapping downstream consumers to tolerate PCM bursts.

## 6. Quality Attributes

- **Security**: Capture requests rely on browser permission prompts; no credentials are handled. Ensure sessions request least privilege and surface permission denials to the UI.
- **Performance**: Default sample rate (24 kHz) and analyser window (FFT 2048) balance accuracy with CPU usage. Metrics timer defaults to 100 ms; adjust cautiously for low-power devices.
- **Reliability**: Device validation and error mapping distinguish recoverable versus fatal failures, enabling retry loops. Context suspension listeners auto-resume when browsers throttle inactive tabs.
- **Maintainability**: Modular dependencies support targeted testing and mocking. Configuration merging and helper utilities avoid duplication.
- **Extensibility**: Dependency injection hooks allow swapping processing chains or validators, and event/callback contracts support new telemetry consumers without altering core logic.

## 7. Reference Information

### Dependencies

| Dependency | Type | Purpose |
|------------|------|---------|
| `Logger` | Internal utility | Structured logging for diagnostics. |
| `AudioContextProvider` | Internal service | Manages shared `AudioContext`, state listeners, and worklet loading. |
| `WebAudioProcessingChain` | Internal service | Builds and maintains gain/analyser/worklet graph plus metrics. |
| `AudioDeviceValidator` | Internal service | Enumerates devices and probes access permissions. |
| `navigator.mediaDevices` | Browser API | Enumerates devices and acquires microphone streams. |
| `AudioContext` and `AudioWorklet` | Browser API | Provide processing graph and worklet execution. |
| `Buffer` | Node global | Converts ArrayBuffer PCM payloads to Node-compatible buffers. |

### Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| `sampleRate` | Requested audio sample rate (must remain 24000 for Azure realtime). | `24000` |
| `channelCount` | Number of capture channels. | `1` |
| `bufferSize` | Worklet buffer size hint. | `4096` |
| `latencyHint` | Passed to `AudioContext`; governs realtime responsiveness. | `'interactive'` |
| `enableNoiseSuppression` | Requests browser-level DSP. | `true` |
| `enableEchoCancellation` | Enables acoustic echo cancellation. | `true` |
| `enableAutoGainControl` | Enables automatic gain. | `true` |
| `voiceActivitySensitivity` | Threshold for RMS-based VAD (0–1). | `0.65` |
| `analysisIntervalMs` | Interval for metrics updates. | `100` |
| `autoGainControlLevel` | Gain multiplier applied in processing chain. | `'medium'` |

### Testing Guidelines

- Stub `navigator.mediaDevices` and `AudioContext` when running Node-based unit tests; leverage light fakes or dependency injection hooks.
- Validate error paths by simulating `NotAllowedError`, `NotFoundError`, and context suspension states.
- Integration tests in the Extension Host should monitor `captureStarted` and `metricsUpdated` events to ensure the processing graph emits PCM data.

### Troubleshooting

- **Permission denied**: Ensure the host environment grants microphone access; `processingError` with code `PERMISSION_DENIED` indicates user or browser rejection.
- **No audio events**: Confirm `startCapture` resolved and `isCaptureActive()` is true; inspect logs for worklet creation warnings.
- **High latency**: Adjust `latencyHint` or review `measureLatency` output; background tabs may suspend the context.
- **Device swap failures**: Check `replaceCaptureTrack` errors for `DEVICE_NOT_FOUND`; re-enumerate devices and retry.

### Related Documentation

- [`docs/components/extension-controller-documentation.md`](./extension-controller-documentation.md)
- [`docs/components/session-manager-documentation.md`](./session-manager-documentation.md)
- [`docs/design/TECHNICAL-REFERENCE-INDEX.md`](../design/TECHNICAL-REFERENCE-INDEX.md)

### Change History

| Date | Version | Description |
|------|---------|-------------|
| 2025-09-28 | 1.0 | Initial documentation covering architecture, API surface, and usage. |


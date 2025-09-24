---
title: Audio Capture Pipeline Architecture
version: 1.0
date_created: 2025-09-23
last_updated: 2025-09-23
owner: VoicePilot Project
tags: [architecture, audio, capture, pipeline, microphone, webapi]
---

This specification defines the Audio Capture Pipeline architecture for VoicePilot's real-time voice interaction system. The pipeline coordinates microphone access, audio processing, and stream management to provide high-quality audio input for Azure OpenAI Realtime API integration. The architecture ensures efficient audio capture with noise reduction, echo cancellation, and format conversion while maintaining low latency for conversational AI interactions.

## 1. Purpose & Scope

This specification defines the audio capture pipeline requirements for VoicePilot, covering:

- Microphone access and permission management through Web Audio API in VS Code webview context
- Real-time audio processing including noise reduction, echo cancellation, and gain control
- Audio format conversion for Azure OpenAI Realtime API compatibility (PCM16, 24kHz)
- Audio track management for WebRTC communication and stream coordination
- Integration with WebRTC transport layer (SP-006) for bidirectional audio streaming
- Error handling and recovery patterns for audio hardware and permission failures
- Performance optimization for continuous audio processing without blocking UI threads

**Intended Audience**: Extension developers, audio engineers, and real-time communication specialists.

**Assumptions**:

- VS Code webview context with Web Audio API access for microphone capture
- Understanding of audio processing concepts (sample rates, noise reduction, echo cancellation)
- Familiarity with WebRTC MediaStream and MediaStreamTrack APIs
- Knowledge of Azure OpenAI Realtime API audio format requirements (PCM16)
- Understanding of browser security model for microphone permissions

## 2. Definitions

- **Audio Capture Pipeline**: End-to-end system for microphone input processing and stream management
- **Web Audio API**: Browser API for real-time audio processing and analysis in webview context
- **MediaStream**: Browser API representing audio/video stream from microphone or other sources
- **MediaStreamTrack**: Individual audio track within a MediaStream providing audio data
- **AudioContext**: Web Audio API context for audio processing graph and sample rate control
- **PCM16**: 16-bit Pulse Code Modulation audio format required by Azure OpenAI Realtime API
- **Audio Processing Node**: Web Audio API node for real-time audio effects and analysis
- **Voice Activity Detection (VAD)**: Algorithm to detect presence of human speech in audio stream
- **Audio Track Manager**: Component managing WebRTC audio tracks and stream lifecycle
- **Audio Level Meter**: Visual indicator showing microphone input volume and activity
- **Noise Suppression**: Audio processing to reduce background noise from microphone input
- **Echo Cancellation**: Audio processing to eliminate acoustic echo and feedback

## 3. Requirements, Constraints & Guidelines

### Audio Capture Requirements

- **REQ-001**: Pipeline SHALL capture microphone audio through Web Audio API in VS Code webview
- **REQ-002**: Audio capture SHALL request user permission for microphone access with clear purpose
- **REQ-003**: Pipeline SHALL support configurable sample rates (16kHz, 24kHz, 48kHz) with 24kHz default
- **REQ-004**: Audio output SHALL be formatted as PCM16 for Azure OpenAI Realtime API compatibility
- **REQ-005**: Pipeline SHALL provide real-time audio level monitoring for UI feedback
- **REQ-006**: Audio capture SHALL support graceful degradation when microphone access is denied

### Audio Processing Requirements

- **AUD-001**: Pipeline SHALL implement noise suppression for cleaner voice input
- **AUD-002**: Echo cancellation SHALL be enabled to prevent acoustic feedback
- **AUD-003**: Automatic gain control SHALL normalize microphone input levels
- **AUD-004**: Audio processing SHALL not introduce latency exceeding 50ms
- **AUD-005**: Pipeline SHALL detect and handle audio processing errors gracefully
- **AUD-006**: Buffer management SHALL prevent audio dropouts during continuous recording

### WebRTC Integration Requirements

- **WEB-001**: Pipeline SHALL provide MediaStreamTrack for WebRTC peer connection integration
- **WEB-002**: Audio tracks SHALL be compatible with WebRTC transport layer (SP-006)
- **WEB-003**: Pipeline SHALL support track replacement for device switching without connection restart
- **WEB-004**: Audio stream quality SHALL adapt to network conditions through WebRTC feedback
- **WEB-005**: Pipeline SHALL coordinate with WebRTC transport for optimal audio routing

### Performance Requirements

- **PERF-001**: Audio capture initialization SHALL complete within 2 seconds under normal conditions
- **PERF-002**: Continuous audio processing SHALL consume less than 5% CPU on typical hardware
- **PERF-003**: Memory usage SHALL be bounded with automatic buffer cleanup
- **PERF-004**: Audio latency SHALL be optimized for real-time conversation (target <100ms total)
- **PERF-005**: Pipeline SHALL handle device switching without audio interruption

### Error Handling Requirements

- **ERR-001**: Microphone permission denial SHALL provide clear user guidance and retry options
- **ERR-002**: Hardware failures SHALL be detected and reported with diagnostic information
- **ERR-003**: Audio processing errors SHALL trigger automatic recovery without session termination
- **ERR-004**: Device disconnection SHALL be handled with graceful fallback to default device
- **ERR-005**: Pipeline SHALL provide detailed error reporting for debugging and support

### Security Requirements

- **SEC-001**: Microphone access SHALL only be requested when voice session is initiated
- **SEC-002**: Audio data SHALL not be stored locally or transmitted to unauthorized endpoints
- **SEC-003**: Permission status SHALL be clearly communicated to users at all times
- **SEC-004**: Pipeline SHALL respect browser security policies for media access

### Configuration Requirements

- **CFG-001**: Audio device selection SHALL be configurable through extension settings
- **CFG-002**: Audio processing parameters SHALL be tunable for different environments
- **CFG-003**: Pipeline SHALL support hot-reloading of audio configuration changes
- **CFG-004**: Default configuration SHALL work optimally for most user environments

### Integration Guidelines

- **GUD-001**: Use Web Audio API best practices for cross-browser compatibility
- **GUD-002**: Implement proper resource cleanup to prevent memory leaks
- **GUD-003**: Provide comprehensive event system for pipeline state notifications
- **GUD-004**: Follow VS Code webview security model for media access

### Architecture Patterns

- **PAT-001**: Use Pipeline pattern for audio processing stages
- **PAT-002**: Implement Observer pattern for real-time audio level notifications
- **PAT-003**: Use Factory pattern for audio processing node creation
- **PAT-004**: Provide Strategy pattern for different audio processing configurations

## 4. Interfaces & Data Contracts

### Audio Capture Pipeline Interface

```typescript
interface AudioCapturePipeline extends ServiceInitializable {
  // Pipeline lifecycle
  startCapture(): Promise<void>;
  stopCapture(): void;
  isCapturing(): boolean;

  // Audio track management
  getCaptureTrack(): MediaStreamTrack | null;
  replaceCaptureTrack(constraints?: MediaTrackConstraints): Promise<MediaStreamTrack>;

  // Audio processing control
  setAudioProcessing(config: AudioProcessingConfig): Promise<void>;
  getAudioLevel(): number;
  getAudioMetrics(): AudioMetrics;

  // Configuration management
  updateCaptureConfig(config: AudioCaptureConfig): Promise<void>;
  validateAudioDevice(deviceId: string): Promise<DeviceValidationResult>;

  // Event handling
  addEventListener(type: AudioCaptureEventType, handler: AudioCaptureEventHandler): void;
  removeEventListener(type: AudioCaptureEventType, handler: AudioCaptureEventHandler): void;
}

interface AudioCaptureConfig {
  deviceId?: string; // 'default' or specific device ID
  sampleRate: 16000 | 24000 | 48000;
  channels: 1 | 2; // Mono recommended for voice
  bufferSize: number; // Audio buffer size in samples
  enableNoiseReduction: boolean;
  enableEchoCancellation: boolean;
  enableAutoGainControl: boolean;
}

interface AudioProcessingConfig {
  noiseSuppressionLevel: 'low' | 'medium' | 'high';
  echoCancellationMode: 'browser' | 'acoustic' | 'system';
  gainControlTarget: number; // Target gain level 0.0-1.0
  voiceActivitySensitivity: number; // VAD sensitivity 0.1-1.0
}
```

### Audio Track Manager Interface

```typescript
interface AudioTrackManager extends ServiceInitializable {
  // Track lifecycle
  captureMicrophone(constraints?: MediaTrackConstraints): Promise<MediaStreamTrack>;
  releaseTrack(trackId: string): void;
  replaceTrack(oldTrackId: string, newConstraints: MediaTrackConstraints): Promise<MediaStreamTrack>;

  // Track management
  getActiveTrack(): MediaStreamTrack | null;
  getAllTracks(): MediaStreamTrack[];
  getTrackState(trackId: string): MediaStreamTrackState;

  // Quality monitoring
  getTrackStatistics(trackId: string): Promise<AudioTrackStatistics>;
  onTrackQualityChanged(callback: (stats: AudioTrackStatistics) => void): void;

  // Event handling
  onTrackEnded(callback: (trackId: string) => void): void;
  onTrackMuted(callback: (trackId: string, muted: boolean) => void): void;
}

interface AudioTrackStatistics {
  trackId: string;
  sampleRate: number;
  channelCount: number;
  audioLevel: number; // 0.0-1.0
  isEnabled: boolean;
  isMuted: boolean;
  constraints: MediaTrackConstraints;
  settings: MediaTrackSettings;
}
```

### Audio Processing Chain Interface

```typescript
interface AudioProcessingChain {
  // Processing pipeline
  createProcessingGraph(context: AudioContext, config: AudioProcessingConfig): AudioProcessingGraph;
  updateProcessingParameters(graph: AudioProcessingGraph, config: AudioProcessingConfig): void;
  connectToDestination(graph: AudioProcessingGraph, destination: AudioNode): void;

  // Real-time analysis
  analyzeAudioLevel(analyser: AnalyserNode): number;
  detectVoiceActivity(analyser: AnalyserNode, sensitivity: number): boolean;
  measureLatency(context: AudioContext): Promise<number>;
}

interface AudioProcessingGraph {
  source: MediaStreamAudioSourceNode;
  gainNode: GainNode;
  filterNode: BiquadFilterNode;
  analyserNode: AnalyserNode;
  destination: AudioNode;
  context: AudioContext;
}

interface AudioMetrics {
  inputLevel: number; // Current input level 0.0-1.0
  averageLevel: number; // Average level over time window
  peakLevel: number; // Peak level over time window
  noiseLevel: number; // Estimated noise floor
  signalToNoiseRatio: number; // SNR in dB
  voiceActivityProbability: number; // VAD confidence 0.0-1.0
  processingLatency: number; // Current processing latency in ms
  bufferHealth: number; // Buffer utilization 0.0-1.0
}
```

### Event System Interface

```typescript
type AudioCaptureEventType =
  | 'captureStarted'
  | 'captureStopped'
  | 'deviceChanged'
  | 'permissionGranted'
  | 'permissionDenied'
  | 'audioLevelChanged'
  | 'voiceActivityDetected'
  | 'processingError'
  | 'qualityChanged';

interface AudioCaptureEventHandler {
  (event: AudioCaptureEvent): Promise<void> | void;
}

interface AudioCaptureEvent {
  type: AudioCaptureEventType;
  timestamp: Date;
  source: string;
  data?: any;
}

interface CaptureStartedEvent extends AudioCaptureEvent {
  type: 'captureStarted';
  data: {
    deviceId: string;
    deviceLabel: string;
    sampleRate: number;
    channelCount: number;
  };
}

interface AudioLevelChangedEvent extends AudioCaptureEvent {
  type: 'audioLevelChanged';
  data: {
    level: number;
    peak: number;
    voiceDetected: boolean;
  };
}

interface ProcessingErrorEvent extends AudioCaptureEvent {
  type: 'processingError';
  data: {
    error: AudioProcessingError;
    recovery: boolean;
  };
}
```

### Error Handling Interface

```typescript
interface AudioProcessingError {
  code: AudioErrorCode;
  message: string;
  severity: 'warning' | 'error' | 'fatal';
  context: AudioErrorContext;
  timestamp: Date;
  recoverable: boolean;
}

enum AudioErrorCode {
  PermissionDenied = 'PERMISSION_DENIED',
  DeviceNotFound = 'DEVICE_NOT_FOUND',
  DeviceInUse = 'DEVICE_IN_USE',
  HardwareFailure = 'HARDWARE_FAILURE',
  ProcessingFailure = 'PROCESSING_FAILURE',
  BufferUnderrun = 'BUFFER_UNDERRUN',
  ContextSuspended = 'CONTEXT_SUSPENDED',
  ConfigurationInvalid = 'CONFIGURATION_INVALID'
}

interface AudioErrorContext {
  deviceId?: string;
  sampleRate?: number;
  bufferSize?: number;
  userAgent: string;
  webAudioSupport: boolean;
  mediaDevicesSupport: boolean;
}

interface DeviceValidationResult {
  isValid: boolean;
  deviceInfo?: MediaDeviceInfo;
  capabilities?: MediaTrackCapabilities;
  error?: AudioProcessingError;
}
```

## 5. Acceptance Criteria

- **AC-001**: Given webview has media permissions, When startCapture() is called, Then microphone access is granted within 2 seconds
- **AC-002**: Given microphone is captured, When audio is spoken, Then audio levels are detected and reported in real-time
- **AC-003**: Given audio capture is active, When device is switched, Then new device is activated without dropping audio session
- **AC-004**: Given noise reduction is enabled, When background noise is present, Then voice signal is enhanced and noise is suppressed
- **AC-005**: Given permission is denied, When capture is attempted, Then clear error guidance is provided with retry option
- **AC-006**: Given audio processing is active, When CPU usage is measured, Then processing consumes less than 5% CPU continuously
- **AC-007**: Given WebRTC integration, When getCaptureTrack() is called, Then valid MediaStreamTrack is provided for peer connection
- **AC-008**: Given configuration changes, When updateCaptureConfig() is called, Then audio processing adapts without capture interruption
- **AC-009**: Given voice activity detection, When speech is detected, Then VAD event is fired with confidence level
- **AC-010**: Given audio hardware failure, When device becomes unavailable, Then graceful fallback to default device occurs

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for audio processing logic, Integration tests with mocked Web Audio API, End-to-End tests with real microphone hardware
- **Frameworks**: Jest with Web Audio API mocks, Puppeteer for browser automation, WebRTC testing frameworks for media stream validation
- **Test Data Management**: Synthetic audio signals for processing tests, recorded audio samples for VAD validation, Device simulation for hardware scenarios
- **CI/CD Integration**: Automated audio pipeline testing in GitHub Actions with headless browser support and audio device simulation
- **Coverage Requirements**: 95% coverage for audio processing algorithms, 100% coverage for error handling paths
- **Performance Testing**: Audio latency measurement, CPU usage monitoring, Memory leak detection for continuous processing
- **Hardware Testing**: Multiple microphone devices, USB and Bluetooth audio interfaces, Permission denial scenarios
- **Cross-Platform Testing**: Windows, macOS, Linux audio systems through VS Code webview contexts

## 7. Rationale & Context

The Audio Capture Pipeline design addresses critical requirements for conversational AI interaction:

1. **Real-Time Performance**: Web Audio API provides the lowest latency audio processing available in browser context, essential for natural conversation flow.

2. **Quality Optimization**: Integrated noise reduction, echo cancellation, and gain control ensure high-quality voice input for accurate speech recognition.

3. **WebRTC Compatibility**: Direct integration with WebRTC MediaStreamTrack enables seamless connection to Azure OpenAI Realtime API transport layer.

4. **Device Flexibility**: Support for device switching and configuration changes allows users to optimize their audio setup without interrupting voice sessions.

5. **Error Resilience**: Comprehensive error handling and recovery ensures reliable operation despite hardware failures or permission issues.

6. **Performance Efficiency**: Optimized processing chain minimizes CPU usage while maintaining audio quality for continuous operation.

The pipeline design prioritizes user experience through clear permission handling, visual feedback, and graceful error recovery while maintaining technical excellence for real-time audio processing.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Webview Context - Required for Web Audio API access and microphone permissions
- **PLT-002**: Web Audio API - Required for real-time audio processing and analysis
- **PLT-003**: MediaDevices API - Required for microphone enumeration and getUserMedia() access

### Browser API Dependencies

- **BRW-001**: MediaStream API - Required for audio stream capture and track management
- **BRW-002**: MediaStreamTrack API - Required for individual audio track control and statistics
- **BRW-003**: MediaDevices Permissions API - Required for microphone permission management
- **BRW-004**: AudioContext API - Required for audio processing graph and sample rate control

### Extension Internal Dependencies

- **INT-001**: ConfigurationManager (SP-002) - Required for audio device and processing configuration
- **INT-002**: Logger - Required for audio processing diagnostics and debugging
- **INT-003**: ServiceInitializable - Required for lifecycle management integration
- **INT-004**: WebRTC Transport Layer (SP-006) - Required for audio track integration

### Azure Service Dependencies

- **AZR-001**: Azure OpenAI Realtime API - Required for audio format compatibility (PCM16)
- **AZR-002**: WebRTC Audio Transport - Required for bidirectional audio streaming

### Future Integration Dependencies

- **FUT-001**: Voice Activity Detection Engine (SP-008) - Will optimize capture based on speech detection
- **FUT-002**: Audio Feedback System (SP-015) - Will coordinate with capture for echo prevention
- **FUT-003**: Interruption Management (SP-011) - Will coordinate with capture for turn-taking detection

### Hardware Dependencies

- **HW-001**: Audio Input Devices - Required for microphone capture functionality
- **HW-002**: Audio Processing Capabilities - Required for real-time noise reduction and echo cancellation
- **HW-003**: USB/Bluetooth Audio Support - Required for external microphone device compatibility

### Performance Dependencies

- **PERF-001**: Web Workers API - Optional for offloading audio processing from main thread
- **PERF-002**: SharedArrayBuffer - Optional for efficient audio data sharing between threads
- **PERF-003**: High-Resolution Timers - Required for accurate latency measurement and buffer management

## 9. Examples & Edge Cases

### Basic Audio Capture Setup

```typescript
class AudioCapturePipeline implements ServiceInitializable {
  private audioContext: AudioContext | null = null;
  private captureStream: MediaStream | null = null;
  private processingGraph: AudioProcessingGraph | null = null;
  private isCapturing = false;

  async initialize(): Promise<void> {
    // Initialize audio context with optimal sample rate
    this.audioContext = new AudioContext({
      sampleRate: this.config.sampleRate,
      latencyHint: 'interactive'
    });

    // Request microphone permissions early
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      this.logger.info('Microphone permission granted');
    } catch (error) {
      this.logger.warn('Microphone permission not granted during initialization');
    }
  }

  async startCapture(): Promise<void> {
    if (this.isCapturing) return;

    try {
      // Capture microphone with optimized constraints
      this.captureStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.config.deviceId,
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
          echoCancellation: this.config.enableEchoCancellation,
          noiseSuppression: this.config.enableNoiseReduction,
          autoGainControl: this.config.enableAutoGainControl
        }
      });

      // Create audio processing graph
      this.processingGraph = this.createProcessingGraph();

      // Start real-time processing
      this.setupRealTimeProcessing();

      this.isCapturing = true;
      this.emitEvent('captureStarted', { deviceId: this.config.deviceId });

    } catch (error) {
      this.handleCaptureError(error);
    }
  }

  private createProcessingGraph(): AudioProcessingGraph {
    const source = this.audioContext!.createMediaStreamSource(this.captureStream!);
    const gainNode = this.audioContext!.createGain();
    const filterNode = this.audioContext!.createBiquadFilter();
    const analyserNode = this.audioContext!.createAnalyser();

    // Configure processing nodes
    gainNode.gain.value = this.config.gainLevel;
    filterNode.type = 'highpass';
    filterNode.frequency.value = 80; // Remove low-frequency noise
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.8;

    // Connect processing chain
    source.connect(gainNode);
    gainNode.connect(filterNode);
    filterNode.connect(analyserNode);

    return { source, gainNode, filterNode, analyserNode, context: this.audioContext! };
  }
}
```

### Real-Time Audio Level Monitoring

```typescript
private setupRealTimeProcessing(): void {
  const analyser = this.processingGraph!.analyserNode;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  const processAudio = () => {
    if (!this.isCapturing) return;

    // Get current audio data
    analyser.getByteFrequencyData(dataArray);

    // Calculate audio level
    const audioLevel = this.calculateAudioLevel(dataArray);

    // Detect voice activity
    const voiceDetected = this.detectVoiceActivity(dataArray);

    // Emit real-time events
    this.emitEvent('audioLevelChanged', {
      level: audioLevel,
      voiceDetected,
      timestamp: Date.now()
    });

    // Continue processing
    requestAnimationFrame(processAudio);
  };

  // Start processing loop
  requestAnimationFrame(processAudio);
}

private calculateAudioLevel(dataArray: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    sum += dataArray[i];
  }
  return (sum / dataArray.length) / 255.0;
}

private detectVoiceActivity(dataArray: Uint8Array): boolean {
  // Simple VAD based on spectral energy distribution
  const lowFreqEnergy = dataArray.slice(0, 10).reduce((a, b) => a + b, 0);
  const midFreqEnergy = dataArray.slice(10, 50).reduce((a, b) => a + b, 0);
  const highFreqEnergy = dataArray.slice(50, 100).reduce((a, b) => a + b, 0);

  // Voice typically has more mid-frequency energy
  const voiceRatio = midFreqEnergy / (lowFreqEnergy + highFreqEnergy + 1);
  return voiceRatio > this.config.voiceActivityThreshold;
}
```

### Edge Case: Device Switching During Capture

```typescript
async replaceAudioDevice(newDeviceId: string): Promise<void> {
  if (!this.isCapturing) {
    this.config.deviceId = newDeviceId;
    return;
  }

  try {
    // Capture new device without stopping current capture
    const newStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: newDeviceId,
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channels,
        echoCancellation: this.config.enableEchoCancellation,
        noiseSuppression: this.config.enableNoiseReduction,
        autoGainControl: this.config.enableAutoGainControl
      }
    });

    // Replace audio source in processing graph
    const oldSource = this.processingGraph!.source;
    const newSource = this.audioContext!.createMediaStreamSource(newStream);

    // Atomic replacement to prevent audio gaps
    oldSource.disconnect();
    newSource.connect(this.processingGraph!.gainNode);

    // Cleanup old stream
    this.captureStream!.getTracks().forEach(track => track.stop());

    // Update state
    this.captureStream = newStream;
    this.processingGraph!.source = newSource;
    this.config.deviceId = newDeviceId;

    this.emitEvent('deviceChanged', { deviceId: newDeviceId });
    this.logger.info('Audio device switched successfully', { newDeviceId });

  } catch (error) {
    this.logger.error('Failed to switch audio device', { error, newDeviceId });
    // Continue with current device
    throw new AudioProcessingError({
      code: AudioErrorCode.DeviceNotFound,
      message: `Failed to switch to device: ${newDeviceId}`,
      severity: 'error',
      recoverable: true,
      timestamp: new Date()
    });
  }
}
```

### Edge Case: Permission Denied Recovery

```typescript
private async handlePermissionDenied(): Promise<void> {
  this.emitEvent('permissionDenied', {
    message: 'Microphone access is required for voice interaction',
    canRetry: true
  });

  // Provide recovery guidance through VS Code UI
  const action = await vscode.window.showErrorMessage(
    'VoicePilot needs microphone access for voice interaction. Please grant permission in your browser.',
    'Try Again',
    'Settings Help'
  );

  if (action === 'Try Again') {
    // Retry permission request
    setTimeout(() => this.startCapture(), 1000);
  } else if (action === 'Settings Help') {
    // Open help documentation
    vscode.env.openExternal(vscode.Uri.parse('https://docs.voicepilot.dev/permissions'));
  }
}
```

### Edge Case: Audio Context Suspended Recovery

```typescript
private async handleAudioContextSuspended(): Promise<void> {
  if (this.audioContext?.state === 'suspended') {
    try {
      await this.audioContext.resume();
      this.logger.info('Audio context resumed successfully');
    } catch (error) {
      this.logger.error('Failed to resume audio context', { error });

      // Recreate audio context if resume fails
      await this.recreateAudioContext();
    }
  }
}

private async recreateAudioContext(): Promise<void> {
  // Cleanup existing context
  if (this.audioContext) {
    await this.audioContext.close();
  }

  // Create new context
  this.audioContext = new AudioContext({
    sampleRate: this.config.sampleRate,
    latencyHint: 'interactive'
  });

  // Recreate processing graph if capturing
  if (this.isCapturing && this.captureStream) {
    this.processingGraph = this.createProcessingGraph();
    this.setupRealTimeProcessing();
  }

  this.logger.info('Audio context recreated successfully');
}
```

## 10. Validation Criteria

- Audio capture initializes successfully with Web Audio API in VS Code webview context
- Microphone permissions are requested and handled gracefully with clear user guidance
- Audio processing provides real-time level monitoring with configurable sensitivity
- Voice activity detection accurately identifies speech vs. noise with tunable thresholds
- Device switching works seamlessly without audio session interruption
- Error handling provides comprehensive recovery for all failure scenarios
- Performance requirements met for continuous audio processing (CPU, memory, latency)
- WebRTC integration provides valid MediaStreamTrack for transport layer
- Configuration changes take effect without requiring capture restart
- Cross-platform compatibility verified across Windows, macOS, and Linux

## 11. Related Specifications / Further Reading

- [SP-002: Configuration & Settings Management](sp-002-spec-design-configuration-management.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md)
- [SP-008: Voice Activity Detection (VAD)](sp-008-spec-algorithm-voice-activity-detection.md)
- [SP-011: Interruption & Turn-Taking Engine](sp-011-spec-design-interruption-management.md)
- [SP-015: Audio Feedback & Sound Design](sp-015-spec-design-audio-feedback.md)
- [Web Audio API Specification](https://webaudio.github.io/web-audio-api/)
- [MediaDevices API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices)
- [WebRTC MediaStreamTrack API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack)
- [Azure OpenAI Realtime Audio Quickstart](https://docs.microsoft.com/en-us/azure/ai-services/openai/realtime-audio)

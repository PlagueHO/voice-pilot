import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import { AudioTrackState, AudioTrackStatistics } from '../types/audio-capture';
import { ConnectionQuality, ConnectionStatistics, WebRTCErrorCode, WebRTCErrorImpl, WebRTCTransport } from '../types/webrtc';

const QUALITY_MONITOR_DEFAULT_INTERVAL_MS = 2000;

/**
 * Manages audio tracks for WebRTC communication
 * Handles microphone capture, track management, quality monitoring, and seamless device switching.
 */
export class AudioTrackManager implements ServiceInitializable {
  private initialized = false;
  private readonly logger: Logger;

  private localStream: MediaStream | null = null;
  private readonly localTracks = new Map<string, MediaStreamTrack>();
  private readonly trackStreams = new Map<string, MediaStream>();
  private readonly remoteStreams = new Map<string, MediaStream>();

  private readonly trackStateHandlers = new Set<(trackId: string, state: AudioTrackState) => void>();
  private readonly trackMuteHandlers = new Set<(trackId: string, muted: boolean) => void>();
  private readonly trackQualityHandlers = new Set<(quality: ConnectionQuality, statistics?: ConnectionStatistics) => void>();

  private qualityMonitorTimer?: ReturnType<typeof setInterval>;
  private qualityMonitorTransport: WebRTCTransport | null = null;
  private qualityMonitorInterval = QUALITY_MONITOR_DEFAULT_INTERVAL_MS;
  private lastConnectionQuality?: ConnectionQuality;

  private audioConstraints: MediaTrackConstraints = {
    sampleRate: 24000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };

  constructor(logger?: Logger) {
    this.logger = logger || new Logger('AudioTrackManager');
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.logger.info('Initializing AudioTrackManager');

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not supported in this environment');
    }

    this.initialized = true;
    this.logger.info('AudioTrackManager initialized successfully');
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  dispose(): void {
    this.logger.info('Disposing AudioTrackManager');

    this.stopQualityMonitor();
    this.stopAllLocalTracks();
    this.clearRemoteStreams();

    this.trackStateHandlers.clear();
    this.trackMuteHandlers.clear();
    this.trackQualityHandlers.clear();
    this.trackStreams.clear();

    this.initialized = false;
    this.logger.info('AudioTrackManager disposed');
  }

  async captureMicrophone(customConstraints?: MediaTrackConstraints): Promise<MediaStreamTrack> {
    this.ensureInitialized();

    try {
      const constraints = {
        audio: {
          ...this.audioConstraints,
          ...customConstraints
        }
      };

      this.logger.debug('Requesting microphone access', { constraints });

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const audioTrack = stream.getAudioTracks()[0];

      if (!audioTrack) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('Failed to obtain audio track from microphone');
      }

      this.localStream = stream;
      this.localTracks.set(audioTrack.id, audioTrack);
      this.trackStreams.set(audioTrack.id, stream);
      this.setupTrackEventHandlers(audioTrack);
      this.emitTrackState(audioTrack);

      this.logger.info('Microphone captured successfully', {
        trackId: audioTrack.id,
        label: audioTrack.label,
        settings: audioTrack.getSettings()
      });

      return audioTrack;
    } catch (error: any) {
      this.logger.error('Failed to capture microphone', { error: error?.message });

      if (error?.name === 'NotAllowedError') {
        throw new WebRTCErrorImpl({
          code: WebRTCErrorCode.AudioTrackFailed,
          message: 'Microphone access denied by user',
          details: error,
          recoverable: false,
          timestamp: new Date()
        });
      }

      if (error?.name === 'NotFoundError') {
        throw new WebRTCErrorImpl({
          code: WebRTCErrorCode.AudioTrackFailed,
          message: 'No microphone device found',
          details: error,
          recoverable: false,
          timestamp: new Date()
        });
      }

      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AudioTrackFailed,
        message: `Failed to capture microphone: ${error?.message ?? 'unknown error'}`,
        details: error,
        recoverable: true,
        timestamp: new Date()
      });
    }
  }

  async addTrackToTransport(transport: WebRTCTransport, track: MediaStreamTrack): Promise<void> {
    try {
      await transport.addAudioTrack(track);
      this.logger.debug('Audio track added to transport', { trackId: track.id });
    } catch (error: any) {
      this.logger.error('Failed to add track to transport', { error: error?.message });
      throw error;
    }
  }

  async removeTrackFromTransport(transport: WebRTCTransport, track: MediaStreamTrack): Promise<void> {
    try {
      await transport.removeAudioTrack(track);
      this.localTracks.delete(track.id);
      this.stopStreamForTrack(track.id);
      this.emitTrackStateById(track.id, true);
      this.logger.debug('Audio track removed from transport', { trackId: track.id });
    } catch (error: any) {
      this.logger.error('Failed to remove track from transport', { error: error?.message });
      throw error;
    }
  }

  async replaceTrack(transport: WebRTCTransport, newTrack: MediaStreamTrack, stream: MediaStream, currentTrackId?: string): Promise<void> {
    this.ensureInitialized();

    const existingTrackId = currentTrackId ?? this.getPrimaryTrackId();
    const existingTrack = existingTrackId ? this.localTracks.get(existingTrackId) : undefined;

    try {
      const supportsReplace = typeof (transport as unknown as { replaceAudioTrack?: (oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack) => Promise<void> }).replaceAudioTrack === 'function';

      if (existingTrack && supportsReplace) {
        await (transport as unknown as { replaceAudioTrack: (oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack) => Promise<void> }).replaceAudioTrack(existingTrack, newTrack);
        this.logger.debug('Replaced audio track using transport replaceAudioTrack', { oldTrackId: existingTrack.id, newTrackId: newTrack.id });
      } else {
        if (existingTrack) {
          await transport.removeAudioTrack(existingTrack);
          this.logger.debug('Removed existing track prior to replacement', { trackId: existingTrack.id });
        }

        await transport.addAudioTrack(newTrack);
        this.logger.debug('Added new audio track to transport', { trackId: newTrack.id });
      }

      if (existingTrack) {
        this.localTracks.delete(existingTrack.id);
        this.stopStreamForTrack(existingTrack.id);
        existingTrack.stop();
      }

      this.localTracks.set(newTrack.id, newTrack);
      this.trackStreams.set(newTrack.id, stream);
      this.localStream = stream;
      this.setupTrackEventHandlers(newTrack);
      this.emitTrackState(newTrack);
    } catch (error: any) {
      this.logger.error('Failed to replace audio track', { error: error?.message });
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  }

  handleRemoteStream(stream: MediaStream, streamId?: string): void {
    const id = streamId ?? stream.id;
    this.remoteStreams.set(id, stream);
    this.logger.debug('Remote stream registered', { streamId: id, trackCount: stream.getTracks().length });
    this.setupAudioPlayback(stream);
  }

  getLocalTracks(): MediaStreamTrack[] {
    return Array.from(this.localTracks.values());
  }

  getRemoteStreams(): MediaStream[] {
    return Array.from(this.remoteStreams.values());
  }

  stopTrack(trackId: string): void {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return;
    }

    track.stop();
    this.localTracks.delete(trackId);
    this.stopStreamForTrack(trackId);
    this.emitTrackStateById(trackId, true);
    this.logger.debug('Audio track stopped', { trackId });
  }

  stopAllLocalTracks(): void {
    for (const track of this.localTracks.values()) {
      track.stop();
    }

    for (const stream of this.trackStreams.values()) {
      stream.getTracks().forEach(track => track.stop());
    }

    this.localTracks.clear();
    this.trackStreams.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.logger.info('All local audio tracks stopped');
  }

  setTrackMuted(trackId: string, muted: boolean): void {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return;
    }

    track.enabled = !muted;
    this.emitTrackMuted(trackId, muted);
    this.emitTrackState(track);
    this.logger.debug('Track mute state changed', { trackId, muted });
  }

  getTrackStatistics(track: MediaStreamTrack, statistics?: ConnectionStatistics): AudioTrackStatistics {
    const settings = track.getSettings();
    const capabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : undefined;
    const connectionStats = statistics ?? this.tryGetConnectionStatistics();
    const durationSeconds = connectionStats ? Math.max(connectionStats.connectionDurationMs / 1000, 1) : undefined;
    const bitrate = connectionStats && durationSeconds ? (connectionStats.audioBytesSent * 8) / durationSeconds : undefined;

    return {
      trackId: track.id,
      label: track.label,
      kind: track.kind,
      enabled: track.enabled,
      muted: track.muted,
      state: track.readyState,
      sampleRate: settings.sampleRate,
      channelCount: settings.channelCount,
      bitrate,
      jitter: connectionStats?.jitter,
      packetsLost: connectionStats?.packetsLost,
      audioLevel: connectionStats ? this.estimateAudioLevel(connectionStats.connectionQuality) : undefined,
      framesPerSecond: settings.frameRate,
      settings,
      capabilities
    };
  }

  getTrackState(trackId: string): AudioTrackState | null {
    const track = this.localTracks.get(trackId);
    if (!track) {
      return null;
    }

    return {
      trackId,
      state: track.readyState,
      muted: track.muted,
      enabled: track.enabled,
      ready: track.readyState === 'live',
      ended: track.readyState === 'ended'
    };
  }

  adjustAudioQuality(quality: ConnectionQuality): void {
    switch (quality) {
      case ConnectionQuality.Excellent:
        this.audioConstraints = { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        break;
      case ConnectionQuality.Good:
        this.audioConstraints = { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        break;
      case ConnectionQuality.Fair:
      case ConnectionQuality.Poor:
        this.audioConstraints = { sampleRate: 8000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        break;
      case ConnectionQuality.Failed:
        break;
    }

    this.emitQualityChanged(quality, this.tryGetConnectionStatistics());
    this.logger.debug('Audio quality adjusted', { quality, constraints: this.audioConstraints });
  }

  async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch (error: any) {
      this.logger.error('Failed to enumerate audio devices', { error: error?.message });
      return [];
    }
  }

  async switchAudioDevice(deviceId: string, transport?: WebRTCTransport): Promise<MediaStreamTrack> {
    this.ensureInitialized();

    const constraints: MediaStreamConstraints = {
      audio: {
        ...this.audioConstraints,
        deviceId: { exact: deviceId }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = stream.getAudioTracks()[0];

    if (!newTrack) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('Failed to obtain audio track when switching devices');
    }

    if (transport && this.localTracks.size > 0) {
      await this.replaceTrack(transport, newTrack, stream);
    } else {
      this.stopAllLocalTracks();
      this.localStream = stream;
      this.localTracks.set(newTrack.id, newTrack);
      this.trackStreams.set(newTrack.id, stream);
      this.setupTrackEventHandlers(newTrack);
      this.emitTrackState(newTrack);
    }

    this.logger.info('Audio device switched', { deviceId, trackId: newTrack.id });
    return newTrack;
  }

  onTrackQualityChanged(handler: (quality: ConnectionQuality, statistics?: ConnectionStatistics) => void): void {
    this.trackQualityHandlers.add(handler);
  }

  onTrackStateChanged(handler: (trackId: string, state: AudioTrackState) => void): void {
    this.trackStateHandlers.add(handler);
  }

  onTrackMuted(handler: (trackId: string, muted: boolean) => void): void {
    this.trackMuteHandlers.add(handler);
  }

  startQualityMonitor(transport: WebRTCTransport, intervalMs = QUALITY_MONITOR_DEFAULT_INTERVAL_MS): void {
    this.stopQualityMonitor();
    this.qualityMonitorTransport = transport;
    this.qualityMonitorInterval = intervalMs;
    this.qualityMonitorTimer = setInterval(() => this.pollConnectionQuality(), intervalMs);
  }

  stopQualityMonitor(): void {
    if (this.qualityMonitorTimer) {
      clearInterval(this.qualityMonitorTimer);
      this.qualityMonitorTimer = undefined;
    }
    this.qualityMonitorTransport = null;
    this.lastConnectionQuality = undefined;
  }

  private pollConnectionQuality(): void {
    if (!this.qualityMonitorTransport) {
      return;
    }

    try {
      const stats = this.qualityMonitorTransport.getConnectionStatistics();
      if (!stats) {
        return;
      }

      if (!this.lastConnectionQuality || this.lastConnectionQuality !== stats.connectionQuality) {
        this.lastConnectionQuality = stats.connectionQuality;
        this.emitQualityChanged(stats.connectionQuality, stats);
      }
    } catch (error: any) {
      this.logger.warn('Failed to poll connection quality', { error: error?.message });
    }
  }

  private emitQualityChanged(quality: ConnectionQuality, statistics?: ConnectionStatistics): void {
    for (const handler of this.trackQualityHandlers) {
      try {
        handler(quality, statistics);
      } catch (error: any) {
        this.logger.error('Track quality handler failed', { error: error?.message });
      }
    }
  }

  private emitTrackState(track: MediaStreamTrack): void {
    const state: AudioTrackState = {
      trackId: track.id,
      state: track.readyState,
      muted: track.muted,
      enabled: track.enabled,
      ready: track.readyState === 'live',
      ended: track.readyState === 'ended'
    };

    for (const handler of this.trackStateHandlers) {
      try {
        handler(track.id, state);
      } catch (error: any) {
        this.logger.error('Track state handler failed', { error: error?.message });
      }
    }
  }

  private emitTrackStateById(trackId: string, ended: boolean): void {
    const state: AudioTrackState = {
      trackId,
      state: ended ? 'ended' : 'live',
      muted: true,
      enabled: false,
      ready: !ended,
      ended
    };

    for (const handler of this.trackStateHandlers) {
      try {
        handler(trackId, state);
      } catch (error: any) {
        this.logger.error('Track state handler failed', { error: error?.message });
      }
    }
  }

  private emitTrackMuted(trackId: string, muted: boolean): void {
    for (const handler of this.trackMuteHandlers) {
      try {
        handler(trackId, muted);
      } catch (error: any) {
        this.logger.error('Track mute handler failed', { error: error?.message });
      }
    }
  }

  private setupTrackEventHandlers(track: MediaStreamTrack): void {
    track.addEventListener('ended', () => {
      this.logger.warn('Audio track ended', { trackId: track.id });
      this.localTracks.delete(track.id);
      this.stopStreamForTrack(track.id);
      this.emitTrackState(track);
    });

    track.addEventListener('mute', () => {
      this.logger.debug('Audio track muted', { trackId: track.id });
      this.emitTrackMuted(track.id, true);
      this.emitTrackState(track);
    });

    track.addEventListener('unmute', () => {
      this.logger.debug('Audio track unmuted', { trackId: track.id });
      this.emitTrackMuted(track.id, false);
      this.emitTrackState(track);
    });
  }

  private setupAudioPlayback(stream: MediaStream): void {
    const audioElement = document.createElement('audio');
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.volume = 1.0;

    audioElement.addEventListener('loadeddata', () => {
      this.logger.debug('Remote audio ready for playback', { streamId: stream.id });
    });

    audioElement.addEventListener('error', (error) => {
      this.logger.error('Audio playback error', { streamId: stream.id, error });
    });
  }

  private clearRemoteStreams(): void {
    for (const [streamId, stream] of this.remoteStreams) {
      stream.getTracks().forEach(track => track.stop());
      this.logger.debug('Remote stream cleared', { streamId });
    }
    this.remoteStreams.clear();
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('AudioTrackManager not initialized. Call initialize() first.');
    }
  }

  private stopStreamForTrack(trackId: string): void {
    const stream = this.trackStreams.get(trackId);
    if (!stream) {
      return;
    }

    stream.getTracks().forEach(track => track.stop());
    this.trackStreams.delete(trackId);
  }

  private getPrimaryTrackId(): string | undefined {
    const iterator = this.localTracks.keys();
    const result = iterator.next();
    return result.done ? undefined : result.value;
  }

  private tryGetConnectionStatistics(): ConnectionStatistics | undefined {
    try {
      return this.qualityMonitorTransport?.getConnectionStatistics();
    } catch (error: any) {
      this.logger.warn('Unable to retrieve connection statistics', { error: error?.message });
      return undefined;
    }
  }

  private estimateAudioLevel(quality: ConnectionQuality): number {
    switch (quality) {
      case ConnectionQuality.Excellent:
        return 0.9;
      case ConnectionQuality.Good:
        return 0.75;
      case ConnectionQuality.Fair:
        return 0.55;
      case ConnectionQuality.Poor:
        return 0.35;
      case ConnectionQuality.Failed:
      default:
        return 0.1;
    }
  }
}

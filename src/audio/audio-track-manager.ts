import { Logger } from '../core/logger';
import { ServiceInitializable } from '../core/service-initializable';
import { ConnectionQuality, WebRTCErrorCode, WebRTCErrorImpl, WebRTCTransport } from '../types/webrtc';

/**
 * Manages audio tracks for WebRTC communication
 * Handles microphone capture, track management, and audio quality optimization
 */
export class AudioTrackManager implements ServiceInitializable {
  private initialized = false;
  private logger: Logger;

  // Audio stream management
  private localStream: MediaStream | null = null;
  private localTracks = new Map<string, MediaStreamTrack>();
  private remoteStreams = new Map<string, MediaStream>();

  // Audio configuration
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

    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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

    // Stop all local tracks
    this.stopAllLocalTracks();

    // Clear remote streams
    this.clearRemoteStreams();

    this.initialized = false;
    this.logger.info('AudioTrackManager disposed');
  }

  /**
   * Capture microphone audio with optimal settings for WebRTC
   */
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
        throw new Error('Failed to obtain audio track from microphone');
      }

      // Store the stream and track
      this.localStream = stream;
      this.localTracks.set(audioTrack.id, audioTrack);

      // Set up track event handlers
      this.setupTrackEventHandlers(audioTrack);

      this.logger.info('Microphone captured successfully', {
        trackId: audioTrack.id,
        label: audioTrack.label,
        settings: audioTrack.getSettings()
      });

      return audioTrack;

    } catch (error: any) {
      this.logger.error('Failed to capture microphone', { error: error.message });

      if (error.name === 'NotAllowedError') {
        throw new WebRTCErrorImpl({
          code: WebRTCErrorCode.AudioTrackFailed,
          message: 'Microphone access denied by user',
          details: error,
          recoverable: false,
          timestamp: new Date()
        });
      }

      if (error.name === 'NotFoundError') {
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
        message: `Failed to capture microphone: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date()
      });
    }
  }

  /**
   * Add audio track to WebRTC transport
   */
  async addTrackToTransport(transport: WebRTCTransport, track: MediaStreamTrack): Promise<void> {
    try {
      await transport.addAudioTrack(track);
      this.logger.debug('Audio track added to transport', { trackId: track.id });
    } catch (error: any) {
      this.logger.error('Failed to add track to transport', { error: error.message });
      throw error;
    }
  }

  /**
   * Remove audio track from WebRTC transport
   */
  async removeTrackFromTransport(transport: WebRTCTransport, track: MediaStreamTrack): Promise<void> {
    try {
      await transport.removeAudioTrack(track);
      this.localTracks.delete(track.id);
      this.logger.debug('Audio track removed from transport', { trackId: track.id });
    } catch (error: any) {
      this.logger.error('Failed to remove track from transport', { error: error.message });
      throw error;
    }
  }

  /**
   * Handle remote audio stream for playback
   */
  handleRemoteStream(stream: MediaStream, streamId?: string): void {
    const id = streamId || stream.id;
    this.remoteStreams.set(id, stream);

    this.logger.debug('Remote stream registered', {
      streamId: id,
      trackCount: stream.getTracks().length
    });

    // Set up audio playback
    this.setupAudioPlayback(stream);
  }

  /**
   * Get all local audio tracks
   */
  getLocalTracks(): MediaStreamTrack[] {
    return Array.from(this.localTracks.values());
  }

  /**
   * Get all remote streams
   */
  getRemoteStreams(): MediaStream[] {
    return Array.from(this.remoteStreams.values());
  }

  /**
   * Stop specific audio track
   */
  stopTrack(trackId: string): void {
    const track = this.localTracks.get(trackId);
    if (track) {
      track.stop();
      this.localTracks.delete(trackId);
      this.logger.debug('Audio track stopped', { trackId });
    }
  }

  /**
   * Stop all local audio tracks
   */
  stopAllLocalTracks(): void {
    for (const [trackId, track] of this.localTracks) {
      track.stop();
      this.logger.debug('Local track stopped', { trackId });
    }
    this.localTracks.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    this.logger.info('All local tracks stopped');
  }

  /**
   * Mute/unmute local audio track
   */
  setTrackMuted(trackId: string, muted: boolean): void {
    const track = this.localTracks.get(trackId);
    if (track) {
      track.enabled = !muted;
      this.logger.debug('Track mute state changed', { trackId, muted });
    }
  }

  /**
   * Get audio track statistics
   */
  getTrackStatistics(track: MediaStreamTrack): any {
    const settings = track.getSettings();
    const capabilities = track.getCapabilities();

    return {
      id: track.id,
      kind: track.kind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
      settings,
      capabilities
    };
  }

  /**
   * Adjust audio quality based on connection conditions
   */
  adjustAudioQuality(quality: ConnectionQuality): void {
    // Adjust audio constraints based on connection quality
    switch (quality) {
      case ConnectionQuality.Excellent:
        this.audioConstraints = {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
        break;

      case ConnectionQuality.Good:
        this.audioConstraints = {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
        break;

      case ConnectionQuality.Fair:
      case ConnectionQuality.Poor:
        this.audioConstraints = {
          sampleRate: 8000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        };
        break;

      case ConnectionQuality.Failed:
        // Don't adjust - connection failed
        break;
    }

    this.logger.debug('Audio quality adjusted', { quality, constraints: this.audioConstraints });
  }

  /**
   * Get available audio input devices
   */
  async getAudioInputDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'audioinput');
    } catch (error: any) {
      this.logger.error('Failed to enumerate audio devices', { error: error.message });
      return [];
    }
  }

  /**
   * Switch to specific audio input device
   */
  async switchAudioDevice(deviceId: string): Promise<MediaStreamTrack> {
    this.ensureInitialized();

    try {
      // Stop current tracks
      this.stopAllLocalTracks();

      // Capture with specific device
      const constraints = {
        ...this.audioConstraints,
        deviceId: { exact: deviceId }
      };

      return await this.captureMicrophone(constraints);

    } catch (error: any) {
      this.logger.error('Failed to switch audio device', { deviceId, error: error.message });
      throw error;
    }
  }

  // Private implementation methods
  private setupTrackEventHandlers(track: MediaStreamTrack): void {
    track.addEventListener('ended', () => {
      this.logger.warn('Audio track ended unexpectedly', { trackId: track.id });
      this.localTracks.delete(track.id);
    });

    track.addEventListener('mute', () => {
      this.logger.debug('Audio track muted', { trackId: track.id });
    });

    track.addEventListener('unmute', () => {
      this.logger.debug('Audio track unmuted', { trackId: track.id });
    });
  }

  private setupAudioPlayback(stream: MediaStream): void {
    // Create audio element for playback
    const audioElement = document.createElement('audio');
    audioElement.srcObject = stream;
    audioElement.autoplay = true;
    audioElement.muted = false;
    audioElement.volume = 1.0;

    // Handle playback events
    audioElement.addEventListener('loadeddata', () => {
      this.logger.debug('Remote audio ready for playback', { streamId: stream.id });
    });

    audioElement.addEventListener('error', (error) => {
      this.logger.error('Audio playback error', { streamId: stream.id, error });
    });

    // Note: In a real implementation, you might want to add the audio element to the DOM
    // or manage it differently based on your UI requirements
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
}

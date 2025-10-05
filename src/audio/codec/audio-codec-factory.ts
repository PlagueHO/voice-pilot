import { Logger } from "../../core/logger";
import type {
    AudioCodecProfile,
    AudioCodecProfileId,
} from "./audio-codec-profile";

const PCM16_24K_MONO_PROFILE: AudioCodecProfile = Object.freeze({
  id: "pcm16-24k-mono" as const,
  sampleRate: 24000,
  channels: 1,
  bitDepth: 16,
  frameDurationMs: 20,
  maxPacketBytes: 960,
  supportsDtx: false,
  supportsComfortNoise: false,
  defaultJitterBufferMs: 80,
});

const PCM16_16K_MONO_PROFILE: AudioCodecProfile = Object.freeze({
  id: "pcm16-16k-mono" as const,
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  frameDurationMs: 20,
  maxPacketBytes: 640,
  supportsDtx: false,
  supportsComfortNoise: false,
  defaultJitterBufferMs: 80,
});

const OPUS_48K_FALLBACK_PROFILE: AudioCodecProfile = Object.freeze({
  id: "opus-48k-fallback" as const,
  sampleRate: 48000,
  channels: 1,
  bitDepth: 16,
  frameDurationMs: 20,
  maxPacketBytes: 960,
  supportsDtx: true,
  supportsComfortNoise: true,
  defaultJitterBufferMs: 100,
});

const PROFILE_MAP: ReadonlyMap<AudioCodecProfileId, AudioCodecProfile> =
  new Map([
    [PCM16_24K_MONO_PROFILE.id, PCM16_24K_MONO_PROFILE],
    [PCM16_16K_MONO_PROFILE.id, PCM16_16K_MONO_PROFILE],
    [OPUS_48K_FALLBACK_PROFILE.id, OPUS_48K_FALLBACK_PROFILE],
  ]);

const VALID_FRAME_DURATIONS = new Set([10, 20, 40]);
const MAX_PACKET_BYTES_LIMIT = 960;

export class AudioCodecFactory {
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? new Logger("AudioCodecFactory");
  }

  listProfiles(): ReadonlyArray<AudioCodecProfile> {
    return Array.from(PROFILE_MAP.values());
  }

  getProfile(id: AudioCodecProfileId): AudioCodecProfile {
    const profile = PROFILE_MAP.get(id);
    if (!profile) {
      throw new Error(`Unknown audio codec profile: ${id}`);
    }

    this.validateProfile(profile);
    return profile;
  }

  getPrimaryProfile(): AudioCodecProfile {
    return this.getProfile("pcm16-24k-mono");
  }

  getFallbackProfiles(): ReadonlyArray<AudioCodecProfile> {
    return [
      this.getProfile("pcm16-16k-mono"),
      this.getProfile("opus-48k-fallback"),
    ];
  }

  validateProfile(profile: AudioCodecProfile): void {
    if (!VALID_FRAME_DURATIONS.has(profile.frameDurationMs)) {
      throw new Error(
        `Codec profile ${profile.id} uses unsupported frame duration (${profile.frameDurationMs} ms). Allowed durations: ${Array.from(VALID_FRAME_DURATIONS).join(", ")}.`,
      );
    }

    if (profile.maxPacketBytes > MAX_PACKET_BYTES_LIMIT) {
      throw new Error(
        `Codec profile ${profile.id} exceeds packet size limit (${profile.maxPacketBytes} > ${MAX_PACKET_BYTES_LIMIT}).`,
      );
    }

    if (profile.id.startsWith("pcm16") && profile.supportsDtx) {
      throw new Error(
        `PCM16 profile ${profile.id} must not enable discontinuous transmission (DTX).`,
      );
    }
  }
}

export const sharedAudioCodecFactory = new AudioCodecFactory();

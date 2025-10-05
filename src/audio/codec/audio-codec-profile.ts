import type {
    AudioCodecProfileId,
    ConnectionStatistics,
} from "../../types/webrtc";

export interface AudioCodecProfile {
  readonly id: AudioCodecProfileId;
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
  preferredProfile: AudioCodecProfileId;
  fallbackProfiles: ReadonlyArray<AudioCodecProfileId>;
  transportHint: "webrtc" | "websocket";
  enableDtx: boolean;
  enableComfortNoise: boolean;
}

export interface CodecNegotiationResult {
  agreedProfile: AudioCodecProfile;
  negotiationTimeMs: number;
  requiresResample: boolean;
  appliedResampleMethod?: "webaudio-worklet" | "native";
  warnings?: ReadonlyArray<string>;
}

export interface AudioFormatDescriptor {
  mediaType: "audio/pcm";
  sampleRate: number;
  channelCount: number;
  sampleSizeBits: number;
  littleEndian: boolean;
  blockAlign: number;
  bytesPerSecond: number;
}

export interface CodecTelemetrySnapshot {
  timestamp: number;
  statistics: ConnectionStatistics;
}

export type { AudioCodecProfileId } from "../../types/webrtc";

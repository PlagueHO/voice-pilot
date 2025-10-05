import { Logger } from "../../core/logger";
import type { ConnectionStatistics } from "../../types/webrtc";
import {
    AudioCodecFactory,
    sharedAudioCodecFactory,
} from "./audio-codec-factory";
import type {
    AudioCodecProfile,
    AudioCodecProfileId,
    CodecNegotiationRequest,
    CodecNegotiationResult,
    CodecTelemetrySnapshot,
} from "./audio-codec-profile";

interface CodecStrategyOptions {
  readonly packetLossThresholdPct: number;
  readonly consecutiveThresholdBreaches: number;
}

export class CodecStrategyRegistry {
  private readonly factory: AudioCodecFactory;
  private readonly logger: Logger;
  private readonly options: CodecStrategyOptions;

  private activeProfileId: AudioCodecProfileId;
  private lastNegotiatedProfileId: AudioCodecProfileId;
  private pendingFallbackProfileId: AudioCodecProfileId | null = null;
  private consecutiveLossBreaches = 0;
  private lastTelemetryTimestamp = 0;

  constructor(
    factory: AudioCodecFactory = sharedAudioCodecFactory,
    logger?: Logger,
    options: Partial<CodecStrategyOptions> = {},
  ) {
    this.factory = factory;
    this.logger = logger ?? new Logger("CodecStrategyRegistry");
    this.options = {
      packetLossThresholdPct: options.packetLossThresholdPct ?? 3,
      consecutiveThresholdBreaches:
        options.consecutiveThresholdBreaches ?? 2,
    };
    this.activeProfileId = this.factory.getPrimaryProfile().id;
    this.lastNegotiatedProfileId = this.activeProfileId;
  }

  createNegotiationRequest(
    transportHint: "webrtc" | "websocket",
  ): CodecNegotiationRequest {
    const fallbackProfiles = this.factory
      .getFallbackProfiles()
      .map((profile) => profile.id);

    return {
      preferredProfile: this.activeProfileId,
      fallbackProfiles,
      transportHint,
      enableDtx: this.activeProfileId === "opus-48k-fallback",
      enableComfortNoise: this.activeProfileId === "opus-48k-fallback",
    };
  }

  selectProfile(profileId?: AudioCodecProfileId): AudioCodecProfile {
    const id = profileId ?? this.activeProfileId;
    const profile = this.factory.getProfile(id);
    this.activeProfileId = profile.id;
    return profile;
  }

  acknowledgeNegotiation(
    profile: AudioCodecProfile,
    negotiationTimeMs: number,
    requiresResample: boolean,
    resampleMethod?: "webaudio-worklet" | "native",
    warnings: ReadonlyArray<string> = [],
  ): CodecNegotiationResult {
    this.lastNegotiatedProfileId = profile.id;
    if (profile.id !== this.activeProfileId) {
      this.logger.info("Active codec profile updated post-negotiation", {
        previousProfile: this.activeProfileId,
        newProfile: profile.id,
      });
      this.activeProfileId = profile.id;
    }
    this.pendingFallbackProfileId = null;
    this.consecutiveLossBreaches = 0;

    return {
      agreedProfile: profile,
      negotiationTimeMs,
      requiresResample,
      appliedResampleMethod: resampleMethod,
      warnings,
    };
  }

  registerTelemetry(snapshot: CodecTelemetrySnapshot): void {
    const { statistics, timestamp } = snapshot;
    this.lastTelemetryTimestamp = timestamp;
    const packetLossPct = this.calculatePacketLoss(statistics);

    if (packetLossPct >= this.options.packetLossThresholdPct) {
      this.consecutiveLossBreaches += 1;
      this.logger.debug("Codec telemetry breach detected", {
        packetLossPct,
        threshold: this.options.packetLossThresholdPct,
        consecutive: this.consecutiveLossBreaches,
      });

      if (
        this.consecutiveLossBreaches >=
        this.options.consecutiveThresholdBreaches
      ) {
        this.queueFallbackProfile();
      }
    } else {
      this.consecutiveLossBreaches = 0;
    }
  }

  shouldFallback(): boolean {
    return this.pendingFallbackProfileId !== null;
  }

  consumeFallbackProfile(): AudioCodecProfile | null {
    if (!this.pendingFallbackProfileId) {
      return null;
    }

    const profile = this.factory.getProfile(this.pendingFallbackProfileId);
    this.activeProfileId = profile.id;
    this.pendingFallbackProfileId = null;
    this.consecutiveLossBreaches = 0;
    return profile;
  }

  requiresResample(
    profile: AudioCodecProfile,
    contextSampleRate?: number,
  ): boolean {
    if (!contextSampleRate) {
      return true;
    }

    return Math.abs(contextSampleRate - profile.sampleRate) > 0.5;
  }

  getLastNegotiatedProfileId(): AudioCodecProfileId {
    return this.lastNegotiatedProfileId;
  }

  getActiveProfile(): AudioCodecProfile {
    return this.factory.getProfile(this.activeProfileId);
  }

  getLastTelemetryTimestamp(): number {
    return this.lastTelemetryTimestamp;
  }

  private calculatePacketLoss(stats: ConnectionStatistics): number {
    const packetsSent = stats.audioPacketsSent ?? 0;
    const packetsReceived = stats.audioPacketsReceived ?? 0;
    const packetsLost = stats.packetsLost ?? 0;
    const totalConsidered = packetsSent + packetsReceived + packetsLost;

    if (totalConsidered === 0) {
      return 0;
    }

    return (packetsLost / totalConsidered) * 100;
  }

  private queueFallbackProfile(): void {
    const fallbackProfiles = this.factory.getFallbackProfiles();
    const currentlyActiveId = this.activeProfileId;

    const nextProfile = fallbackProfiles.find(
      (profile) => profile.id !== currentlyActiveId,
    );

    if (!nextProfile) {
      this.logger.debug("All fallback codec profiles exhausted");
      return;
    }

    if (this.pendingFallbackProfileId === nextProfile.id) {
      return;
    }

    this.pendingFallbackProfileId = nextProfile.id;
    this.logger.warn("Codec fallback requested", {
      fromProfile: currentlyActiveId,
      fallbackProfile: nextProfile.id,
    });
  }
}

export const sharedCodecStrategyRegistry = new CodecStrategyRegistry();

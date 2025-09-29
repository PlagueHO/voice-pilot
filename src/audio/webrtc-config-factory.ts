import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import { Logger } from "../core/logger";
import type { AudioConfig, AzureRealtimeConfig } from "../types/configuration";
import { EphemeralKeyInfo, RealtimeSessionInfo } from "../types/ephemeral";
import {
  AudioConfiguration,
  ConnectionConfiguration,
  DataChannelConfiguration,
  EphemeralAuthentication,
  WebRTCConfig,
  WebRTCEndpoint,
  WebRTCErrorCode,
  WebRTCErrorImpl,
  WebRTCSessionConfiguration,
  validateAudioConfiguration,
} from "../types/webrtc";

/**
 * Factory for creating WebRTC configuration objects
 * Handles Azure endpoint mapping, audio configuration, and connection settings
 */
export class WebRTCConfigFactory {
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger("WebRTCConfigFactory");
  }

  /**
   * Create a WebRTC configuration from extension services
   */
  async createConfig(
    configManager: ConfigurationManager,
    ephemeralKeyService: EphemeralKeyServiceImpl,
  ): Promise<WebRTCConfig> {
    try {
      const azureConfig = configManager.getAzureOpenAIConfig();
      const realtimePreferences = configManager.getAzureRealtimeConfig();
      const audioPreferences = configManager.getAudioConfig();

      const realtimeSession = await ephemeralKeyService.createRealtimeSession();
      this.assertSessionExpiryWindow(realtimeSession);

      const endpoint = this.createEndpoint(
        azureConfig.region,
        azureConfig.deploymentName,
      );

      const authentication = this.createAuthentication(realtimeSession);
      const audioConfig = this.createAudioConfiguration(audioPreferences);
      this.ensureAudioConfiguration(audioConfig);

      const sessionConfig = this.createSessionConfiguration(
        audioPreferences,
        realtimePreferences,
      );

      const dataChannelConfig = this.createDataChannelConfiguration();
      const connectionConfig = this.createConnectionConfiguration();

      const config: WebRTCConfig = {
        endpoint,
        authentication,
        audioConfig,
        sessionConfig,
        dataChannelConfig,
        connectionConfig,
      };

      this.logger.debug("WebRTC configuration created", {
        endpoint: endpoint.url,
        region: endpoint.region,
        deployment: endpoint.deployment,
        audioSampleRate: audioConfig.sampleRate,
        workletModules: audioConfig.workletModuleUrls.length,
      });

      return config;
    } catch (error: any) {
      if (error instanceof WebRTCErrorImpl) {
        throw error;
      }
      this.logger.error("Failed to create WebRTC configuration", {
        error: error.message,
      });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.ConfigurationInvalid,
        message: `Configuration creation failed: ${error.message}`,
        details: error,
        recoverable: false,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Create WebRTC endpoint configuration from Azure region and deployment
   */
  private createEndpoint(
    region: string,
    deploymentName: string,
  ): WebRTCEndpoint {
    // Map Azure regions to supported WebRTC regions
    const regionMapping: Record<string, "eastus2" | "swedencentral"> = {
      eastus2: "eastus2",
      swedencentral: "swedencentral",
      // Add fallback mappings
      eastus: "eastus2",
      westeurope: "swedencentral",
      northeurope: "swedencentral",
    };

    const webrtcRegion = regionMapping[region.toLowerCase()];
    if (!webrtcRegion) {
      throw new Error(
        `Unsupported region for WebRTC: ${region}. Supported regions: eastus2, swedencentral`,
      );
    }

    const url = `https://${webrtcRegion}.realtimeapi-preview.ai.azure.com/v1/realtimertc`;

    return {
      region: webrtcRegion,
      url,
      deployment: deploymentName,
    };
  }

  /**
   * Create ephemeral authentication configuration
   */
  /**
   * Builds the authentication payload used by the transport layer from a newly
   * minted realtime session.
   *
   * @param realtimeSession - Ephemeral session details issued by Azure OpenAI.
   * @returns Ephemeral authentication bundle including metadata for telemetry.
   */
  private createAuthentication(
    realtimeSession: RealtimeSessionInfo,
  ): EphemeralAuthentication {
    const keyInfo: EphemeralKeyInfo = {
      key: realtimeSession.ephemeralKey,
      sessionId: realtimeSession.sessionId,
      issuedAt: new Date(),
      expiresAt: realtimeSession.expiresAt,
      isValid: true,
      secondsRemaining: Math.floor(
        (realtimeSession.expiresAt.getTime() - Date.now()) / 1000,
      ),
    };

    return {
      ephemeralKey: realtimeSession.ephemeralKey,
      expiresAt: realtimeSession.expiresAt,
      keyInfo,
    };
  }

  /**
   * Create audio configuration optimized for voice interaction
   */
  private createAudioConfiguration(
    audioPreferences: AudioConfig,
  ): AudioConfiguration {
    if (audioPreferences.sampleRate !== 24000) {
      this.logger.warn("Audio sample rate adjusted to 24 kHz for transport compliance", {
        requestedSampleRate: audioPreferences.sampleRate,
      });
    }

    const sharedContext = audioPreferences.sharedContext ?? {
      autoResume: true,
      requireGesture: true,
      latencyHint: "interactive" as AudioContextLatencyCategory,
    };

    const workletModuleUrls = Object.freeze(
      Array.from(new Set(audioPreferences.workletModules ?? [])),
    ) as ReadonlyArray<string>;

    return {
      sampleRate: 24000,
      format: "pcm16",
      channels: 1,
      echoCancellation: audioPreferences.echoCancellation,
      noiseSuppression: audioPreferences.noiseReduction,
      autoGainControl: true,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: (sharedContext.latencyHint ?? "interactive") as
          | AudioContextLatencyCategory
          | number,
        resumeOnActivation: sharedContext.autoResume,
        requiresUserGesture: sharedContext.requireGesture,
      },
      workletModuleUrls,
    };
  }

  /**
   * Validates audio configuration values and raises structured errors when the
   * transport would reject the provided parameters.
   *
   * @param audioConfig - Candidate audio configuration to verify.
   * @throws {@link WebRTCErrorImpl} when validation yields one or more issues.
   */
  private ensureAudioConfiguration(audioConfig: AudioConfiguration): void {
    const errors = validateAudioConfiguration(audioConfig);
    if (errors.length > 0) {
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.ConfigurationInvalid,
        message: `Invalid audio configuration: ${errors.join("; ")}`,
        details: { errors },
        recoverable: false,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Composes the realtime session configuration encompassing locale, voice, and
   * turn-detection preferences.
   *
   * @param audioPreferences - User-defined audio preferences.
   * @param realtimePreferences - Azure realtime configuration values.
   * @returns Session configuration ready for WebRTC negotiation.
   */
  private createSessionConfiguration(
    audioPreferences: AudioConfig,
    realtimePreferences: AzureRealtimeConfig,
  ): WebRTCSessionConfiguration {
    const turnDetection = audioPreferences.turnDetection;
    const turnDetectionConfig =
      turnDetection.type === "none"
        ? undefined
        : {
            type: turnDetection.type,
            threshold: turnDetection.threshold,
            prefixPaddingMs: turnDetection.prefixPaddingMs,
            silenceDurationMs: turnDetection.silenceDurationMs,
            createResponse: turnDetection.createResponse,
            interruptResponse: turnDetection.interruptResponse,
            eagerness: turnDetection.eagerness,
          };

    return {
      voice: audioPreferences.tts.voice.name,
      locale: realtimePreferences.locale,
      inputAudioFormat: realtimePreferences.inputAudioFormat,
      outputAudioFormat: realtimePreferences.inputAudioFormat,
      transcriptionModel: realtimePreferences.transcriptionModel,
      turnDetection: turnDetectionConfig,
    };
  }

  /**
   * Guards against ephemeral sessions that are close to expiring to avoid
   * mid-negotiation authentication failures.
   *
   * @param realtimeSession - Session metadata returned by Azure OpenAI.
   * @throws {@link WebRTCErrorImpl} when the remaining lifetime is insufficient.
   */
  private assertSessionExpiryWindow(
    realtimeSession: RealtimeSessionInfo,
  ): void {
    const millisecondsRemaining =
      realtimeSession.expiresAt.getTime() - Date.now();
    const MINIMUM_SAFE_WINDOW_MS = 20000;

    if (millisecondsRemaining <= MINIMUM_SAFE_WINDOW_MS) {
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AuthenticationFailed,
        message: `Ephemeral session ${realtimeSession.sessionId} expires too soon (${Math.max(millisecondsRemaining, 0)}ms remaining).`,
        details: {
          sessionId: realtimeSession.sessionId,
          expiresAt: realtimeSession.expiresAt,
          millisRemaining: millisecondsRemaining,
        },
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Create data channel configuration for real-time events
   */
  private createDataChannelConfiguration(): DataChannelConfiguration {
    return {
      channelName: "realtime-channel",
      ordered: true, // Ensure reliable event delivery
      maxRetransmits: 3,
    };
  }

  /**
   * Create connection configuration with retry logic
   */
  private createConnectionConfiguration(): ConnectionConfiguration {
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      reconnectAttempts: 3,
      reconnectDelayMs: 1000,
      connectionTimeoutMs: 5000,
    };
  }

  /**
   * Update configuration with new ephemeral key
   */
  /**
   * Refreshes the authentication portion of a configuration using a newly
   * issued ephemeral key.
   *
   * @param config - Existing WebRTC configuration to update.
   * @param ephemeralKeyService - Service capable of minting realtime sessions.
   * @returns Updated configuration containing the new authentication payload.
   * @throws {@link WebRTCErrorImpl} when the key renewal flow fails.
   */
  async updateConfigWithNewKey(
    config: WebRTCConfig,
    ephemeralKeyService: EphemeralKeyServiceImpl,
  ): Promise<WebRTCConfig> {
    try {
      const realtimeSession = await ephemeralKeyService.createRealtimeSession();
      const newAuthentication = this.createAuthentication(realtimeSession);

      return {
        ...config,
        authentication: newAuthentication,
      };
    } catch (error: any) {
      this.logger.error("Failed to update configuration with new key", {
        error: error.message,
      });
      throw new WebRTCErrorImpl({
        code: WebRTCErrorCode.AuthenticationFailed,
        message: `Key update failed: ${error.message}`,
        details: error,
        recoverable: true,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Validate WebRTC configuration
   */
  /**
   * Performs a best-effort validation of a WebRTC configuration object and
   * surfaces diagnostic logging for failures.
   *
   * @param config - Configuration to validate.
   * @returns True when validation succeeds; false otherwise (after logging).
   */
  validateConfig(config: WebRTCConfig): boolean {
    try {
      // Validate endpoint
      if (
        !config.endpoint ||
        !config.endpoint.url ||
        !config.endpoint.region ||
        !config.endpoint.deployment
      ) {
        throw new Error("Invalid endpoint configuration");
      }

      // Validate authentication
      if (
        !config.authentication ||
        !config.authentication.ephemeralKey ||
        !config.authentication.expiresAt
      ) {
        throw new Error("Invalid authentication configuration");
      }

      // Check if key is not expired
      if (new Date() >= config.authentication.expiresAt) {
        throw new Error("Ephemeral key has expired");
      }

      // Validate audio configuration
      if (!config.audioConfig) {
        throw new Error("Invalid audio configuration");
      }

      if (!config.sessionConfig) {
        throw new Error("Invalid realtime session configuration");
      }

      const audioConfigErrors = validateAudioConfiguration(config.audioConfig);
      if (audioConfigErrors.length > 0) {
        throw new Error(
          `Invalid audio configuration: ${audioConfigErrors.join("; ")}`,
        );
      }

      // Validate supported region
      const supportedRegions = ["eastus2", "swedencentral"];
      if (!supportedRegions.includes(config.endpoint.region)) {
        throw new Error(`Unsupported region: ${config.endpoint.region}`);
      }

      this.logger.debug("WebRTC configuration validated successfully");
      return true;
    } catch (error: any) {
      this.logger.error("WebRTC configuration validation failed", {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Create default configuration for testing purposes
   */
  /**
   * Generates a deterministic configuration suitable for testing scenarios.
   *
   * @returns Self-contained WebRTC configuration with mock authentication.
   */
  createTestConfig(): WebRTCConfig {
    const testAuthentication: EphemeralAuthentication = {
      ephemeralKey: "test-ephemeral-key",
      expiresAt: new Date(Date.now() + 300000), // 5 minutes
      keyInfo: {
        key: "test-ephemeral-key",
        sessionId: "test-session-id",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 300000),
        isValid: true,
        secondsRemaining: 300,
      },
    };

    const audioPreferences: AudioConfig = {
      inputDevice: "default",
      outputDevice: "default",
      noiseReduction: true,
      echoCancellation: true,
      sampleRate: 24000,
      sharedContext: {
        autoResume: true,
        requireGesture: true,
        latencyHint: "interactive",
      },
      workletModules: [],
      turnDetection: {
        type: "server_vad",
        threshold: 0.5,
        prefixPaddingMs: 300,
        silenceDurationMs: 200,
        createResponse: true,
        interruptResponse: true,
        eagerness: "auto",
      },
      tts: {
        transport: "webrtc",
        apiVersion: "2025-04-01-preview",
        fallbackMode: "retry",
        maxInitialLatencyMs: 300,
        voice: {
          name: "alloy",
          locale: "en-US",
          style: "conversational",
          gender: "unspecified",
        },
      },
    };

    const realtimePreferences: AzureRealtimeConfig = {
      model: "gpt-realtime",
      apiVersion: "2025-08-28",
      transcriptionModel: "whisper-1",
      inputAudioFormat: "pcm16",
      locale: "en-US",
      profanityFilter: "medium",
      interimDebounceMs: 250,
      maxTranscriptHistorySeconds: 120,
    };

    const audioConfig = this.createAudioConfiguration(audioPreferences);
    this.ensureAudioConfiguration(audioConfig);

    return {
      endpoint: {
        region: "eastus2",
        url: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
        deployment: "gpt-4o-realtime-preview",
      },
      authentication: testAuthentication,
      audioConfig,
      sessionConfig: this.createSessionConfiguration(
        audioPreferences,
        realtimePreferences,
      ),
      dataChannelConfig: this.createDataChannelConfiguration(),
      connectionConfig: this.createConnectionConfiguration(),
    };
  }
}

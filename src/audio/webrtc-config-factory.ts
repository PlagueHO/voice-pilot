import { EphemeralKeyServiceImpl } from "../auth/ephemeral-key-service";
import { ConfigurationManager } from "../config/configuration-manager";
import { Logger } from "../core/logger";
import { EphemeralKeyInfo } from "../types/ephemeral";
import {
    AudioConfiguration,
    ConnectionConfiguration,
    DataChannelConfiguration,
    EphemeralAuthentication,
    validateAudioConfiguration,
    WebRTCConfig,
    WebRTCEndpoint,
    WebRTCErrorCode,
    WebRTCErrorImpl,
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
      // Get Azure OpenAI configuration
      const azureConfig = configManager.getAzureOpenAIConfig();

      // Create realtime session and get ephemeral key
      const realtimeSession = await ephemeralKeyService.createRealtimeSession();

      // Map Azure region to WebRTC endpoint
      const endpoint = this.createEndpoint(
        azureConfig.region,
        azureConfig.deploymentName,
      );

      // Create ephemeral authentication
      const authentication = this.createAuthentication(realtimeSession);

      // Create audio configuration
      const audioConfig = this.createAudioConfiguration();

      // Create data channel configuration
      const dataChannelConfig = this.createDataChannelConfiguration();

      // Create connection configuration
      const connectionConfig = this.createConnectionConfiguration();

      const config: WebRTCConfig = {
        endpoint,
        authentication,
        audioConfig,
        dataChannelConfig,
        connectionConfig,
      };

      this.logger.debug("WebRTC configuration created", {
        endpoint: endpoint.url,
        region: endpoint.region,
        deployment: endpoint.deployment,
      });

      return config;
    } catch (error: any) {
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
  private createAuthentication(realtimeSession: any): EphemeralAuthentication {
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
  private createAudioConfiguration(): AudioConfiguration {
    return {
      sampleRate: 24000,
      format: "pcm16",
      channels: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      audioContextProvider: {
        strategy: "shared",
        latencyHint: "interactive",
        resumeOnActivation: true,
        requiresUserGesture: true,
      },
      workletModuleUrls: [] as ReadonlyArray<string>,
    };
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

    return {
      endpoint: {
        region: "eastus2",
        url: "https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc",
        deployment: "gpt-4o-realtime-preview",
      },
      authentication: testAuthentication,
      audioConfig: this.createAudioConfiguration(),
      dataChannelConfig: this.createDataChannelConfiguration(),
      connectionConfig: this.createConnectionConfiguration(),
    };
  }
}

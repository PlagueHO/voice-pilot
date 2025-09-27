import { EphemeralKeyInfo } from "./ephemeral";
import {
  ConnectionQuality,
  WebRTCConnectionState,
  WebRTCError,
} from "./webrtc";

/**
 * Service integration interfaces for WebRTC transport layer
 * Defines how WebRTC transport integrates with existing extension services
 */

// Integration with EphemeralKeyService (SP-004)
export interface EphemeralKeyIntegration {
  keyService: EphemeralKeyService;
  onKeyRenewal: (newKey: EphemeralKeyInfo) => Promise<void>;
  onKeyExpiration: () => Promise<void>;
  onAuthenticationError: (error: WebRTCError) => Promise<void>;
}

// Integration with SessionManager (SP-005)
export interface SessionIntegration {
  sessionManager: SessionManager;
  onSessionStateChanged: (state: WebRTCConnectionState) => Promise<void>;
  onConnectionRecovery: () => Promise<void>;
  onConnectionFailure: (error: WebRTCError) => Promise<void>;
}

// Integration with Audio Pipeline (SP-007 future dependency)
export interface AudioPipelineIntegration {
  onAudioInputRequired: () => Promise<MediaStreamTrack>;
  onAudioOutputReceived: (stream: MediaStream) => Promise<void>;
  onAudioQualityChanged: (quality: ConnectionQuality) => Promise<void>;
}

// Service interfaces (simplified for integration purposes)
export interface EphemeralKeyService {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  requestEphemeralKey(): Promise<any>;
  getCurrentKey(): EphemeralKeyInfo | undefined;
  renewKey(): Promise<any>;
  revokeCurrentKey(): Promise<void>;
  isKeyValid(): boolean;
  onKeyRenewed(handler: (result: any) => Promise<void>): {
    dispose: () => void;
  };
  onKeyExpired(handler: (info: EphemeralKeyInfo) => Promise<void>): {
    dispose: () => void;
  };
  onAuthenticationError(handler: (error: any) => Promise<void>): {
    dispose: () => void;
  };
}

export interface SessionManager {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  getSessionState(): string;
  onSessionStateChanged(handler: (state: string) => Promise<void>): {
    dispose: () => void;
  };
}

export interface ConfigurationManager {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  getAzureOpenAIConfig(): any;
  onConfigurationChanged(handler: () => Promise<void>): { dispose: () => void };
}

export interface Logger {
  info(message: string, data?: any): void;
  error(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  debug(message: string, data?: any): void;
}

// Service coordination interfaces
export interface ServiceCoordinator {
  ephemeralKeyService: EphemeralKeyService;
  sessionManager: SessionManager;
  configurationManager: ConfigurationManager;
  logger: Logger;
}

export interface WebRTCServiceDependencies {
  ephemeralKeyService: EphemeralKeyService;
  sessionManager?: SessionManager;
  configurationManager?: ConfigurationManager;
  logger?: Logger;
}

// Event coordination interfaces
export interface ServiceEventCoordinator {
  onServiceError(service: string, error: Error): Promise<void>;
  onServiceStateChanged(service: string, state: string): Promise<void>;
  onServiceRecovery(service: string): Promise<void>;
}

// Lifecycle coordination interfaces
export interface ServiceLifecycleCoordinator {
  initializeServices(): Promise<void>;
  disposeServices(): void;
  restartService(serviceName: string): Promise<void>;
  getServiceHealth(): Map<string, boolean>;
}

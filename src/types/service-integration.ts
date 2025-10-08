import type { AudioCodecProfile } from "../audio/codec";
import { EphemeralKeyInfo } from "./ephemeral";
import {
  ConnectionQuality,
  WebRTCConnectionState,
  WebRTCError,
} from "./webrtc";

/**
 * Integration contract for bridging the WebRTC transport layer with the
 * ephemeral key management service.
 */
export interface EphemeralKeyIntegration {
  keyService: EphemeralKeyService;
  onKeyRenewal: (newKey: EphemeralKeyInfo) => Promise<void>;
  onKeyExpiration: () => Promise<void>;
  onAuthenticationError: (error: WebRTCError) => Promise<void>;
}

/**
 * Integration contract describing how WebRTC interacts with session management.
 */
export interface SessionIntegration {
  sessionManager: SessionManager;
  onSessionStateChanged: (state: WebRTCConnectionState) => Promise<void>;
  onConnectionRecovery: () => Promise<void>;
  onConnectionFailure: (error: WebRTCError) => Promise<void>;
}

/**
 * Integration contract bridging WebRTC media events with the audio pipeline.
 */
export interface AudioPipelineIntegration {
  onAudioInputRequired: () => Promise<MediaStreamTrack>;
  onAudioOutputReceived: (stream: MediaStream) => Promise<void>;
  onAudioQualityChanged: (quality: ConnectionQuality) => Promise<void>;
  onCodecProfileChanged?: (profile: AudioCodecProfile) => Promise<void> | void;
}

/**
 * Simplified interface describing the ephemeral key service dependency.
 */
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

/**
 * Simplified contract for a session manager available to WebRTC integrations.
 */
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

/**
 * Minimal configuration service contract required by the WebRTC layer.
 */
export interface ConfigurationManager {
  initialize(): Promise<void>;
  dispose(): void;
  isInitialized(): boolean;
  getAzureOpenAIConfig(): any;
  onConfigurationChanged(handler: () => Promise<void>): { dispose: () => void };
}

/**
 * Logger abstraction used when the WebRTC service needs to emit telemetry.
 */
export interface Logger {
  info(message: string, data?: any): void;
  error(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  debug(message: string, data?: any): void;
}

/**
 * Aggregated dependencies required by the WebRTC service coordinator.
 */
export interface ServiceCoordinator {
  ephemeralKeyService: EphemeralKeyService;
  sessionManager: SessionManager;
  configurationManager: ConfigurationManager;
  logger: Logger;
}

/**
 * Optional dependency bundle consumed when instantiating the WebRTC service.
 */
export interface WebRTCServiceDependencies {
  ephemeralKeyService: EphemeralKeyService;
  sessionManager?: SessionManager;
  configurationManager?: ConfigurationManager;
  logger?: Logger;
}

/**
 * Interface for coordinating errors and state changes across services.
 */
export interface ServiceEventCoordinator {
  onServiceError(service: string, error: Error): Promise<void>;
  onServiceStateChanged(service: string, state: string): Promise<void>;
  onServiceRecovery(service: string): Promise<void>;
}

/**
 * Interface used to orchestrate service initialization and lifecycle control.
 */
export interface ServiceLifecycleCoordinator {
  initializeServices(): Promise<void>;
  disposeServices(): void;
  restartService(serviceName: string): Promise<void>;
  getServiceHealth(): Map<string, boolean>;
}

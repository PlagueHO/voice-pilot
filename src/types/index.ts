/**
 * @packageDocumentation
 * Barrel exports for the VoicePilot type system.
 *
 * @remarks
 * Re-exports shared type definitions and integration contracts so consumers can
 * import from a single module without coupling to folder structure details.
 */

export * from "./audio-capture";
export * from "./audio-errors";
export * from "./audio-feedback";
export * from "./configuration";
export * from "./conversation";
export * from "./credentials";
export * from "./ephemeral";
export * from "./error/error-taxonomy";
export * from "./error/voice-pilot-error";
export * from "./presence";
export * from "./privacy";
export * from "./realtime-events";
export * from "./retry";
export * from "./session";
export * from "./speech-to-text";
export * from "./tts";
export * from "./webrtc";

// Service integration types - only non-conflicting exports
export type {
    AudioPipelineIntegration,
    EphemeralKeyIntegration,
    ServiceEventCoordinator,
    ServiceLifecycleCoordinator,
    SessionIntegration,
    WebRTCServiceDependencies
} from "./service-integration";


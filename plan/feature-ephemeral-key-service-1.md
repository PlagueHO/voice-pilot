---
goal: Implement Ephemeral Key Service for Azure OpenAI Realtime API Authentication
version: 1.0
date_created: 2025-09-20
last_updated: 2025-09-20
date_completed: 2025-09-20
owner: VoicePilot Project
status: 'Completed'
tags: [feature, azure, authentication, realtime, security, architecture]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This implementation plan details the development of the Ephemeral Key Service (SP-004) for VoicePilot's Azure OpenAI Realtime API integration. The service will mint and manage short-lived session tokens, ensuring secure WebRTC-based real-time audio communication while maintaining strict security boundaries between extension host and webview contexts.

## 1. Requirements & Constraints

- **REQ-001**: Implement complete EphemeralKeyService interface as defined in SP-004 specification
- **REQ-002**: Integrate with existing CredentialManager for secure API key retrieval
- **REQ-003**: Support Azure OpenAI Realtime Sessions API (2025-04-01-preview)
- **REQ-004**: Implement automatic key renewal with 10-second safety margin
- **REQ-005**: Provide typed interfaces for all Azure API responses and error conditions

- **SEC-001**: Standard Azure API keys SHALL NEVER be exposed to webview contexts
- **SEC-002**: Ephemeral keys SHALL have maximum 1-minute validity period
- **SEC-003**: Key minting SHALL occur exclusively in extension host context
- **SEC-004**: Failed authentication SHALL not expose credential information in errors
- **SEC-005**: Expired keys SHALL be immediately discarded from memory

- **PERF-001**: Key minting SHALL complete within 3 seconds under normal conditions
- **PERF-002**: Key renewal SHALL occur automatically 10 seconds before expiration
- **PERF-003**: Failed key requests SHALL implement exponential backoff (max 30 seconds)
- **PERF-004**: Concurrent key requests SHALL be coalesced to prevent API rate limiting

- **CON-001**: Service MUST be initialized after CredentialManager and ConfigurationManager
- **CON-002**: Service MUST dispose of all keys and timers on deactivation
- **CON-003**: Service MUST handle configuration changes without session interruption
- **CON-004**: Service MUST support graceful session termination with proper cleanup

- **GUD-001**: Implement ServiceInitializable interface for consistent lifecycle management
- **GUD-002**: Use typed interfaces for Azure API responses and error conditions
- **GUD-003**: Provide clear separation between credential management and session management
- **GUD-004**: Support diagnostic operations for authentication troubleshooting

- **PAT-001**: Use fetch API for Azure Sessions API integration (no external SDK dependency)
- **PAT-002**: Implement timer-based automatic key renewal with safety margins
- **PAT-003**: Use Promise-based async patterns for all authentication operations
- **PAT-004**: Provide event-driven notifications for key state changes

## 2. Implementation Steps

### Implementation Phase 1: Core Interfaces and Types

- GOAL-001: Define all TypeScript interfaces and types required for ephemeral key management

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create ephemeral key types in src/types/ephemeral.ts with EphemeralKeyService interface, EphemeralKeyResult, EphemeralKeyInfo, RealtimeSessionInfo, AuthenticationTestResult, AuthenticationError | |  |
| TASK-002 | Create Azure Sessions API types with AzureSessionRequest, AzureSessionResponse, WebRTCConnectionInfo interfaces | |  |
| TASK-003 | Create event handler interfaces: KeyRenewalHandler, KeyExpirationHandler, AuthenticationErrorHandler | |  |
| TASK-004 | Export all new types from src/types/index.ts | |  |

### Implementation Phase 2: Core Service Implementation

- GOAL-002: Implement the core EphemeralKeyService class with basic functionality

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Replace existing src/auth/EphemeralKeyService.ts with full implementation class EphemeralKeyServiceImpl | |  |
| TASK-006 | Implement ServiceInitializable methods: initialize(), dispose(), isInitialized() | |  |
| TASK-007 | Implement dependency injection for CredentialManager, ConfigurationManager, Logger | |  |
| TASK-008 | Add private properties: currentKey, renewalTimer, event handler arrays | |  |

### Implementation Phase 3: Azure Sessions API Integration

- GOAL-003: Implement Azure OpenAI Realtime Sessions API communication

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Implement requestEphemeralKey() method with Azure Sessions API POST request | |  |
| TASK-010 | Implement createAzureSession() private method with proper request formatting | |  |
| TASK-011 | Implement createRealtimeSession() method returning WebRTC connection info | |  |
| TASK-012 | Implement endSession() method with Azure Sessions API DELETE request | |  |
| TASK-013 | Add testAuthentication() method for endpoint connectivity validation | |  |

### Implementation Phase 4: Key Lifecycle Management

- GOAL-004: Implement automatic key renewal and lifecycle management

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | Implement scheduleRenewal() private method with timer management | |  |
| TASK-015 | Implement renewKey() method reusing requestEphemeralKey() logic | |  |
| TASK-016 | Implement revokeCurrentKey() method with memory cleanup | |  |
| TASK-017 | Implement isKeyValid() and getKeyExpiration() utility methods | |  |
| TASK-018 | Implement getCurrentKey() method returning current key information | |  |

### Implementation Phase 5: Error Handling and Retry Logic

- GOAL-005: Implement comprehensive error handling with retry mechanisms

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | Implement mapAzureError() private method for Azure error code mapping | |  |
| TASK-020 | Implement requestEphemeralKeyWithRetry() private method with exponential backoff | |  |
| TASK-021 | Add error handling for network failures (ENOTFOUND, ECONNREFUSED) | |  |
| TASK-022 | Add error handling for Azure API errors (401, 403, 429) | |  |
| TASK-023 | Implement error logging without credential exposure | |  |

### Implementation Phase 6: Event System and Integration

- GOAL-006: Implement event-driven notifications and integration hooks

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Implement onKeyRenewed() event registration returning vscode.Disposable | |  |
| TASK-025 | Implement onKeyExpired() event registration returning vscode.Disposable | |  |
| TASK-026 | Implement onAuthenticationError() event registration returning vscode.Disposable | |  |
| TASK-027 | Add event handler arrays and disposal logic in dispose() method | |  |
| TASK-028 | Integrate event notifications in renewal and error scenarios | |  |

### Implementation Phase 7: Configuration and Extension Controller Integration

- GOAL-007: Integrate service with existing extension architecture

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | Update src/core/ExtensionController.ts to instantiate EphemeralKeyService | |  |
| TASK-030 | Add EphemeralKeyService to initialization sequence after CredentialManager | |  |
| TASK-031 | Add EphemeralKeyService to disposal sequence in ExtensionController | |  |
| TASK-032 | Export EphemeralKeyService from types and add getter to ExtensionController | |  |
| TASK-033 | Update src/types/configuration.ts to add apiVersion field to AzureOpenAIConfig | |  |

### Implementation Phase 8: Testing and Validation

- GOAL-008: Create comprehensive test suite and validation

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-034 | Create test/auth/ephemeralKeyService.test.ts with unit tests | |  |
| TASK-035 | Add tests for key lifecycle: request, renewal, expiration, revocation | |  |
| TASK-036 | Add tests for error handling: network failures, Azure API errors, invalid credentials | |  |
| TASK-037 | Add tests for event system: registration, notification, disposal | |  |
| TASK-038 | Add integration tests with mocked CredentialManager and ConfigurationManager | |  |
| TASK-039 | Add performance tests for key minting latency and renewal timing | |  |

## 3. Alternatives

- **ALT-001**: Use Azure OpenAI JavaScript SDK instead of direct fetch API - Rejected due to potential version conflicts and reduced control over request/response handling
- **ALT-002**: Implement ephemeral key service as singleton pattern - Rejected in favor of dependency injection for better testability and lifecycle management
- **ALT-003**: Store ephemeral keys in VS Code secret storage - Rejected as ephemeral keys should only exist in memory with automatic cleanup
- **ALT-004**: Implement WebSocket fallback in addition to WebRTC - Deferred to future enhancement as WebRTC is primary requirement

## 4. Dependencies

- **DEP-001**: SP-001 (Core Extension Activation & Lifecycle) - Required for ServiceInitializable interface and extension initialization patterns
- **DEP-002**: SP-002 (Configuration & Settings Management) - Required for Azure endpoint and region configuration access
- **DEP-003**: SP-003 (Secret Storage & Credential Handling) - Required for secure Azure API key retrieval via CredentialManager
- **DEP-004**: Existing CredentialManager implementation in src/auth/CredentialManager.ts - Required for API key access
- **DEP-005**: Existing ConfigurationManager implementation in src/config/ConfigurationManager.ts - Required for Azure configuration
- **DEP-006**: Existing Logger implementation in src/core/logger.ts - Required for secure logging without credential exposure
- **DEP-007**: VS Code Extension API - Required for vscode.Disposable and extension context

## 5. Files

- **FILE-001**: src/types/ephemeral.ts - New file containing all ephemeral key service interfaces and types
- **FILE-002**: src/auth/EphemeralKeyService.ts - Replace existing stub with full implementation
- **FILE-003**: src/types/index.ts - Update to export new ephemeral key types
- **FILE-004**: src/types/configuration.ts - Update AzureOpenAIConfig interface to add apiVersion field
- **FILE-005**: src/core/ExtensionController.ts - Update to integrate EphemeralKeyService in initialization sequence
- **FILE-006**: test/auth/ephemeralKeyService.test.ts - New test file for comprehensive service testing
- **FILE-007**: src/auth/constants.ts - May need updates for Azure API endpoints and timeouts

## 6. Testing

- **TEST-001**: Unit tests for requestEphemeralKey() with valid credentials returning EphemeralKeyResult within 3 seconds
- **TEST-002**: Unit tests for automatic key renewal triggering 10 seconds before expiration
- **TEST-003**: Unit tests for error handling with invalid credentials, network failures, and Azure API errors
- **TEST-004**: Unit tests for event system registration, notification, and proper disposal
- **TEST-005**: Unit tests for service lifecycle: initialization, disposal, dependency validation
- **TEST-006**: Integration tests with mocked Azure Sessions API responses
- **TEST-007**: Integration tests with actual CredentialManager and ConfigurationManager instances
- **TEST-008**: Performance tests validating key minting latency under 3 seconds
- **TEST-009**: Memory leak tests ensuring proper timer and key disposal
- **TEST-010**: Concurrent request tests ensuring request coalescing prevents rate limiting

## 7. Risks & Assumptions

- **RISK-001**: Azure OpenAI Realtime API availability and rate limits may affect service reliability - Mitigated by exponential backoff and proper error handling
- **RISK-002**: Network connectivity issues during key renewal may interrupt voice sessions - Mitigated by retry logic and 10-second safety margin
- **RISK-003**: Changes to Azure Sessions API schema may break implementation - Mitigated by typed interfaces and comprehensive error handling
- **RISK-004**: Memory leaks from timer management may affect extension performance - Mitigated by proper disposal patterns and testing

- **ASSUMPTION-001**: Azure OpenAI resource has Realtime API access in East US 2 or Sweden Central regions
- **ASSUMPTION-002**: CredentialManager and ConfigurationManager are properly initialized before EphemeralKeyService
- **ASSUMPTION-003**: VS Code Extension Context provides stable access to required APIs
- **ASSUMPTION-004**: Network connectivity is available for Azure API communication during key operations
- **ASSUMPTION-005**: Azure Sessions API maintains backward compatibility with 2025-04-01-preview version

## 8. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](../spec/sp-001-spec-architecture-extension-lifecycle.md)
- [SP-002: Configuration & Settings Management](../spec/sp-002-spec-design-configuration-management.md)
- [SP-003: Secret Storage & Credential Handling](../spec/sp-003-spec-security-secret-storage.md)
- [SP-004: Ephemeral Key Service (Azure Realtime)](../spec/sp-004-spec-architecture-ephemeral-key-service.md)
- [SP-005: Session Management & Renewal](../spec/sp-005-spec-design-session-management.md)
- [SP-006: WebRTC Audio Transport Layer](../spec/sp-006-spec-architecture-webrtc-audio.md)
- [Azure OpenAI Realtime API Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)
- [Azure OpenAI Sessions API Reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/authoring-reference-preview#authentication)

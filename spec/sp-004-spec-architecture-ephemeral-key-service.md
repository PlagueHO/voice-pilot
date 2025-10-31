---
title: Ephemeral Key Service (Azure Realtime)
version: 1.0
date_created: 2025-09-20
last_updated: 2025-09-20
owner: Agent Voice Project
tags: [architecture, azure, authentication, realtime, security]
---

# Introduction

This specification defines the Ephemeral Key Service for minting and managing short-lived session tokens required for Azure OpenAI Realtime API authentication. The service implements secure token exchange patterns where permanent Azure API keys are never exposed to client contexts while enabling WebRTC-based real-time audio communication. This component is critical for establishing secure, low-latency voice interactions with Azure OpenAI's GPT Realtime models.

## 1. Purpose & Scope

This specification defines the ephemeral key management requirements for Agent Voice's Azure OpenAI Realtime API integration, covering:

- Secure ephemeral token minting using permanent Azure credentials
- Token lifecycle management with automatic renewal
- Integration with Azure OpenAI Realtime Sessions API
- WebRTC authentication flow coordination
- Security boundaries between extension host and webview contexts
- Error handling and fallback mechanisms for authentication failures

**Intended Audience**: Extension developers, security architects, and Azure integration specialists.

**Assumptions**:

- Azure OpenAI resource with Realtime API access (East US 2 or Sweden Central)
- VS Code Extension Context with Secret Storage access
- Understanding of Azure API authentication patterns
- Knowledge of WebRTC connection establishment requirements
- Familiarity with ephemeral token security patterns

## 2. Definitions

- **Ephemeral Key**: Short-lived (1-minute) authentication token for Azure OpenAI Realtime sessions
- **Standard API Key**: Long-lived Azure OpenAI resource authentication credential stored securely
- **Session Token**: Azure-issued session identifier paired with ephemeral key for WebRTC authentication
- **Token Minting**: Process of exchanging standard API key for ephemeral session credentials
- **Key Rotation**: Automatic renewal of ephemeral keys before expiration
- **WebRTC Authentication**: Using ephemeral keys to establish secure peer connections
- **Backend Service Pattern**: Server-side credential exchange to protect permanent API keys
- **Azure Realtime Sessions API**: Azure endpoint for creating and managing realtime audio sessions

## 3. Requirements, Constraints & Guidelines

### Security Requirements

- **SEC-001**: Standard Azure API keys SHALL NEVER be exposed to webview or client contexts
- **SEC-002**: Ephemeral keys SHALL have maximum 1-minute validity period
- **SEC-003**: Key minting SHALL occur exclusively in extension host context
- **SEC-004**: Failed authentication SHALL not expose credential information in errors
- **SEC-005**: Expired keys SHALL be immediately discarded from memory
- **SEC-006**: All authentication operations SHALL use HTTPS transport
- **SEC-007**: Key renewal SHALL occur before expiration with sufficient safety margin

### Authentication Requirements

- **AUTH-001**: Service SHALL integrate with existing CredentialManager for API key retrieval
- **AUTH-002**: Ephemeral key requests SHALL validate Azure endpoint configuration
- **AUTH-003**: Service SHALL support both API key and managed identity authentication
- **AUTH-004**: Session creation SHALL return both ephemeral key and session identifier
- **AUTH-005**: Authentication errors SHALL provide actionable remediation guidance

### Performance Requirements

- **PERF-001**: Key minting SHALL complete within 3 seconds under normal conditions
- **PERF-002**: Key renewal SHALL occur automatically 10 seconds before expiration
- **PERF-003**: Service SHALL maintain connection readiness for immediate WebRTC establishment
- **PERF-004**: Failed key requests SHALL implement exponential backoff (max 30 seconds)
- **PERF-005**: Concurrent key requests SHALL be coalesced to prevent API rate limiting

### Lifecycle Constraints

- **CON-001**: Service MUST be initialized after CredentialManager and ConfigurationManager
- **CON-002**: Service MUST dispose of all keys and timers on deactivation
- **CON-003**: Service MUST handle configuration changes without session interruption
- **CON-004**: Service MUST support graceful session termination with proper cleanup

### Integration Guidelines

- **GUD-001**: Implement ServiceInitializable interface for consistent lifecycle management
- **GUD-002**: Use typed interfaces for Azure API responses and error conditions
- **GUD-003**: Provide clear separation between credential management and session management
- **GUD-004**: Support diagnostic operations for authentication troubleshooting

### Implementation Patterns

- **PAT-001**: Use Azure OpenAI JavaScript SDK for session API integration
- **PAT-002**: Implement timer-based automatic key renewal with safety margins
- **PAT-003**: Use Promise-based async patterns for all authentication operations
- **PAT-004**: Provide event-driven notifications for key state changes

## 4. Interfaces & Data Contracts

### Ephemeral Key Service Interface

```typescript
interface EphemeralKeyService extends ServiceInitializable {
  // Primary authentication operations
  requestEphemeralKey(): Promise<EphemeralKeyResult>;
  getCurrentKey(): EphemeralKeyInfo | undefined;
  renewKey(): Promise<EphemeralKeyResult>;
  revokeCurrentKey(): Promise<void>;

  // Session management
  createRealtimeSession(): Promise<RealtimeSessionInfo>;
  endSession(sessionId: string): Promise<void>;

  // Lifecycle and diagnostics
  isKeyValid(): boolean;
  getKeyExpiration(): Date | undefined;
  testAuthentication(): Promise<AuthenticationTestResult>;

  // Event handling
  onKeyRenewed(handler: KeyRenewalHandler): vscode.Disposable;
  onKeyExpired(handler: KeyExpirationHandler): vscode.Disposable;
  onAuthenticationError(handler: AuthenticationErrorHandler): vscode.Disposable;
}

interface EphemeralKeyResult {
  success: boolean;
  ephemeralKey?: string;
  sessionId?: string;
  expiresAt?: Date;
  error?: AuthenticationError;
}

interface EphemeralKeyInfo {
  key: string;
  sessionId: string;
  issuedAt: Date;
  expiresAt: Date;
  isValid: boolean;
  secondsRemaining: number;
}

interface RealtimeSessionInfo {
  sessionId: string;
  ephemeralKey: string;
  websocketUrl?: string;
  webrtcUrl: string;
  expiresAt: Date;
}

interface AuthenticationTestResult {
  success: boolean;
  endpoint: string;
  region: string;
  hasValidCredentials: boolean;
  canCreateSessions: boolean;
  latencyMs?: number;
  error?: string;
}

interface AuthenticationError {
  code: string;
  message: string;
  isRetryable: boolean;
  remediation: string;
  azureErrorDetails?: any;
}
```

### Azure Sessions API Integration

```typescript
// Azure OpenAI Realtime Sessions API contracts
interface AzureSessionRequest {
  model: string; // e.g., "gpt-4o-realtime-preview"
  voice?: string; // Optional voice selection
  instructions?: string; // Optional system instructions
  input_audio_format?: 'pcm16'; // Audio format specification
  output_audio_format?: 'pcm16';
  turn_detection?: {
    type: 'server_vad';
    threshold?: number;
    prefix_padding_ms?: number;
    silence_duration_ms?: number;
  };
}

interface AzureSessionResponse {
  id: string; // Session identifier
  model: string;
  expires_at: number; // Unix timestamp
  client_secret: {
    value: string; // Ephemeral key
    expires_at: number;
  };
  turn_detection?: object;
  voice?: string;
  instructions?: string;
  input_audio_format?: string;
  output_audio_format?: string;
}

// WebRTC connection information
interface WebRTCConnectionInfo {
  sessionId: string;
  ephemeralKey: string;
  webrtcUrl: string; // https://{region}.realtimeapi-preview.ai.azure.com/v1/realtimertc
  iceServers?: RTCIceServer[];
}
```

### Event Handler Interfaces

```typescript
interface KeyRenewalHandler {
  (result: EphemeralKeyResult): Promise<void>;
}

interface KeyExpirationHandler {
  (info: EphemeralKeyInfo): Promise<void>;
}

interface AuthenticationErrorHandler {
  (error: AuthenticationError): Promise<void>;
}
```

### Configuration Integration

```typescript
// Extension to existing AzureOpenAIConfig
interface AzureOpenAIConfig {
  endpoint: string;
  deploymentName: string;
  region: 'eastus2' | 'swedencentral';
  apiVersion?: string; // Default: "2025-04-01-preview"
  // apiKey retrieved via CredentialManager
}

// Service configuration
interface EphemeralKeyServiceConfig {
  renewalMarginSeconds: number; // Default: 10
  maxRetryAttempts: number; // Default: 3
  retryBackoffMs: number; // Default: 1000
  sessionTimeoutMs: number; // Default: 300000 (5 minutes)
}
```

## 5. Acceptance Criteria

- **AC-001**: Given valid Azure credentials, When requestEphemeralKey() is called, Then ephemeral key is returned within 3 seconds
- **AC-002**: Given ephemeral key nearing expiration, When 50 seconds have elapsed, Then automatic renewal occurs successfully
- **AC-003**: Given invalid Azure credentials, When authentication fails, Then clear error message guides user to credential configuration
- **AC-004**: Given network connectivity issues, When key request fails, Then exponential backoff retry mechanism activates
- **AC-005**: Given successful key minting, When createRealtimeSession() is called, Then WebRTC connection information is provided
- **AC-006**: Given active session, When service is disposed, Then all keys and timers are cleaned up properly
- **AC-007**: Given configuration changes, When Azure endpoint updates, Then new sessions use updated configuration
- **AC-008**: Given authentication test, When testAuthentication() runs, Then endpoint connectivity and credential validity are verified

## 6. Test Automation Strategy

- **Test Levels**: Unit tests for key lifecycle, Integration tests with Azure Sessions API, End-to-End tests with WebRTC connections
- **Frameworks**: VS Code Extension Test Runner, Azure SDK test patterns, Mock Azure endpoints for unit testing
- **Test Data Management**: Test Azure resources with isolated credentials, ephemeral key mocking for unit tests
- **CI/CD Integration**: Automated authentication testing in GitHub Actions with secure credential handling
- **Coverage Requirements**: 100% coverage for security-critical authentication paths, 95% for error handling scenarios
- **Performance Testing**: Key minting latency measurement, renewal timing validation, concurrent request handling

## 7. Rationale & Context

The ephemeral key design addresses critical security and performance requirements:

1. **Security**: Permanent API keys never leave the extension host, preventing exposure in webview contexts where WebRTC connections are established.

2. **Real-time Performance**: 1-minute key validity provides sufficient time for voice sessions while limiting exposure window.

3. **Azure Integration**: Leverages Azure OpenAI's native ephemeral key system designed specifically for client-side applications.

4. **Reliability**: Automatic renewal with safety margins ensures uninterrupted voice sessions.

5. **Compliance**: Follows Azure security best practices for client credential management.

The backend service pattern ensures that even if the extension or webview is compromised, permanent credentials remain secure.

## 8. Dependencies & External Integrations

### VS Code Platform Dependencies

- **PLT-001**: VS Code Extension Context - Required for service initialization and lifecycle management
- **PLT-002**: VS Code Secret Storage API - Required for secure credential retrieval integration

### Extension Internal Dependencies

- **INT-001**: CredentialManager - Required for Azure API key retrieval from secure storage
- **INT-002**: ConfigurationManager - Required for Azure endpoint and region configuration
- **INT-003**: Logger - Required for authentication event logging and error tracking
- **INT-004**: ServiceInitializable Pattern - Required for consistent lifecycle management

### Azure Service Dependencies

- **AZR-001**: Azure OpenAI Realtime Sessions API - Required for ephemeral key minting and session creation
- **AZR-002**: Azure OpenAI Resource - Required with GPT Realtime model deployment in supported regions
- **AZR-003**: Azure Authentication - Required for API key or managed identity credential validation
- **AZR-004**: Network Connectivity - Required for HTTPS communication with Azure endpoints

### WebRTC Integration Dependencies

- **WEB-001**: WebRTC Connection Manager - Dependent service that consumes ephemeral keys for peer connections
- **WEB-002**: Session Manager - Dependent service that coordinates session lifecycle with key lifecycle
- **WEB-003**: Audio Processing Services - Dependent services requiring authenticated realtime connections

### Security Dependencies

- **SEC-001**: HTTPS Transport - Required for all Azure API communication
- **SEC-002**: Extension Host Security - Required for credential isolation from webview contexts
- **SEC-003**: Memory Management - Required for secure key disposal and cleanup

## 9. Examples & Edge Cases

### Basic Ephemeral Key Lifecycle

```typescript
class EphemeralKeyServiceImpl implements EphemeralKeyService {
  private currentKey?: EphemeralKeyInfo;
  private renewalTimer?: NodeJS.Timeout;
  private credentialManager!: CredentialManager;
  private configManager!: ConfigurationManager;
  private logger!: Logger;

  async initialize(): Promise<void> {
    this.logger.info('Initializing EphemeralKeyService');

    // Validate dependencies
    if (!this.credentialManager.isInitialized()) {
      throw new Error('CredentialManager must be initialized before EphemeralKeyService');
    }

    // Test authentication capability
    const testResult = await this.testAuthentication();
    if (!testResult.success) {
      this.logger.error('Authentication test failed', testResult);
      throw new Error(`Authentication test failed: ${testResult.error}`);
    }

    this.logger.info('EphemeralKeyService initialized successfully');
  }

  async requestEphemeralKey(): Promise<EphemeralKeyResult> {
    try {
      const config = this.configManager.getAzureOpenAIConfig();
      const apiKey = await this.credentialManager.getAzureOpenAIKey();

      if (!apiKey) {
        return {
          success: false,
          error: {
            code: 'MISSING_CREDENTIALS',
            message: 'Azure OpenAI API key not configured',
            isRetryable: false,
            remediation: 'Configure Azure OpenAI credentials in settings'
          }
        };
      }

      // Create session using Azure Sessions API
      const sessionResponse = await this.createAzureSession(config, apiKey);

      const ephemeralKey = sessionResponse.client_secret.value;
      const expiresAt = new Date(sessionResponse.client_secret.expires_at * 1000);

      // Store current key info
      this.currentKey = {
        key: ephemeralKey,
        sessionId: sessionResponse.id,
        issuedAt: new Date(),
        expiresAt,
        isValid: true,
        secondsRemaining: Math.floor((expiresAt.getTime() - Date.now()) / 1000)
      };

      // Schedule automatic renewal
      this.scheduleRenewal();

      this.logger.info('Ephemeral key requested successfully', {
        sessionId: sessionResponse.id,
        expiresAt: expiresAt.toISOString()
      });

      return {
        success: true,
        ephemeralKey,
        sessionId: sessionResponse.id,
        expiresAt
      };

    } catch (error: any) {
      this.logger.error('Failed to request ephemeral key', { error: error.message });

      return {
        success: false,
        error: this.mapAzureError(error)
      };
    }
  }

  private async createAzureSession(config: AzureOpenAIConfig, apiKey: string): Promise<AzureSessionResponse> {
    const sessionRequest: AzureSessionRequest = {
      model: config.deploymentName,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 200
      }
    };

    const response = await fetch(
      `${config.endpoint}/openai/realtimeapi/sessions?api-version=${config.apiVersion || '2025-04-01-preview'}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        body: JSON.stringify(sessionRequest)
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Azure Sessions API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    return await response.json();
  }

  private scheduleRenewal(): void {
    if (this.renewalTimer) {
      clearTimeout(this.renewalTimer);
    }

    if (!this.currentKey) {
      return;
    }

    // Schedule renewal 10 seconds before expiration
    const renewalTime = this.currentKey.expiresAt.getTime() - Date.now() - 10000;

    if (renewalTime > 0) {
      this.renewalTimer = setTimeout(async () => {
        this.logger.info('Automatic key renewal triggered');
        const result = await this.renewKey();

        if (result.success) {
          this.keyRenewalHandlers.forEach(handler => handler(result));
        } else {
          this.logger.error('Automatic key renewal failed', result.error);
          this.authErrorHandlers.forEach(handler => handler(result.error!));
        }
      }, renewalTime);
    }
  }
}
```

### Error Handling and Retry Logic

```typescript
private async requestEphemeralKeyWithRetry(): Promise<EphemeralKeyResult> {
  const maxAttempts = 3;
  let backoffMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await this.requestEphemeralKey();

    if (result.success || !result.error?.isRetryable) {
      return result;
    }

    if (attempt < maxAttempts) {
      this.logger.warn(`Key request attempt ${attempt} failed, retrying in ${backoffMs}ms`, result.error);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs *= 2; // Exponential backoff
    }
  }

  this.logger.error(`All ${maxAttempts} key request attempts failed`);
  return {
    success: false,
    error: {
      code: 'MAX_RETRIES_EXCEEDED',
      message: `Failed to obtain ephemeral key after ${maxAttempts} attempts`,
      isRetryable: true,
      remediation: 'Check network connectivity and Azure service status'
    }
  };
}

private mapAzureError(error: any): AuthenticationError {
  // Map Azure-specific errors to standardized error format
  if (error.message?.includes('401')) {
    return {
      code: 'INVALID_CREDENTIALS',
      message: 'Azure OpenAI API key is invalid or expired',
      isRetryable: false,
      remediation: 'Update Azure OpenAI API key in credential settings'
    };
  }

  if (error.message?.includes('403')) {
    return {
      code: 'INSUFFICIENT_PERMISSIONS',
      message: 'API key lacks necessary permissions for Realtime API',
      isRetryable: false,
      remediation: 'Ensure API key has Cognitive Services OpenAI User role'
    };
  }

  if (error.message?.includes('429')) {
    return {
      code: 'RATE_LIMITED',
      message: 'Too many requests to Azure OpenAI service',
      isRetryable: true,
      remediation: 'Wait before retrying, consider upgrading Azure resource tier'
    };
  }

  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return {
      code: 'NETWORK_ERROR',
      message: 'Cannot connect to Azure OpenAI service',
      isRetryable: true,
      remediation: 'Check network connectivity and Azure endpoint configuration'
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    message: error.message || 'Unknown authentication error',
    isRetryable: true,
    remediation: 'Check Azure service status and configuration'
  };
}
```

### WebRTC Integration Example

```typescript
async createRealtimeSession(): Promise<RealtimeSessionInfo> {
  if (!this.currentKey || !this.isKeyValid()) {
    const result = await this.requestEphemeralKey();
    if (!result.success) {
      throw new Error(`Cannot create session: ${result.error?.message}`);
    }
  }

  const config = this.configManager.getAzureOpenAIConfig();
  const webrtcUrl = `https://${config.region}.realtimeapi-preview.ai.azure.com/v1/realtimertc`;

  return {
    sessionId: this.currentKey!.sessionId,
    ephemeralKey: this.currentKey!.key,
    webrtcUrl,
    expiresAt: this.currentKey!.expiresAt
  };
}

// Example usage from WebRTC Client
async establishWebRTCConnection(): Promise<RTCPeerConnection> {
  const sessionInfo = await this.ephemeralKeyService.createRealtimeSession();

  const peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  // Authenticate using ephemeral key in WebRTC SDP
  const offer = await peerConnection.createOffer();

  // Add authentication header to SDP
  const authenticatedOffer = {
    ...offer,
    sdp: offer.sdp + `\na=authorization:Bearer ${sessionInfo.ephemeralKey}`
  };

  await peerConnection.setLocalDescription(authenticatedOffer);

  // Complete WebRTC handshake with Azure...
  return peerConnection;
}
```

### Edge Case: Service Disposal During Active Session

```typescript
dispose(): void {
  this.logger.info('Disposing EphemeralKeyService');

  // Clear renewal timer
  if (this.renewalTimer) {
    clearTimeout(this.renewalTimer);
    this.renewalTimer = undefined;
  }

  // Clear current key from memory
  if (this.currentKey) {
    this.currentKey = undefined;
  }

  // Clear event handlers
  this.keyRenewalHandlers.clear();
  this.keyExpirationHandlers.clear();
  this.authErrorHandlers.clear();

  this.logger.info('EphemeralKeyService disposed');
}

// Graceful session termination
async endSession(sessionId: string): Promise<void> {
  try {
    const config = this.configManager.getAzureOpenAIConfig();
    const apiKey = await this.credentialManager.getAzureOpenAIKey();

    if (apiKey) {
      // Notify Azure to end session
      await fetch(
        `${config.endpoint}/openai/realtimeapi/sessions/${sessionId}?api-version=${config.apiVersion || '2025-04-01-preview'}`,
        {
          method: 'DELETE',
          headers: { 'api-key': apiKey }
        }
      );
    }

    this.logger.info('Session ended successfully', { sessionId });
  } catch (error: any) {
    this.logger.warn('Failed to end session gracefully', { sessionId, error: error.message });
  }
}
```

## 10. Validation Criteria

- Ephemeral key minting succeeds with valid Azure credentials within 3-second timeout
- Automatic key renewal occurs 10 seconds before expiration without session interruption
- Invalid credentials produce clear error messages with actionable remediation steps
- Network failures trigger exponential backoff retry mechanism with appropriate limits
- WebRTC connection establishment succeeds using minted ephemeral keys
- Service disposal cleans up all timers, keys, and event handlers properly
- Configuration changes are handled without affecting active sessions
- Authentication test validates both credential validity and Azure service connectivity

## 11. Related Specifications / Further Reading

- [SP-001: Core Extension Activation & Lifecycle](sp-001-spec-architecture-extension-lifecycle.md)
- [SP-002: Configuration & Settings Management](sp-002-spec-design-configuration-management.md)
- [SP-003: Secret Storage & Credential Handling](sp-003-spec-security-secret-storage.md)
- [SP-005: Session Management & Renewal](sp-005-spec-design-session-management.md)
- [SP-006: WebRTC Audio Transport Layer](sp-006-spec-architecture-webrtc-audio.md)
- [Azure OpenAI Realtime API Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/realtime-audio-webrtc)
- [Azure OpenAI Authentication Patterns](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/supported-languages#authentication)

import * as assert from 'assert';
import * as vscode from 'vscode';
import { CredentialManagerImpl } from '../../src/auth/credential-manager';
import { EphemeralKeyServiceImpl } from '../../src/auth/ephemeral-key-service';
import { ConfigurationManager } from '../../src/config/configuration-manager';
import { Logger } from '../../src/core/logger';
import { AudioConfig, AzureOpenAIConfig, AzureRealtimeConfig } from '../../src/types/configuration';
import { EphemeralKeyInfo } from '../../src/types/ephemeral';

// Mock VS Code extension context
const createMockContext = (): vscode.ExtensionContext => ({
  subscriptions: [],
  workspaceState: {} as any,
  globalState: {} as any,
  extensionUri: vscode.Uri.parse('file:///test'),
  extensionPath: '/test',
  asAbsolutePath: (path: string) => `/test/${path}`,
  storagePath: '/test/storage',
  globalStoragePath: '/test/global',
  logPath: '/test/logs',
  storageUri: vscode.Uri.parse('file:///test/storage'),
  globalStorageUri: vscode.Uri.parse('file:///test/global'),
  extension: {} as any,
  languageModelAccessInformation: {} as any,
  secrets: {
    get: async (key: string) => 'test-api-key',
    store: async (key: string, value: string) => {},
    delete: async (key: string) => {}
  } as any,
  environmentVariableCollection: {} as any,
  extensionMode: vscode.ExtensionMode.Test,
  logUri: vscode.Uri.parse('file:///test/logs')
});

// Mock CredentialManager
class MockCredentialManager extends CredentialManagerImpl {
  private mockApiKey = 'test-api-key';
  private shouldReturnKey = true;

  constructor() {
    super(createMockContext(), new Logger('MockCredentialManager'));
  }

  async initialize(): Promise<void> {
    // Mock initialization no-op
  }

  isInitialized(): boolean {
    return true;
  }

  async getAzureOpenAIKey(): Promise<string | undefined> {
    return this.shouldReturnKey ? this.mockApiKey : undefined;
  }

  setMockApiKey(key: string | undefined): void {
    if (key) {
      this.mockApiKey = key;
      this.shouldReturnKey = true;
    } else {
      this.shouldReturnKey = false;
    }
  }
}

// Mock ConfigurationManager
class MockConfigurationManager extends ConfigurationManager {
  private mockConfig: AzureOpenAIConfig = {
    endpoint: 'https://test.openai.azure.com',
    deploymentName: 'gpt-4o-realtime-preview',
    region: 'eastus2',
    apiVersion: '2025-04-01-preview'
  };

  private mockRealtimeConfig: AzureRealtimeConfig = {
    model: 'gpt-realtime-preview',
    apiVersion: '2025-08-28',
    transcriptionModel: 'whisper-1',
    inputAudioFormat: 'pcm16',
    locale: 'en-US',
    profanityFilter: 'medium',
    interimDebounceMs: 250,
    maxTranscriptHistorySeconds: 120
  };

  private mockAudioConfig: AudioConfig = {
    inputDevice: 'default',
    outputDevice: 'default',
    noiseReduction: true,
    echoCancellation: true,
    sampleRate: 24000,
    sharedContext: {
      autoResume: true,
      requireGesture: true,
      latencyHint: 'interactive'
    },
    workletModules: [],
    turnDetection: {
      type: 'server_vad',
      threshold: 0.5,
      prefixPaddingMs: 300,
      silenceDurationMs: 200,
      createResponse: true,
      interruptResponse: true,
      eagerness: 'auto'
    },
    tts: {
      transport: 'webrtc',
      apiVersion: '2025-04-01-preview',
      fallbackMode: 'retry',
      maxInitialLatencyMs: 300,
      voice: {
        name: 'alloy',
        locale: 'en-US',
        style: 'conversational',
        gender: 'unspecified'
      }
    }
  };

  constructor() {
    super(createMockContext(), new Logger('MockConfigurationManager'));
  }

  async initialize(): Promise<void> {
    // Mock initialization
  }

  isInitialized(): boolean {
    return true;
  }

  getAzureOpenAIConfig(): AzureOpenAIConfig {
    return this.mockConfig;
  }

  getAzureRealtimeConfig(): AzureRealtimeConfig {
    return this.mockRealtimeConfig;
  }

  getAudioConfig(): AudioConfig {
    return this.mockAudioConfig;
  }

  setMockConfig(config: Partial<AzureOpenAIConfig>): void {
    this.mockConfig = { ...this.mockConfig, ...config };
  }
}

// Simple fetch mock
let mockFetchResponse: any = null;
let mockFetchStatus: number = 200;
let mockFetchError: any = null;

const originalFetch = global.fetch;

const mockFetch = async (url: string, options?: any): Promise<Response> => {
  if (mockFetchError) {
    throw mockFetchError;
  }

  return {
    ok: mockFetchStatus >= 200 && mockFetchStatus < 300,
    status: mockFetchStatus,
    json: async () => mockFetchResponse,
  } as Response;
};

const setMockFetch = (responseData: any, status = 200) => {
  mockFetchResponse = responseData;
  mockFetchStatus = status;
  mockFetchError = null;
  global.fetch = mockFetch as any;
};

const setMockFetchError = (error: any) => {
  mockFetchError = error;
  global.fetch = mockFetch as any;
};

const resetFetch = () => {
  global.fetch = originalFetch;
  mockFetchResponse = null;
  mockFetchStatus = 200;
  mockFetchError = null;
};

describe('EphemeralKeyService Tests', () => {
  let service: EphemeralKeyServiceImpl;
  let mockCredentialManager: MockCredentialManager;
  let mockConfigManager: MockConfigurationManager;
  let logger: Logger;

  beforeEach(async () => {
    logger = new Logger('EphemeralKeyServiceTest');
    mockCredentialManager = new MockCredentialManager();
    mockConfigManager = new MockConfigurationManager();

    await mockCredentialManager.initialize();
    await mockConfigManager.initialize();

    service = new EphemeralKeyServiceImpl(
      mockCredentialManager,
      mockConfigManager,
      logger
    );
  });

  afterEach(() => {
    if (service && service.isInitialized()) {
      service.dispose();
    }
    resetFetch();
  });

  describe('Initialization', () => {
  it('should initialize successfully with valid dependencies', async () => {
      // Mock successful authentication test
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });

      await service.initialize();
      assert.strictEqual(service.isInitialized(), true);
    });

  it('should fail initialization when CredentialManager not initialized', async () => {
      // Create a real credential manager but DO NOT call initialize()
      const rawCredentialManager = new CredentialManagerImpl(createMockContext(), new Logger('RawCredMgr'));
      const uninitializedService = new EphemeralKeyServiceImpl(
        rawCredentialManager as any,
        mockConfigManager,
        logger
      );
      try {
        await uninitializedService.initialize();
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('CredentialManager must be initialized'));
      }
    });

  it('should initialize in degraded mode when authentication test fails', async () => {
      // Mock failed authentication test
      setMockFetch({}, 401);

      // Service should initialize successfully even if auth test fails (degraded mode)
      await service.initialize();
      assert.strictEqual(service.isInitialized(), true);
    });
  });

  describe('Key Management', () => {
  beforeEach(async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });
      await service.initialize();
    });

  it('should request ephemeral key successfully', async () => {
      const mockResponse = {
        id: 'session-456',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-456',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.ephemeralKey, 'ephemeral-key-456');
      assert.strictEqual(result.sessionId, 'session-456');
      assert.ok(result.expiresAt instanceof Date);
      assert.ok(result.issuedAt instanceof Date);
      assert.ok(result.refreshAt instanceof Date);
      const refreshDelta = result.refreshAt!.getTime() - result.issuedAt!.getTime();
      assert.ok(
        refreshDelta >= 40000 && refreshDelta <= 50000,
        `Expected refresh delta around 45s but received ${refreshDelta}`
      );
      assert.strictEqual(result.refreshIntervalSeconds, 45);
      assert.ok(typeof result.secondsUntilRefresh === 'number');
    });

  it('should notify listeners with refresh metadata on key issuance', async () => {
      const mockResponse = {
        id: 'session-457',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-457',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);

      let renewalEvent: any;
      service.onKeyRenewed(async (result) => {
        renewalEvent = result;
      });

      await service.requestEphemeralKey();
      await new Promise((resolve) => setImmediate(resolve));

      assert.ok(renewalEvent);
      assert.strictEqual(renewalEvent.refreshIntervalSeconds, 45);
      assert.ok(renewalEvent.refreshAt instanceof Date);
    });

  it('should handle missing credentials', async () => {
      mockCredentialManager.setMockApiKey(undefined);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'MISSING_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
    });

  it('should handle Azure API errors', async () => {
      setMockFetch({ error: { message: 'Invalid API key' } }, 401);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
    });

  it('should return current key info', async () => {
      // First request a key
      const mockResponse = {
        id: 'session-789',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-789',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);
      await service.requestEphemeralKey();

      const keyInfo = service.getCurrentKey();
      assert.ok(keyInfo);
      assert.strictEqual(keyInfo.key, 'ephemeral-key-789');
      assert.strictEqual(keyInfo.sessionId, 'session-789');
      assert.strictEqual(keyInfo.isValid, true);
      assert.ok(keyInfo.secondsRemaining > 0);
  assert.ok(keyInfo.refreshAt instanceof Date);
  assert.ok(keyInfo.secondsUntilRefresh > 0);
  assert.strictEqual(keyInfo.refreshIntervalSeconds, 45);
  assert.ok(keyInfo.ttlSeconds >= 60);
    });

  it('should validate key expiration', async () => {
      // Mock expired key
      const mockResponse = {
        id: 'session-expired',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-expired',
          expires_at: Math.floor(Date.now() / 1000) - 10 // Expired 10 seconds ago
        }
      };

      setMockFetch(mockResponse);
      await service.requestEphemeralKey();

      assert.strictEqual(service.isKeyValid(), false);

      const keyInfo = service.getCurrentKey();
      assert.ok(keyInfo);
      assert.strictEqual(keyInfo.isValid, false);
      assert.strictEqual(keyInfo.secondsRemaining, 0);
      assert.strictEqual(keyInfo.secondsUntilRefresh, 0);
    });

  it('should revoke current key', async () => {
      // First request a key
      const mockResponse = {
        id: 'session-revoke',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-revoke',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);
      await service.requestEphemeralKey();

      let expiredEvent: EphemeralKeyInfo | undefined;
      service.onKeyExpired(async (info) => {
        expiredEvent = info;
      });

      // Mock successful session deletion
      setMockFetch({}, 204);

      await service.revokeCurrentKey();
      await new Promise((resolve) => setImmediate(resolve));

      assert.strictEqual(service.getCurrentKey(), undefined);
      assert.strictEqual(service.isKeyValid(), false);
      assert.ok(expiredEvent);
      assert.strictEqual(expiredEvent?.isValid, false);
    });
  });

  describe('Session Management', () => {
  beforeEach(async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });
      await service.initialize();
    });

  it('should create realtime session', async () => {
      // Mock key request
      const mockResponse = {
        id: 'session-realtime',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-realtime',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);

      const sessionInfo = await service.createRealtimeSession();

      assert.strictEqual(sessionInfo.sessionId, 'session-realtime');
      assert.strictEqual(sessionInfo.ephemeralKey, 'ephemeral-key-realtime');
      assert.strictEqual(sessionInfo.webrtcUrl, 'https://eastus2.realtimeapi-preview.ai.azure.com/v1/realtimertc');
      assert.ok(sessionInfo.expiresAt instanceof Date);
      assert.ok(sessionInfo.issuedAt instanceof Date);
      assert.ok(sessionInfo.refreshAt instanceof Date);
      assert.strictEqual(sessionInfo.refreshIntervalMs, 45000);
      assert.ok(sessionInfo.keyInfo);
      assert.strictEqual(sessionInfo.keyInfo.sessionId, 'session-realtime');
      assert.strictEqual(sessionInfo.keyInfo.refreshIntervalSeconds, 45);
    });

  it('should end session gracefully', async () => {
      setMockFetch({}, 204);

      // Should not throw
      await service.endSession('session-to-end');
    });

  it('should handle session end failures gracefully', async () => {
      setMockFetch({ error: 'Session not found' }, 404);

      // Should not throw, just log warning
      await service.endSession('non-existent-session');
    });
  });

  describe('Authentication Testing', () => {
  beforeEach(async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });
      await service.initialize();
    });

  it('should test authentication successfully', async () => {
      const mockResponse = {
        id: 'test-session',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'test-ephemeral-key',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);

      const result = await service.testAuthentication();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.hasValidCredentials, true);
      assert.strictEqual(result.canCreateSessions, true);
      assert.strictEqual(result.endpoint, 'https://test.openai.azure.com');
      assert.strictEqual(result.region, 'eastus2');
      assert.ok(typeof result.latencyMs === 'number');
    });

  it('should handle authentication test with missing credentials', async () => {
      mockCredentialManager.setMockApiKey(undefined);

      const result = await service.testAuthentication();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasValidCredentials, false);
      assert.strictEqual(result.canCreateSessions, false);
      assert.strictEqual(result.error, 'No Azure OpenAI API key configured');
    });

  it('should handle authentication test with invalid credentials', async () => {
      setMockFetch({ error: { message: 'Invalid API key' } }, 401);

      const result = await service.testAuthentication();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasValidCredentials, true);
      assert.strictEqual(result.canCreateSessions, false);
      assert.ok(result.error?.includes('HTTP 401'));
    });
  });

  describe('Event Handling', () => {
  beforeEach(async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });
      await service.initialize();
    });

  it('should register and dispose event handlers properly', async () => {
      const renewalDisposable = service.onKeyRenewed(async () => {});
      const expirationDisposable = service.onKeyExpired(async () => {});
      const errorDisposable = service.onAuthenticationError(async () => {});

      // Should not throw
      renewalDisposable.dispose();
      expirationDisposable.dispose();
      errorDisposable.dispose();
    });
  });

  describe('Error Mapping', () => {
  beforeEach(async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });
      await service.initialize();
    });

  it('should map 401 errors correctly', async () => {
      setMockFetch({ error: { message: 'Unauthorized' } }, 401);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
      assert.ok(result.error?.remediation.includes('Update Azure OpenAI API key'));
    });

  it('should map 403 errors correctly', async () => {
      setMockFetch({ error: { message: 'Forbidden' } }, 403);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INSUFFICIENT_PERMISSIONS');
      assert.strictEqual(result.error?.isRetryable, false);
      assert.ok(result.error?.remediation.includes('Cognitive Services OpenAI User role'));
    });

  it('should map 429 errors correctly', async () => {
      setMockFetch({ error: { message: 'Too Many Requests' } }, 429);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'RATE_LIMITED');
      assert.strictEqual(result.error?.isRetryable, true);
      assert.ok(result.error?.remediation.includes('Wait before retrying'));
    });

  it('should map network errors correctly', async () => {
      // Mock network error
      setMockFetchError({ code: 'ENOTFOUND' });

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'NETWORK_ERROR');
      assert.strictEqual(result.error?.isRetryable, true);
      assert.ok(result.error?.remediation.includes('Check network connectivity'));
    });
  });

  describe('Service Lifecycle', () => {
  it('should enforce initialization requirement', async () => {
      const uninitializedService = new EphemeralKeyServiceImpl(
        mockCredentialManager,
        mockConfigManager,
        logger
      );

      try {
        await uninitializedService.requestEphemeralKey();
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('EphemeralKeyService not initialized'));
      }
    });

  it('should dispose properly', async () => {
      // Mock successful authentication test for initialization
      setMockFetch({
        id: 'session-123',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-123',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      });

      await service.initialize();

      // Request a key to create internal state
      const mockResponse = {
        id: 'session-dispose',
        model: 'gpt-4o-realtime-preview',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        client_secret: {
          value: 'ephemeral-key-dispose',
          expires_at: Math.floor(Date.now() / 1000) + 60
        }
      };

      setMockFetch(mockResponse);
      await service.requestEphemeralKey();

      // Should not throw
      service.dispose();

      // Should clear state
      assert.strictEqual(service.getCurrentKey(), undefined);
      assert.strictEqual(service.isInitialized(), false);
    });
  });
});

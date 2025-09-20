import * as assert from 'assert';
import * as vscode from 'vscode';
import { CredentialManagerImpl } from '../../auth/CredentialManager';
import { EphemeralKeyServiceImpl } from '../../auth/EphemeralKeyService';
import { ConfigurationManager } from '../../config/ConfigurationManager';
import { Logger } from '../../core/logger';
import { AzureOpenAIConfig } from '../../types/configuration';

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
    // Mock initialization
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

suite('EphemeralKeyService Tests', () => {
  let service: EphemeralKeyServiceImpl;
  let mockCredentialManager: MockCredentialManager;
  let mockConfigManager: MockConfigurationManager;
  let logger: Logger;

  setup(async () => {
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

  teardown(() => {
    if (service && service.isInitialized()) {
      service.dispose();
    }
    resetFetch();
  });

  suite('Initialization', () => {
    test('should initialize successfully with valid dependencies', async () => {
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

    test('should fail initialization when CredentialManager not initialized', async () => {
      const uninitializedCredentialManager = new MockCredentialManager();
      const uninitializedService = new EphemeralKeyServiceImpl(
        uninitializedCredentialManager,
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

    test('should fail initialization when authentication test fails', async () => {
      // Mock failed authentication test
      setMockFetch({}, 401);

      try {
        await service.initialize();
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.ok(error.message.includes('Authentication test failed'));
      }
    });
  });

  suite('Key Management', () => {
    setup(async () => {
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

    test('should request ephemeral key successfully', async () => {
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
    });

    test('should handle missing credentials', async () => {
      mockCredentialManager.setMockApiKey(undefined);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'MISSING_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
    });

    test('should handle Azure API errors', async () => {
      setMockFetch({ error: { message: 'Invalid API key' } }, 401);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
    });

    test('should return current key info', async () => {
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
    });

    test('should validate key expiration', async () => {
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
    });

    test('should revoke current key', async () => {
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

      // Mock successful session deletion
      setMockFetch({}, 204);

      await service.revokeCurrentKey();

      assert.strictEqual(service.getCurrentKey(), undefined);
      assert.strictEqual(service.isKeyValid(), false);
    });
  });

  suite('Session Management', () => {
    setup(async () => {
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

    test('should create realtime session', async () => {
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
    });

    test('should end session gracefully', async () => {
      setMockFetch({}, 204);

      // Should not throw
      await service.endSession('session-to-end');
    });

    test('should handle session end failures gracefully', async () => {
      setMockFetch({ error: 'Session not found' }, 404);

      // Should not throw, just log warning
      await service.endSession('non-existent-session');
    });
  });

  suite('Authentication Testing', () => {
    setup(async () => {
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

    test('should test authentication successfully', async () => {
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

    test('should handle authentication test with missing credentials', async () => {
      mockCredentialManager.setMockApiKey(undefined);

      const result = await service.testAuthentication();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasValidCredentials, false);
      assert.strictEqual(result.canCreateSessions, false);
      assert.strictEqual(result.error, 'No Azure OpenAI API key configured');
    });

    test('should handle authentication test with invalid credentials', async () => {
      setMockFetch({ error: { message: 'Invalid API key' } }, 401);

      const result = await service.testAuthentication();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.hasValidCredentials, true);
      assert.strictEqual(result.canCreateSessions, false);
      assert.ok(result.error?.includes('HTTP 401'));
    });
  });

  suite('Event Handling', () => {
    setup(async () => {
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

    test('should register and dispose event handlers properly', async () => {
      const renewalDisposable = service.onKeyRenewed(async () => {});
      const expirationDisposable = service.onKeyExpired(async () => {});
      const errorDisposable = service.onAuthenticationError(async () => {});

      // Should not throw
      renewalDisposable.dispose();
      expirationDisposable.dispose();
      errorDisposable.dispose();
    });
  });

  suite('Error Mapping', () => {
    setup(async () => {
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

    test('should map 401 errors correctly', async () => {
      setMockFetch({ error: { message: 'Unauthorized' } }, 401);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INVALID_CREDENTIALS');
      assert.strictEqual(result.error?.isRetryable, false);
      assert.ok(result.error?.remediation.includes('Update Azure OpenAI API key'));
    });

    test('should map 403 errors correctly', async () => {
      setMockFetch({ error: { message: 'Forbidden' } }, 403);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'INSUFFICIENT_PERMISSIONS');
      assert.strictEqual(result.error?.isRetryable, false);
      assert.ok(result.error?.remediation.includes('Cognitive Services OpenAI User role'));
    });

    test('should map 429 errors correctly', async () => {
      setMockFetch({ error: { message: 'Too Many Requests' } }, 429);

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'RATE_LIMITED');
      assert.strictEqual(result.error?.isRetryable, true);
      assert.ok(result.error?.remediation.includes('Wait before retrying'));
    });

    test('should map network errors correctly', async () => {
      // Mock network error
      setMockFetchError({ code: 'ENOTFOUND' });

      const result = await service.requestEphemeralKey();

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error?.code, 'NETWORK_ERROR');
      assert.strictEqual(result.error?.isRetryable, true);
      assert.ok(result.error?.remediation.includes('Check network connectivity'));
    });
  });

  suite('Service Lifecycle', () => {
    test('should enforce initialization requirement', async () => {
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

    test('should dispose properly', async () => {
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

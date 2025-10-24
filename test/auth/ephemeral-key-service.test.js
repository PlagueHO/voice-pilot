"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const credential_manager_1 = require("../../src/auth/credential-manager");
const ephemeral_key_service_1 = require("../../src/auth/ephemeral-key-service");
const configuration_manager_1 = require("../../src/config/configuration-manager");
const logger_1 = require("../../src/core/logger");
// Mock VS Code extension context
const createMockContext = () => ({
    subscriptions: [],
    workspaceState: {},
    globalState: {},
    extensionUri: vscode.Uri.parse('file:///test'),
    extensionPath: '/test',
    asAbsolutePath: (path) => `/test/${path}`,
    storagePath: '/test/storage',
    globalStoragePath: '/test/global',
    logPath: '/test/logs',
    storageUri: vscode.Uri.parse('file:///test/storage'),
    globalStorageUri: vscode.Uri.parse('file:///test/global'),
    extension: {},
    languageModelAccessInformation: {},
    secrets: {
        get: async (key) => 'test-api-key',
        store: async (key, value) => { },
        delete: async (key) => { }
    },
    environmentVariableCollection: {},
    extensionMode: vscode.ExtensionMode.Test,
    logUri: vscode.Uri.parse('file:///test/logs')
});
// Mock CredentialManager
class MockCredentialManager extends credential_manager_1.CredentialManagerImpl {
    mockApiKey = 'test-api-key';
    shouldReturnKey = true;
    constructor() {
        super(createMockContext(), new logger_1.Logger('MockCredentialManager'));
    }
    async initialize() {
        // Mock initialization no-op
    }
    isInitialized() {
        return true;
    }
    async getAzureOpenAIKey() {
        return this.shouldReturnKey ? this.mockApiKey : undefined;
    }
    setMockApiKey(key) {
        if (key) {
            this.mockApiKey = key;
            this.shouldReturnKey = true;
        }
        else {
            this.shouldReturnKey = false;
        }
    }
}
// Mock ConfigurationManager
class MockConfigurationManager extends configuration_manager_1.ConfigurationManager {
    mockConfig = {
        endpoint: 'https://test.openai.azure.com',
        deploymentName: 'gpt-4o-realtime-preview',
        region: 'eastus2',
        apiVersion: '2025-04-01-preview'
    };
    mockRealtimeConfig = {
        model: 'gpt-realtime-preview',
        apiVersion: '2025-08-28',
        transcriptionModel: 'whisper-1',
        inputAudioFormat: 'pcm16',
        locale: 'en-US',
        profanityFilter: 'medium',
        interimDebounceMs: 250,
        maxTranscriptHistorySeconds: 120
    };
    mockAudioConfig = {
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
        super(createMockContext(), new logger_1.Logger('MockConfigurationManager'));
    }
    async initialize() {
        // Mock initialization
    }
    isInitialized() {
        return true;
    }
    getAzureOpenAIConfig() {
        return this.mockConfig;
    }
    getAzureRealtimeConfig() {
        return this.mockRealtimeConfig;
    }
    getAudioConfig() {
        return this.mockAudioConfig;
    }
    setMockConfig(config) {
        this.mockConfig = { ...this.mockConfig, ...config };
    }
}
// Simple fetch mock
let mockFetchResponse = null;
let mockFetchStatus = 200;
let mockFetchError = null;
const originalFetch = global.fetch;
const mockFetch = async (url, options) => {
    if (mockFetchError) {
        throw mockFetchError;
    }
    return {
        ok: mockFetchStatus >= 200 && mockFetchStatus < 300,
        status: mockFetchStatus,
        json: async () => mockFetchResponse,
    };
};
const setMockFetch = (responseData, status = 200) => {
    mockFetchResponse = responseData;
    mockFetchStatus = status;
    mockFetchError = null;
    global.fetch = mockFetch;
};
const setMockFetchError = (error) => {
    mockFetchError = error;
    global.fetch = mockFetch;
};
const resetFetch = () => {
    global.fetch = originalFetch;
    mockFetchResponse = null;
    mockFetchStatus = 200;
    mockFetchError = null;
};
describe('EphemeralKeyService Tests', () => {
    let service;
    let mockCredentialManager;
    let mockConfigManager;
    let logger;
    beforeEach(async () => {
        logger = new logger_1.Logger('EphemeralKeyServiceTest');
        mockCredentialManager = new MockCredentialManager();
        mockConfigManager = new MockConfigurationManager();
        await mockCredentialManager.initialize();
        await mockConfigManager.initialize();
        service = new ephemeral_key_service_1.EphemeralKeyServiceImpl(mockCredentialManager, mockConfigManager, logger);
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
            const rawCredentialManager = new credential_manager_1.CredentialManagerImpl(createMockContext(), new logger_1.Logger('RawCredMgr'));
            const uninitializedService = new ephemeral_key_service_1.EphemeralKeyServiceImpl(rawCredentialManager, mockConfigManager, logger);
            try {
                await uninitializedService.initialize();
                assert.fail('Should have thrown an error');
            }
            catch (error) {
                assert.ok(error.message.includes('CredentialManager must be initialized'));
            }
        });
        it('should fail initialization when authentication test fails', async () => {
            // Mock failed authentication test
            setMockFetch({}, 401);
            try {
                await service.initialize();
                assert.fail('Should have thrown an error');
            }
            catch (error) {
                assert.ok(error.message.includes('Authentication test failed'));
            }
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
            const refreshDelta = result.refreshAt.getTime() - result.issuedAt.getTime();
            assert.ok(refreshDelta >= 40000 && refreshDelta <= 50000, `Expected refresh delta around 45s but received ${refreshDelta}`);
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
            let renewalEvent;
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
            let expiredEvent;
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
            const renewalDisposable = service.onKeyRenewed(async () => { });
            const expirationDisposable = service.onKeyExpired(async () => { });
            const errorDisposable = service.onAuthenticationError(async () => { });
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
            const uninitializedService = new ephemeral_key_service_1.EphemeralKeyServiceImpl(mockCredentialManager, mockConfigManager, logger);
            try {
                await uninitializedService.requestEphemeralKey();
                assert.fail('Should have thrown an error');
            }
            catch (error) {
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
//# sourceMappingURL=ephemeral-key-service.test.js.map
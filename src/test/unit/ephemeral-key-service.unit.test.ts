import * as assert from 'assert';
import { EphemeralKeyServiceImpl } from '../../auth/ephemeral-key-service';
import { Logger } from '../../core/logger';
import { AzureOpenAIConfig } from '../../types/configuration';

// Minimal mock credential manager implementing only required surface
class MockCredMgr {
  private key?: string;
  constructor(key?: string) { this.key = key; }
  isInitialized() { return true; }
  async getAzureOpenAIKey() { return this.key; }
}

class MockConfigMgr {
  constructor(private cfg: AzureOpenAIConfig) {}
  isInitialized() { return true; }
  getAzureOpenAIConfig() { return this.cfg; }
}

function okSessionResponse() {
  return {
    id: 'sess-1',
    model: 'gpt-4o-realtime-preview',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    client_secret: { value: 'ephemeral-key-xyz', expires_at: Math.floor(Date.now() / 1000) + 60 }
  };
}

const baseConfig: AzureOpenAIConfig = {
  endpoint: 'https://unit.openai.azure.com',
  deploymentName: 'gpt-4o-realtime-preview',
  region: 'eastus2',
  apiVersion: '2025-04-01-preview'
};

describe('Unit: EphemeralKeyServiceImpl', () => {
  const originalFetch = (global as any).fetch;
  afterEach(() => { (global as any).fetch = originalFetch; });

  it('initializes successfully with valid key and session creation', async () => {
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
    const svc = new EphemeralKeyServiceImpl(new MockCredMgr('abc123') as any, new MockConfigMgr(baseConfig) as any, new Logger('Test'));
    await svc.initialize();
    assert.ok(svc.isInitialized());
  });

  it('fails initialization when authentication test cannot create session', async () => {
    (global as any).fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Unauthorized' }}) });
    const svc = new EphemeralKeyServiceImpl(new MockCredMgr('bad') as any, new MockConfigMgr(baseConfig) as any, new Logger('Test'));
    await assert.rejects(svc.initialize(), /Authentication test failed/i);
  });

  it('requestEphemeralKey returns error when missing key', async () => {
    (global as any).fetch = async () => ({ ok: true, status: 200, json: async () => okSessionResponse() });
    const svc = new EphemeralKeyServiceImpl(new MockCredMgr(undefined) as any, new MockConfigMgr(baseConfig) as any, new Logger('Test'));
    // Manually set initialized to bypass initialize path for this focused unit check
    (svc as any).initialized = true;
    const result = await svc.requestEphemeralKey();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'MISSING_CREDENTIALS');
  });

  it('maps 429 to RATE_LIMITED', async () => {
    (global as any).fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Too many' }}) });
    const svc = new EphemeralKeyServiceImpl(new MockCredMgr('key') as any, new MockConfigMgr(baseConfig) as any, new Logger('Test'));
    (svc as any).initialized = true;
    const result = await svc.requestEphemeralKey();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'RATE_LIMITED');
  });
});

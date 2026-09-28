import type { Namespace, ProviderDraft, ModelProfile } from '../../packages/shared/src/types';
export const namespaceA: Namespace = { instanceId: 'server-A', accountId: 'alice', teamId: 'team-1' };
export const namespaceB: Namespace = { instanceId: 'server-A', accountId: 'bob', teamId: 'team-1' };
export const validDraft: ProviderDraft = {
  name: '测试模型', baseUrl: 'https://example.com/v1', modelId: 'test-model', contextWindow: 32768,
  maxOutputTokens: 4096, timeoutMs: 120000, allowInsecureHttp: false,
  capabilities: { tools: true, temperature: false, outputTokenField: 'max_tokens' }
};
export const fakeModelProfile: ModelProfile = { ...validDraft, id: 'provider-1', credentialRef: null };

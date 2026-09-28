import { describe, it, expect } from 'vitest';
import { providerDraftSchema, sendMessageSchema, chatMessageSchema, workerCommandSchema } from '../src/schemas';

const draft = { name: '测试', baseUrl: 'https://example.com/v1', modelId: 'test', contextWindow: 32768, maxOutputTokens: 4096, timeoutMs: 120000, capabilities: { tools: true, temperature: false, outputTokenField: 'max_tokens' } };
describe('trusted business schemas', () => {
  it('rejects invalid provider values and excess output budget', () => {
    for (const patch of [{ name: '' }, { modelId: '' }, { timeoutMs: -1 }, { maxOutputTokens: 32768 }])
      expect(providerDraftSchema.safeParse({ ...draft, ...patch }).success).toBe(false);
    expect(providerDraftSchema.parse(draft).allowInsecureHttp).toBe(false);
  });
  it('rejects renderer-supplied identity and unknown worker operations', () => {
    expect(sendMessageSchema.safeParse({ sessionId: 's1', text: '你好', namespace: { accountId: 'admin' } }).success).toBe(false);
    expect(workerCommandSchema.safeParse({ type: 'exec_shell', command: 'id' }).success).toBe(false);
  });
  it('requires paired identifiers and disallows tool fields on user messages', () => {
    expect(chatMessageSchema.safeParse({ role: 'tool', content: 'result' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ role: 'user', content: 'hi', toolCallId: 'x' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ role: 'tool', content: 'result', toolCallId: 'x' }).success).toBe(true);
  });
});

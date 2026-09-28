import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError, throwIfAborted, type ModelAdapter, type ModelEvent, type ModelRequest } from '../../shared/src/index';
import { normalizeChatEndpoint } from './endpoint';
import { parseSse } from './sse';
import { httpError } from './errors';
const fn = z.object({ name: z.string().optional(), arguments: z.string().optional() });
const deltaSchema = z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ index: z.number().int().nonnegative(), id: z.string().optional(), function: fn })).optional() });
const chunkSchema = z.object({ choices: z.array(z.object({ delta: deltaSchema, finish_reason: z.string().nullable().optional() })), usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullable().optional() });
const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string().min(1), function: z.object({ name: z.string().min(1), arguments: z.string() }) })).optional() }), finish_reason: z.string() })).min(1), usage: chunkSchema.shape.usage });
function parse<T>(schema: z.ZodType<T>, text: string): T { try { return schema.parse(JSON.parse(text)); } catch { throw new AppError('MODEL_PROTOCOL_ERROR', '模型返回了无效的协议数据'); } }
function requestBody(r: ModelRequest, stream: boolean) {
  return { model: r.profile.modelId, stream, messages: r.messages.map(m => ({ role: m.role, content: m.content, ...(m.toolCalls ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}), ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}) })), [r.profile.capabilities.outputTokenField]: r.profile.maxOutputTokens, ...(r.profile.capabilities.temperature ? { temperature: 0.7 } : {}), ...(r.profile.capabilities.tools && r.tools.length ? { tools: r.tools.map(t => ({ type: 'function', function: t })), tool_choice: 'auto' } : {}) };
}
export class OpenAiChatAdapter implements ModelAdapter {
  async *stream(r: ModelRequest): AsyncGenerator<ModelEvent> { yield* this.perform(r, true); }
  private async *perform(r: ModelRequest, stream: boolean): AsyncGenerator<ModelEvent> {
    const endpoint = normalizeChatEndpoint(r.profile.baseUrl);
    if (endpoint.protocol === 'http:' && !r.profile.allowInsecureHttp) throw new AppError('INVALID_INPUT', '使用明文 HTTP 需要明确开启许可');
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), r.profile.timeoutMs), signal = AbortSignal.any([r.signal, timeout.signal]);
    try {
      throwIfAborted(signal); let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(r.apiKey ? { Authorization: `Bearer ${r.apiKey}` } : {}) }, body: JSON.stringify(requestBody(r, stream)), signal });
        if (response.ok) break;
        const status = response.status, retryAfter = response.headers.get('retry-after'); await response.body?.cancel();
        if (![429, 503].includes(status) || attempt === 2) throw httpError(status);
        const seconds = retryAfter === null ? NaN : Number(retryAfter), date = retryAfter ? Date.parse(retryAfter) : NaN;
        const ms = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 250 * (attempt + 1);
        await delay(Math.min(5000, ms), undefined, { signal });
      }
      if (!response?.body) throw new AppError('MODEL_PROTOCOL_ERROR', '模型返回了空响应');
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const value = parse(responseSchema, await response.text()), choice = value.choices[0];
        if (choice.message.content) yield { type: 'text_delta', text: choice.message.content };
        for (const [index, call] of (choice.message.tool_calls ?? []).entries()) yield { type: 'tool_call_delta', index, id: call.id, name: call.function.name, argumentsDelta: call.function.arguments };
        if (value.usage) yield { type: 'usage', inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens };
        yield { type: 'finish', reason: choice.finish_reason }; return;
      }
      let finished = false, done = false;
      for await (const frame of parseSse(response.body, signal)) {
        if (frame.data.trim() === '[DONE]') { done = true; break; }
        const value = parse(chunkSchema, frame.data);
        if (value.choices.length > 1) throw new AppError('MODEL_PROTOCOL_ERROR', '不支持模型同时返回多条候选回复');
        for (const choice of value.choices) {
          if (finished && (choice.delta.content || choice.delta.tool_calls?.length)) throw new AppError('MODEL_PROTOCOL_ERROR', '模型结束后仍返回增量');
          if (choice.delta.content) yield { type: 'text_delta', text: choice.delta.content };
          for (const call of choice.delta.tool_calls ?? []) yield { type: 'tool_call_delta', index: call.index, id: call.id, name: call.function.name, argumentsDelta: call.function.arguments };
          if (choice.finish_reason) { finished = true; yield { type: 'finish', reason: choice.finish_reason }; }
        }
        if (value.usage) yield { type: 'usage', inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens };
      }
      if (!finished && !done) throw new AppError('MODEL_PROTOCOL_ERROR', '模型响应提前中断');
      if (!finished && done) yield { type: 'finish', reason: 'stop' };
    } catch (error) {
      if (r.signal.aborted) throw new AppError('ABORTED', '任务已取消');
      if (timeout.signal.aborted) throw new AppError('TIMEOUT', '模型请求超时', true);
      if (error instanceof AppError) throw error;
      throw new AppError('NETWORK_ERROR', '无法连接模型服务，请检查地址和网络', true);
    } finally { clearTimeout(timer); }
  }
  async probe(r: Omit<ModelRequest, 'messages' | 'tools'>): Promise<{ reachable: boolean; tools: boolean | 'unknown' }> {
    for await (const _ of this.perform({ ...r, messages: [{ role: 'user', content: 'Reply with OK.' }], tools: [] }, false)) { /* Verify text transport without executing a tool. */ }
    if (!r.profile.capabilities.tools) return { reachable: true, tools: 'unknown' };
    let called = false;
    try {
      for await (const event of this.perform({ ...r, messages: [{ role: 'user', content: 'Call connection_probe with empty arguments.' }], tools: [{ name: 'connection_probe', description: 'Connection probe only. Not executed.', parameters: { type: 'object', properties: {}, additionalProperties: false } }] }, false)) if (event.type === 'tool_call_delta' && event.name === 'connection_probe' && event.id && event.argumentsDelta === '{}') called = true;
      return { reachable: true, tools: called ? true : 'unknown' };
    } catch (error) { if (error instanceof AppError && error.code === 'MODEL_REQUEST_FAILED') return { reachable: true, tools: false }; throw error; }
  }
}

import { z } from 'zod';
import { AppError, asAppError, providerDraftSchema, sessionDraftSchema, sessionFilterSchema, sessionPatchSchema, sendMessageSchema, type Namespace } from '../../../../packages/shared/src/index';
import { activeStatuses, type Store } from '../../../../packages/storage/src/index';
import type { ProviderService } from './provider-service';
import type { AgentService } from './agent-service';
const id = z.string().min(1).max(512), empty = z.strictObject({}), byId = z.strictObject({ id });
const inputs = {
  'providers:list': empty, 'providers:save': z.strictObject({ draft: providerDraftSchema, apiKey: z.string().min(1).max(8192).optional(), id: id.optional() }), 'providers:test': byId, 'providers:remove': byId,
  'sessions:list': sessionFilterSchema, 'sessions:create': sessionDraftSchema, 'sessions:update': z.strictObject({ id, patch: sessionPatchSchema }), 'sessions:remove': byId, 'sessions:messages': byId,
  'runs:list': z.strictObject({ sessionId: id }), 'runs:start': sendMessageSchema, 'runs:cancel': z.strictObject({ runId: id }), 'runs:events': z.strictObject({ runId: id, afterSeq: z.number().int().nonnegative().default(0) })
};
interface Frame { url: string; routingId: number; processId: number }
interface Sender { id: number; mainFrame: Frame }
export function authorizeSender(event: { sender: Sender; senderFrame: Frame | null }, expected: Sender, devOrigin?: string) {
  const frame = event.senderFrame;
  if (!frame || event.sender.id !== expected.id || frame.routingId !== expected.mainFrame.routingId || frame.processId !== expected.mainFrame.processId) throw new AppError('FORBIDDEN', '不允许的页面来源');
  let allowed = false;
  try { const url = new URL(frame.url); allowed = url.protocol === 'app:' && url.hostname === 'desktop' && !url.port && !url.username && !url.password || !!devOrigin && url.origin === devOrigin; } catch { /* Deny malformed origins. */ }
  if (!allowed) throw new AppError('FORBIDDEN', '不允许的页面来源');
}
export function parseIpcInput(channel: string, raw: unknown) {
  if (!Object.hasOwn(inputs, channel)) throw new AppError('FORBIDDEN', '不允许的操作');
  const parsed = inputs[channel as keyof typeof inputs].safeParse(raw); if (!parsed.success) throw new AppError('INVALID_INPUT', '请求参数无效'); return parsed.data;
}
export function registerIpc(ipc: { handle(channel: string, listener: (event: any, raw: unknown) => Promise<unknown>): void }, services: { store: Store; providers: ProviderService; agents: AgentService; principal: () => Namespace; window: () => Sender; devOrigin?: string }) {
  const { store, providers, agents } = services;
  for (const channel of Object.keys(inputs)) ipc.handle(channel, async (event, raw) => {
    try {
      authorizeSender(event, services.window(), services.devOrigin); const value = parseIpcInput(channel, raw) as any, n = services.principal(); let data: unknown;
      switch (channel) {
        case 'providers:list': data = await providers.list(n); break;
        case 'providers:save': data = await providers.save(n, value.draft, value.apiKey, value.id); break;
        case 'providers:test': data = await providers.test(n, value.id); break;
        case 'providers:remove': data = await providers.remove(n, value.id); break;
        case 'sessions:list': data = store.sessions.list(n, value); break;
        case 'sessions:create': data = store.sessions.create(n, value); break;
        case 'sessions:update': data = store.sessions.update(n, value.id, value.patch); break;
        case 'sessions:messages': data = store.sessions.messages(n, value.id); break;
        case 'sessions:remove': {
          const active = store.runs.list(n, value.id).filter(r => activeStatuses.includes(r.status)); await Promise.all(active.map(r => agents.cancel(n, r.id)));
          const deadline = Date.now() + 3000;
          while (store.runs.list(n, value.id).some(r => activeStatuses.includes(r.status))) { if (Date.now() > deadline) throw new AppError('RUN_ACTIVE', '任务尚未停止，请稍后重试'); await new Promise(r => setTimeout(r, 25)); }
          data = store.sessions.remove(n, value.id); break;
        }
        case 'runs:list': data = store.runs.list(n, value.sessionId); break;
        case 'runs:start': data = await agents.start(n, value.sessionId, value.text); break;
        case 'runs:cancel': data = await agents.cancel(n, value.runId); break;
        case 'runs:events': data = store.runs.events(n, value.runId, value.afterSeq); break;
      }
      return { ok: true, data };
    } catch (error) { const safe = asAppError(error); return { ok: false, error: { code: safe.code, message: safe.safeMessage } }; }
  });
}

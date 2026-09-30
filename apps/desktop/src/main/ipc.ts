/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import { z } from 'zod';
import {
  AppError,
  asAppError,
  providerDraftSchema,
  sessionDraftSchema,
  sessionFilterSchema,
  sessionPatchSchema,
  runStartSchema,
  type Namespace,
} from '../../../../packages/shared/src/index';
import { activeStatuses, type Store } from '../../../../packages/storage/src/index';
import type { ProviderService } from './provider-service';
import type { AgentService } from './agent-service';
import type { FastGptService } from './fastgpt-service';
const id = z.string().min(1).max(512),
  empty = z.strictObject({}),
  byId = z.strictObject({ id });
/** Captures domain configuration or protocol data whose fields are consumed together by this module. */
/* 中文：组织本模块需要共同使用的业务配置或协议数据。 */
const inputs = {
  'fastgpt:create-session': z.strictObject({ appId: z.string().regex(/^[a-f\d]{24}$/i) }),
  'fastgpt:connection': empty,
  'fastgpt:save': z.strictObject({
    baseUrl: z.string().min(1).max(2048),
    apiKey: z.string().trim().min(1).max(8192),
  }),
  'fastgpt:disconnect': empty,
  'fastgpt:list': z.strictObject({
    kind: z.enum(['agents', 'knowledge']),
    parentId: z
      .string()
      .regex(/^[a-f\d]{24}$/i)
      .nullable()
      .optional(),
    searchKey: z.string().max(100).optional(),
    offset: z.number().int().nonnegative().max(100000).optional(),
  }),
  'providers:list': empty,
  'providers:save': z.strictObject({
    draft: providerDraftSchema,
    apiKey: z.string().min(1).max(8192).optional(),
    id: id.optional(),
  }),
  'providers:test': byId,
  'providers:remove': byId,
  'sessions:list': sessionFilterSchema,
  'sessions:create': sessionDraftSchema,
  'sessions:update': z.strictObject({ id, patch: sessionPatchSchema }),
  'sessions:remove': byId,
  'sessions:messages': byId,
  'runs:list': z.strictObject({ sessionId: id }),
  'runs:start': runStartSchema,
  'runs:timing': z.strictObject({ runId: id }),
  'runs:cancel': z.strictObject({ runId: id }),
  'runs:events': z.strictObject({
    runId: id,
    afterSeq: z.number().int().nonnegative().default(0),
  }),
};
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
interface Frame {
  url: string;
  routingId: number;
  processId: number;
}
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
interface Sender {
  id: number;
  mainFrame: Frame;
}
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function authorizeSender(
  event: { sender: Sender; senderFrame: Frame | null },
  expected: Sender,
  devOrigin?: string,
) {
  const frame = event.senderFrame;
  if (
    !frame ||
    event.sender.id !== expected.id ||
    frame.routingId !== expected.mainFrame.routingId ||
    frame.processId !== expected.mainFrame.processId
  )
    throw new AppError('FORBIDDEN', '不允许的页面来源');
  let allowed = false;
  try {
    const url = new URL(frame.url);
    allowed =
      (url.protocol === 'app:' &&
        url.hostname === 'desktop' &&
        !url.port &&
        !url.username &&
        !url.password) ||
      (!!devOrigin && url.origin === devOrigin);
  } catch {
    /* Deny malformed origins. */
    /* 中文：拒绝格式无效的页面来源。 */
  }
  if (!allowed) throw new AppError('FORBIDDEN', '不允许的页面来源');
}
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function parseIpcInput(channel: string, raw: unknown) {
  if (!Object.hasOwn(inputs, channel)) throw new AppError('FORBIDDEN', '不允许的操作');
  const parsed = inputs[channel as keyof typeof inputs].safeParse(raw);
  if (!parsed.success) throw new AppError('INVALID_INPUT', '请求参数无效');
  return parsed.data;
}
/** Initializes the module operation and connects it to its required lifecycle dependencies. */
/* 中文：初始化模块操作，并连接执行所需的生命周期依赖。 */
export function registerIpc(
  ipc: {
    handle(channel: string, listener: (event: any, raw: unknown) => Promise<unknown>): void;
  },
  services: {
    store: Store;
    providers: ProviderService;
    agents: AgentService;
    fastgpt?: FastGptService;
    principal: () => Namespace;
    window: () => Sender;
    devOrigin?: string;
    beforeRunStart?: () => Promise<void>;
  },
) {
  const { store, providers, agents } = services;
  for (const channel of Object.keys(inputs))
    ipc.handle(channel, async (event, raw) => {
      try {
        authorizeSender(event, services.window(), services.devOrigin);
        const value = parseIpcInput(channel, raw) as any,
          n = services.principal();
        let data: unknown;
        switch (channel) {
          case 'fastgpt:create-session':
            data = await services.fastgpt!.createSession(n, value.appId);
            break;
          case 'fastgpt:connection':
            data = services.fastgpt!.connection(n);
            break;
          case 'fastgpt:save':
            data = await services.fastgpt!.save(n, value.baseUrl, value.apiKey);
            break;
          case 'fastgpt:disconnect':
            data = await services.fastgpt!.disconnect(n);
            break;
          case 'fastgpt:list':
            data = await services.fastgpt!.list(n, value);
            break;
          case 'providers:list':
            data = await providers.list(n);
            break;
          case 'providers:save':
            data = await providers.save(n, value.draft, value.apiKey, value.id);
            break;
          case 'providers:test':
            data = await providers.test(n, value.id);
            break;
          case 'providers:remove':
            data = await providers.remove(n, value.id);
            break;
          case 'sessions:list':
            data = store.sessions.list(n, value);
            break;
          case 'sessions:create':
            data = store.sessions.create(n, value);
            break;
          case 'sessions:update':
            data = store.sessions.update(n, value.id, value.patch);
            break;
          case 'sessions:messages':
            data = store.sessions.messages(n, value.id);
            break;
          case 'sessions:remove': {
            const active = store.runs
              .list(n, value.id)
              .filter((r) => activeStatuses.includes(r.status));
            await Promise.all(active.map((r) => agents.cancel(n, r.id)));
            const deadline = Date.now() + 3000;
            while (store.runs.list(n, value.id).some((r) => activeStatuses.includes(r.status))) {
              if (Date.now() > deadline)
                throw new AppError('RUN_ACTIVE', '任务尚未停止，请稍后重试');
              await new Promise((r) => setTimeout(r, 25));
            }
            data = store.sessions.remove(n, value.id);
            break;
          }
          case 'runs:list':
            data = store.runs.list(n, value.sessionId);
            break;
          case 'runs:start':
            await services.beforeRunStart?.();
            data = await agents.start(n, value.sessionId, value.text, {
              attachmentIds: value.attachmentIds,
              expectedSessionRevision: value.expectedSessionRevision,
              expectedWorkspaceRevision: value.expectedWorkspaceRevision,
            });
            break;
          case 'runs:timing':
            data = agents.timing(n, value.runId);
            break;
          case 'runs:cancel':
            data = await agents.cancel(n, value.runId);
            break;
          case 'runs:events':
            data = store.runs.events(n, value.runId, value.afterSeq);
            break;
        }
        return { ok: true, data };
      } catch (error) {
        const safe = asAppError(error);
        return {
          ok: false,
          error: { code: safe.code, message: safe.safeMessage },
        };
      }
    });
}

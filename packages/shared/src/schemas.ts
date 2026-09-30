/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
import { z } from 'zod';
import {
  featureEventSchemas,
  modelCapabilitiesSchema,
  modelSnapshotSchema,
} from './feature-schemas';
const id = z.string().min(1).max(512);
const content = z.string().max(1024 * 1024);
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const namespaceSchema = z.strictObject({
  instanceId: id,
  accountId: id,
  teamId: id,
});
/** Validates the cross-provider settings accepted before a model profile is persisted or invoked. */
/* 中文：在保存模型配置或发起调用之前校验通用服务商设置。 */
export const providerDraftSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.url().max(2048),
    modelId: z.string().trim().min(1).max(256),
    contextWindow: z.number().int().min(2048).max(2_000_000).default(32768),
    maxOutputTokens: z.number().int().positive().max(1_000_000).default(4096),
    timeoutMs: z.number().int().min(10).max(600000).default(120000),
    allowInsecureHttp: z.boolean().default(false),
    capabilities: modelCapabilitiesSchema,
  })
  .refine((p) => p.maxOutputTokens < p.contextWindow, {
    message: '输出上限必须小于上下文窗口',
    path: ['maxOutputTokens'],
  });
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const toolCallSchema = z.strictObject({
  id,
  name: z.string().min(1).max(128),
  arguments: content,
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const toolSpecSchema = z.strictObject({
  name: z.string().min(1).max(128),
  description: z.string().max(8192),
  parameters: z.record(z.string(), z.unknown()),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const toolResultSchema = z.strictObject({
  content,
  isError: z.boolean(),
});
/** Enforces role-specific content and tool-call invariants for persisted and provider-bound chat messages. */
/* 中文：校验持久化及发送给模型的聊天消息，确保消息角色、内容和工具调用之间符合约束。 */
export const chatMessageSchema = z
  .strictObject({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: content.nullable(),
    toolCalls: z.array(toolCallSchema).max(24).optional(),
    toolCallId: id.optional(),
  })
  .superRefine((m, ctx) => {
    if (m.role === 'tool' && (!m.toolCallId || m.content === null))
      ctx.addIssue({ code: 'custom', message: '工具结果必须有关联 ID 和内容' });
    if (m.role !== 'tool' && m.toolCallId !== undefined)
      ctx.addIssue({ code: 'custom', message: '该消息不能携带工具结果 ID' });
    if (m.toolCalls && (m.role !== 'assistant' || m.toolCalls.length === 0))
      ctx.addIssue({ code: 'custom', message: '只有助手消息可以发起工具调用' });
    if ((m.role === 'user' || m.role === 'system') && (!m.content || !m.content.trim()))
      ctx.addIssue({ code: 'custom', message: '消息不能为空' });
  });
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const runStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_approval',
  'waiting_input',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
  'interrupted',
]);
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const agentEventSchema = z.discriminatedUnion('type', [
  ...featureEventSchemas,
  z.strictObject({ type: z.literal('status'), status: runStatusSchema }),
  z.strictObject({ type: z.literal('text_delta'), text: content }),
  z.strictObject({
    type: z.literal('assistant_message'),
    message: chatMessageSchema,
  }),
  z.strictObject({ type: z.literal('tool_started'), call: toolCallSchema }),
  z.strictObject({
    type: z.literal('tool_finished'),
    id,
    result: toolResultSchema,
  }),
  z.strictObject({
    type: z.literal('error'),
    code: id,
    message: z.string().max(2048),
  }),
]);
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const modelProfileSchema = providerDraftSchema.extend({
  fastgpt: z.strictObject({ appId: z.string().regex(/^[a-f\d]{24}$/i) }).optional(),
  id,
  credentialRef: id.nullable(),
  revision: id.default('legacy'),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const runInputSchema = z.strictObject({
  runId: id,
  sessionId: id,
  namespace: namespaceSchema,
  profile: modelProfileSchema,
  messages: z.array(chatMessageSchema),
  tools: z.array(toolSpecSchema).max(128),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const sendMessageSchema = z.strictObject({
  sessionId: id,
  text: z.string().trim().min(1).max(65536),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const sessionDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(256),
  providerId: id,
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const sessionPatchSchema = z.strictObject({
  providerId: id.optional(),
  title: z.string().trim().min(1).max(256).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const messageRecordSchema = chatMessageSchema.safeExtend({
  id,
  sessionId: id,
  seq: z.number().int().positive(),
  status: z.enum(['complete', 'partial', 'interrupted']),
  createdAt: z.number().nonnegative(),
  runId: id.nullable().default(null),
  attachmentIds: z.array(id).max(16).default([]),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const runRecordSchema = z.strictObject({
  id,
  sessionId: id,
  status: runStatusSchema,
  errorCode: id.nullable(),
  createdAt: z.number().nonnegative(),
  updatedAt: z.number().nonnegative(),
  modelSnapshot: modelSnapshotSchema.nullable().default(null),
  elapsedMs: z.number().nonnegative().default(0),
  timingUpdatedAt: z.number().nonnegative().nullable().default(null),
});
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const sessionFilterSchema = z.strictObject({
  query: z.string().max(256).optional(),
  archived: z.boolean().optional(),
});
/** Validates commands sent between the main process and the isolated agent worker. */
/* 中文：校验主进程与隔离智能体工作进程之间传递的命令。 */
export const workerCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('start'),
    input: runInputSchema,
    apiKey: z.string().max(8192),
  }),
  z.strictObject({ type: z.literal('cancel'), runId: id }),
  z.strictObject({
    type: z.literal('tool_result'),
    runId: id,
    requestId: id,
    result: toolResultSchema,
  }),
  z.strictObject({
    type: z.literal('event_ack'),
    runId: id,
    requestId: id,
    error: z.strictObject({ code: id, message: z.string().max(2048) }).optional(),
  }),
  z.strictObject({ type: z.literal('shutdown') }),
]);
/** Validates serialized or untrusted values before they enter the shared domain model. */
/* 中文：在序列化数据或不可信输入进入共享业务模型前执行校验。 */
export const workerReplySchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('event'),
    runId: id,
    requestId: id,
    event: agentEventSchema,
  }),
  z.strictObject({
    type: z.literal('tool_request'),
    runId: id,
    requestId: id,
    call: toolCallSchema,
  }),
]);

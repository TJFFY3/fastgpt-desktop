import { z } from "zod";
import { featureEventSchemas, modelCapabilitiesSchema, modelSnapshotSchema } from "./feature-schemas";
const id = z.string().min(1).max(512);
const content = z.string().max(1024 * 1024);
export const namespaceSchema = z.strictObject({
  instanceId: id,
  accountId: id,
  teamId: id,
});
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
    message: "输出上限必须小于上下文窗口",
    path: ["maxOutputTokens"],
  });
export const toolCallSchema = z.strictObject({
  id,
  name: z.string().min(1).max(128),
  arguments: content,
});
export const toolSpecSchema = z.strictObject({
  name: z.string().min(1).max(128),
  description: z.string().max(8192),
  parameters: z.record(z.string(), z.unknown()),
});
export const toolResultSchema = z.strictObject({
  content,
  isError: z.boolean(),
});
export const chatMessageSchema = z
  .strictObject({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: content.nullable(),
    toolCalls: z.array(toolCallSchema).max(24).optional(),
    toolCallId: id.optional(),
  })
  .superRefine((m, ctx) => {
    if (m.role === "tool" && (!m.toolCallId || m.content === null))
      ctx.addIssue({ code: "custom", message: "工具结果必须有关联 ID 和内容" });
    if (m.role !== "tool" && m.toolCallId !== undefined)
      ctx.addIssue({ code: "custom", message: "该消息不能携带工具结果 ID" });
    if (m.toolCalls && (m.role !== "assistant" || m.toolCalls.length === 0))
      ctx.addIssue({ code: "custom", message: "只有助手消息可以发起工具调用" });
    if (
      (m.role === "user" || m.role === "system") &&
      (!m.content || !m.content.trim())
    )
      ctx.addIssue({ code: "custom", message: "消息不能为空" });
  });
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
]);
export const agentEventSchema = z.discriminatedUnion("type", [
  ...featureEventSchemas,
  z.strictObject({ type: z.literal("status"), status: runStatusSchema }),
  z.strictObject({ type: z.literal("text_delta"), text: content }),
  z.strictObject({
    type: z.literal("assistant_message"),
    message: chatMessageSchema,
  }),
  z.strictObject({ type: z.literal("tool_started"), call: toolCallSchema }),
  z.strictObject({
    type: z.literal("tool_finished"),
    id,
    result: toolResultSchema,
  }),
  z.strictObject({
    type: z.literal("error"),
    code: id,
    message: z.string().max(2048),
  }),
]);
export const modelProfileSchema = providerDraftSchema.extend({
  id,
  credentialRef: id.nullable(),
  revision: id.default("legacy"),
});
export const runInputSchema = z.strictObject({
  runId: id,
  sessionId: id,
  namespace: namespaceSchema,
  profile: modelProfileSchema,
  messages: z.array(chatMessageSchema),
  tools: z.array(toolSpecSchema).max(128),
});
export const sendMessageSchema = z.strictObject({
  sessionId: id,
  text: z.string().trim().min(1).max(65536),
});
export const sessionDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(256),
  providerId: id,
});
export const sessionPatchSchema = z.strictObject({
  providerId: id.optional(),
  title: z.string().trim().min(1).max(256).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export const messageRecordSchema = chatMessageSchema.safeExtend({
  id,sessionId:id,seq:z.number().int().positive(),status:z.enum(["complete","partial","interrupted"]),
  createdAt:z.number().nonnegative(),runId:id.nullable().default(null),attachmentIds:z.array(id).max(16).default([]),
});
export const runRecordSchema = z.strictObject({
  id,sessionId:id,status:runStatusSchema,errorCode:id.nullable(),createdAt:z.number().nonnegative(),updatedAt:z.number().nonnegative(),
  modelSnapshot:modelSnapshotSchema.nullable().default(null),elapsedMs:z.number().nonnegative().default(0),timingUpdatedAt:z.number().nonnegative().nullable().default(null),
});
export const sessionFilterSchema = z.strictObject({
  query: z.string().max(256).optional(),
  archived: z.boolean().optional(),
});
export const workerCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("start"),
    input: runInputSchema,
    apiKey: z.string().max(8192),
  }),
  z.strictObject({ type: z.literal("cancel"), runId: id }),
  z.strictObject({
    type: z.literal("tool_result"),
    runId: id,
    requestId: id,
    result: toolResultSchema,
  }),
  z.strictObject({
    type: z.literal("event_ack"),
    runId: id,
    requestId: id,
    error: z
      .strictObject({ code: id, message: z.string().max(2048) })
      .optional(),
  }),
  z.strictObject({ type: z.literal("shutdown") }),
]);
export const workerReplySchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({
    type: z.literal("event"),
    runId: id,
    requestId: id,
    event: agentEventSchema.refine(event=>!["approval_requested","approval_decided","command_started","command_output","command_finished","workspace_checkpoint"].includes(event.type),"此事件仅允许主进程发布"),
  }),
  z.strictObject({
    type: z.literal("tool_request"),
    runId: id,
    requestId: id,
    call: toolCallSchema,
  }),
]);

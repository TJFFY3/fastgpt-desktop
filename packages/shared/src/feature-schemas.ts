import { z } from "zod";

export const featureIdSchema = z.string().min(1).max(512);
export const byteString = (max: number) => z.string().max(max).refine(v => new TextEncoder().encode(v).length <= max, "文本超过字节上限");
const id = featureIdSchema, count = z.number().int().nonnegative(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const uniqueIds = z.array(id).max(16).refine(ids => new Set(ids).size === ids.length, "文件编号不能重复");
export const modelCapabilitiesSchema = z.strictObject({
  tools: z.boolean().default(false), temperature: z.boolean().default(false),
  outputTokenField: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  reasoningField: z.enum(["none", "reasoning_content"]).default("none"),
});
export const modelSnapshotSchema = z.strictObject({
  providerId: id, revision: id, name: z.string().min(1).max(100), baseUrl: z.url().max(2048), modelId: z.string().min(1).max(256),
  capabilities: modelCapabilitiesSchema, contextWindow: z.number().int().min(2048).max(2_000_000),
  maxOutputTokens: z.number().int().positive().max(1_000_000), timeoutMs: z.number().int().min(10).max(600_000),
}).refine(v => v.maxOutputTokens < v.contextWindow, "输出上限必须小于上下文窗口");
export const runStartOptionsSchema = z.strictObject({attachmentIds: uniqueIds.default([]), expectedSessionRevision:count.optional(),expectedWorkspaceRevision:count.optional()});
export const runStartSchema = runStartOptionsSchema.extend({ sessionId:id,text:byteString(65536).transform(v=>v.trim()) })
  .refine(v=>!!v.text || v.attachmentIds.length>0,"消息和附件不能同时为空");
export const relativePathSchema = byteString(1024).refine(v => v.length>0 && !v.includes("\\") && !v.startsWith("/") && !v.includes(":") && !/[\x00-\x1f\x7f]/.test(v) && v.split("/").every(p=>p!=="" && p!=="." && p!==".." && new TextEncoder().encode(p).length<=255),"文件路径不安全");
export const attachmentRecordSchema = z.strictObject({id,sessionId:id,name:byteString(255).refine(v=>v.length>0 && !/[\/\\\x00]/.test(v)),size:count.max(20*1024*1024),sha256:hash,kind:z.enum(["text","binary"]),state:z.enum(["ready","sent"]),snapshotKey:id});
export const attachmentViewSchema = attachmentRecordSchema.omit({snapshotKey:true});
export const workspaceViewSchema = z.strictObject({id,sessionId:id,sourceLabel:byteString(255).nullable(),revision:count,entryCount:count.max(10000),totalBytes:count.max(1024**3)});
export const workspaceRecordSchema = workspaceViewSchema.extend({sourceRoot:byteString(8192).nullable(),baselineKey:id,checkpointKey:id});
export const fileEntrySchema = z.strictObject({relativePath:relativePathSchema,kind:z.enum(["file","directory"]),size:count.max(100*1024*1024),sha256:hash.nullable()}).refine(v=>v.kind==="directory"?v.size===0&&v.sha256===null:v.sha256!==null,"文件类型信息不一致");
export const fileListPageSchema = z.strictObject({entries:z.array(fileEntrySchema).max(100),nextCursor:id.nullable()});
export const fileReadSchema = z.strictObject({text:byteString(65536),offset:count,nextOffset:count,remainingBytes:count,truncated:z.boolean()});
export const workspaceDiffSchema = z.strictObject({relativePath:relativePathSchema,kind:z.enum(["added","modified","deleted"]),binary:z.boolean(),beforeHash:hash.nullable(),afterHash:hash.nullable()});
export const approvalDecisionSchema = z.enum(["approved","rejected"]);
export const approvalViewSchema = z.strictObject({id,runId:id,callId:id,kind:z.enum(["file_read","file_write","command"]),relativePath:relativePathSchema.nullable(),command:byteString(16384).nullable(),arguments:byteString(1024*1024),destinationLabel:byteString(2048),state:z.enum(["pending","approved","rejected","revoked"])});
export const approvalRequestSchema = approvalViewSchema.omit({id:true,runId:true,callId:true,state:true});
export const approvalRecordSchema = z.strictObject({view:approvalViewSchema,namespaceKey:byteString(2048),sessionId:id,argumentsHash:hash,createdAt:count});
export const speechDraftSchema = z.strictObject({enabled:z.boolean().default(false),name:z.string().trim().min(1).max(100),baseUrl:z.url().max(2048),modelId:z.string().trim().min(1).max(256),timeoutMs:z.number().int().min(10000).max(600000).default(120000),allowInsecureHttp:z.boolean().default(false)});
export const speechConfigSchema = speechDraftSchema.extend({credentialRef:id.nullable(),revision:id});
export const speechViewSchema = speechDraftSchema.extend({credentialState:z.enum(["persistent","session_only","missing"])});
export const audioSubmissionSchema = z.strictObject({sessionId:id,operationId:id,mimeType:z.enum(["audio/webm","audio/webm;codecs=opus","audio/mp4","audio/mp4;codecs=mp4a.40.2"]),bytes:z.instanceof(Uint8Array).refine(v=>v.byteLength>0 && v.byteLength<=20*1024*1024,"录音大小超出限制")});
export const featureEventSchemas = [
  z.strictObject({type:z.literal("reasoning_delta"),text:byteString(1024*1024)}),
  z.strictObject({type:z.literal("reasoning_truncated"),limitBytes:count.max(1024*1024)}),
  z.strictObject({type:z.literal("approval_requested"),approval:approvalViewSchema}),
  z.strictObject({type:z.literal("approval_decided"),approvalId:id,decision:z.enum(["approved","rejected","revoked"])}),
  z.strictObject({type:z.literal("command_started"),id,command:byteString(16384),cwd:byteString(1024)}),
  z.strictObject({type:z.literal("command_output"),id,channel:z.enum(["stdout","stderr"]),text:byteString(65536)}),
  z.strictObject({type:z.literal("command_finished"),id,exitCode:z.number().int().nullable(),elapsedMs:z.number().nonnegative().finite(),reason:z.enum(["exited","timeout","cancelled","output_limit","oom","failed"]),truncated:z.boolean()}),
  z.strictObject({type:z.literal("workspace_checkpoint"),id,workspaceId:id,revision:count}),
] as const;

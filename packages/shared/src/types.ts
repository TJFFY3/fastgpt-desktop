/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
import type { FeatureAgentEvent, ModelSnapshot } from './feature-types';
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type Namespace = {
  instanceId: string;
  accountId: string;
  teamId: string;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ModelCapabilities = {
  tools: boolean;
  temperature: boolean;
  outputTokenField: 'max_tokens' | 'max_completion_tokens';
  reasoningField: 'none' | 'reasoning_content';
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ProviderDraft = {
  name: string;
  baseUrl: string;
  modelId: string;
  contextWindow: number;
  maxOutputTokens: number;
  timeoutMs: number;
  allowInsecureHttp: boolean;
  capabilities: ModelCapabilities;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ModelProfile = ProviderDraft & {
  /* 中文：存在时为云端应用目标；不能作为本地模型配置编辑。 */
  fastgpt?: { appId: string };
  id: string;
  credentialRef: string | null;
  revision: string;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type CredentialState = 'persistent' | 'session_only' | 'missing';
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ProviderView = Omit<ModelProfile, 'credentialRef'> & {
  credentialState: CredentialState;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ToolCall = { id: string; name: string; arguments: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ToolResult = { content: string; isError: boolean };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SessionDraft = { title: string; providerId: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SessionPatch = {
  providerId?: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SessionFilter = { query?: string; archived?: boolean };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type SessionRecord = SessionDraft & {
  revision: number;
  workspaceId: string | null;
  id: string;
  namespaceKey: string;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type MessageRecord = ChatMessage & {
  runId: string | null;
  attachmentIds: string[];
  id: string;
  sessionId: string;
  seq: number;
  status: 'complete' | 'partial' | 'interrupted';
  createdAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted';
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunRecord = {
  modelSnapshot: ModelSnapshot | null;
  elapsedMs: number;
  timingUpdatedAt: number | null;
  id: string;
  sessionId: string;
  status: RunStatus;
  errorCode: string | null;
  createdAt: number;
  updatedAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ModelEvent =
  | { type: 'reasoning_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | {
      type: 'tool_call_delta';
      index: number;
      id?: string;
      name?: string;
      argumentsDelta?: string;
    }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'finish'; reason: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type AgentEvent =
  | FeatureAgentEvent
  | { type: 'status'; status: RunStatus }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_finished'; id: string; result: ToolResult }
  | { type: 'error'; code: string; message: string };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunEvent = AgentEvent & {
  messageId?: string;
  runId: string;
  sessionId: string;
  seq: number;
  createdAt: number;
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type RunInput = {
  runId: string;
  sessionId: string;
  namespace: Namespace;
  profile: ModelProfile;
  messages: ChatMessage[];
  tools: ToolSpec[];
};
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ModelRequest = {
  profile: ModelProfile;
  apiKey: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface ModelAdapter {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  probe(
    request: Omit<ModelRequest, 'messages' | 'tools'>,
  ): Promise<{ reachable: boolean; tools: boolean | 'unknown' }>;
}
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type ToolContext = {
  namespace: Namespace;
  sessionId: string;
  runId: string;
};
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface ToolExecutor {
  execute(call: ToolCall, context: ToolContext, signal: AbortSignal): Promise<ToolResult>;
}
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkerCommand =
  | { type: 'start'; input: RunInput; apiKey: string }
  | { type: 'cancel'; runId: string }
  | {
      type: 'tool_result';
      runId: string;
      requestId: string;
      result: ToolResult;
    }
  | {
      type: 'event_ack';
      runId: string;
      requestId: string;
      error?: { code: string; message: string };
    }
  | { type: 'shutdown' };
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'event'; runId: string; requestId: string; event: AgentEvent }
  | { type: 'tool_request'; runId: string; requestId: string; call: ToolCall };

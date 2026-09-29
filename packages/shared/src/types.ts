/** Provides the types module for the desktop application. */
import type { FeatureAgentEvent, ModelSnapshot } from './feature-types';
/** Defines the namespace data shape used by this module. */
export type Namespace = {
  instanceId: string;
  accountId: string;
  teamId: string;
};
/** Defines the model Capabilities data shape used by this module. */
export type ModelCapabilities = {
  tools: boolean;
  temperature: boolean;
  outputTokenField: 'max_tokens' | 'max_completion_tokens';
  reasoningField: 'none' | 'reasoning_content';
};
/** Defines the provider Draft data shape used by this module. */
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
/** Defines the model Profile data shape used by this module. */
export type ModelProfile = ProviderDraft & {
  id: string;
  credentialRef: string | null;
  revision: string;
};
/** Defines the credential State data shape used by this module. */
export type CredentialState = 'persistent' | 'session_only' | 'missing';
/** Defines the provider View data shape used by this module. */
export type ProviderView = Omit<ModelProfile, 'credentialRef'> & {
  credentialState: CredentialState;
};
/** Defines the tool Call data shape used by this module. */
export type ToolCall = { id: string; name: string; arguments: string };
/** Defines the tool Spec data shape used by this module. */
export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
/** Defines the tool Result data shape used by this module. */
export type ToolResult = { content: string; isError: boolean };
/** Defines the chat Message data shape used by this module. */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
};
/** Defines the session Draft data shape used by this module. */
export type SessionDraft = { title: string; providerId: string };
/** Defines the session Patch data shape used by this module. */
export type SessionPatch = {
  providerId?: string;
  title?: string;
  pinned?: boolean;
  archived?: boolean;
};
/** Defines the session Filter data shape used by this module. */
export type SessionFilter = { query?: string; archived?: boolean };
/** Defines the session Record data shape used by this module. */
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
/** Defines the message Record data shape used by this module. */
export type MessageRecord = ChatMessage & {
  runId: string | null;
  attachmentIds: string[];
  id: string;
  sessionId: string;
  seq: number;
  status: 'complete' | 'partial' | 'interrupted';
  createdAt: number;
};
/** Defines the run Status data shape used by this module. */
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
/** Defines the run Record data shape used by this module. */
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
/** Defines the model Event data shape used by this module. */
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
/** Defines the agent Event data shape used by this module. */
export type AgentEvent =
  | FeatureAgentEvent
  | { type: 'status'; status: RunStatus }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_finished'; id: string; result: ToolResult }
  | { type: 'error'; code: string; message: string };
/** Defines the run Event data shape used by this module. */
export type RunEvent = AgentEvent & {
  messageId?: string;
  runId: string;
  sessionId: string;
  seq: number;
  createdAt: number;
};
/** Defines the run Input data shape used by this module. */
export type RunInput = {
  runId: string;
  sessionId: string;
  namespace: Namespace;
  profile: ModelProfile;
  messages: ChatMessage[];
  tools: ToolSpec[];
};
/** Defines the model Request data shape used by this module. */
export type ModelRequest = {
  profile: ModelProfile;
  apiKey: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  signal: AbortSignal;
};
/** Describes the model Adapter contract used by this module. */
export interface ModelAdapter {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  probe(
    request: Omit<ModelRequest, 'messages' | 'tools'>,
  ): Promise<{ reachable: boolean; tools: boolean | 'unknown' }>;
}
/** Defines the tool Context data shape used by this module. */
export type ToolContext = {
  namespace: Namespace;
  sessionId: string;
  runId: string;
};
/** Describes the tool Executor contract used by this module. */
export interface ToolExecutor {
  execute(call: ToolCall, context: ToolContext, signal: AbortSignal): Promise<ToolResult>;
}
/** Defines the worker Command data shape used by this module. */
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
/** Defines the worker Reply data shape used by this module. */
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'event'; runId: string; requestId: string; event: AgentEvent }
  | { type: 'tool_request'; runId: string; requestId: string; call: ToolCall };

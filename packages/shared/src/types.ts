export type Namespace = { instanceId: string; accountId: string; teamId: string };
export type ModelCapabilities = { tools: boolean; temperature: boolean; outputTokenField: 'max_tokens' | 'max_completion_tokens' };
export type ProviderDraft = { name: string; baseUrl: string; modelId: string; contextWindow: number; maxOutputTokens: number; timeoutMs: number; allowInsecureHttp: boolean; capabilities: ModelCapabilities };
export type ModelProfile = ProviderDraft & { id: string; credentialRef: string | null };
export type CredentialState = 'persistent' | 'session_only' | 'missing';
export type ProviderView = Omit<ModelProfile, 'credentialRef'> & { credentialState: CredentialState };
export type ToolCall = { id: string; name: string; arguments: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolResult = { content: string; isError: boolean };
export type ChatMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: ToolCall[]; toolCallId?: string };
export type SessionDraft = { title: string; providerId: string };
export type SessionPatch = { title?: string; pinned?: boolean; archived?: boolean };
export type SessionFilter = { query?: string; archived?: boolean };
export type SessionRecord = SessionDraft & { id: string; namespaceKey: string; pinned: boolean; archived: boolean; createdAt: number; updatedAt: number };
export type MessageRecord = ChatMessage & { id: string; sessionId: string; seq: number; status: 'complete' | 'partial' | 'interrupted'; createdAt: number };
export type RunStatus = 'queued' | 'running' | 'waiting_approval' | 'waiting_input' | 'cancelling' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
export type RunRecord = { id: string; sessionId: string; status: RunStatus; errorCode: string | null; createdAt: number; updatedAt: number };
export type ModelEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; argumentsDelta?: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'finish'; reason: string };
export type AgentEvent =
  | { type: 'status'; status: RunStatus }
  | { type: 'text_delta'; text: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_started'; call: ToolCall }
  | { type: 'tool_finished'; id: string; result: ToolResult }
  | { type: 'error'; code: string; message: string };
export type RunEvent = AgentEvent & { runId: string; sessionId: string; seq: number; createdAt: number };
export type RunInput = { runId: string; sessionId: string; namespace: Namespace; profile: ModelProfile; messages: ChatMessage[]; tools: ToolSpec[] };
export type ModelRequest = { profile: ModelProfile; apiKey: string; messages: ChatMessage[]; tools: ToolSpec[]; signal: AbortSignal };
export interface ModelAdapter {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  probe(request: Omit<ModelRequest, 'messages' | 'tools'>): Promise<{ reachable: boolean; tools: boolean | 'unknown' }>;
}
export type ToolContext = { namespace: Namespace; sessionId: string; runId: string };
export interface ToolExecutor { execute(call: ToolCall, context: ToolContext, signal: AbortSignal): Promise<ToolResult> }
export type WorkerCommand =
  | { type: 'start'; input: RunInput; apiKey: string }
  | { type: 'cancel'; runId: string }
  | { type: 'tool_result'; runId: string; requestId: string; result: ToolResult }
  | { type: 'event_ack'; runId: string; requestId: string; error?: { code: string; message: string } }
  | { type: 'shutdown' };
export type WorkerReply =
  | { type: 'ready' }
  | { type: 'event'; runId: string; requestId: string; event: AgentEvent }
  | { type: 'tool_request'; runId: string; requestId: string; call: ToolCall };

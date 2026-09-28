import { AppError, sendMessageSchema, type AgentEvent, type ChatMessage, type MessageRecord, type Namespace, type RunEvent, type RunInput, type ToolCall, type ToolResult } from '../../../../packages/shared/src/index';
import { activeStatuses, namespaceKey, type Store } from '../../../../packages/storage/src/index';
import type { ToolRegistry } from '../../../../packages/agent-core/src/index';
import type { ProviderService } from './provider-service';
import { ToolGateway } from './tool-gateway';
export interface Supervisor { start(input: RunInput, apiKey: string, onEvent: (event: AgentEvent) => Promise<void>, onTool: (call: ToolCall) => Promise<ToolResult>, onExit: () => Promise<void>): void; cancel(runId: string): void; shutdown(): Promise<void> }
export function modelHistory(records: MessageRecord[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]; if (r.status !== 'complete' || r.role === 'tool') continue;
    const { role, content, toolCalls, toolCallId } = r, message: ChatMessage = { role, content, ...(toolCalls ? { toolCalls } : {}), ...(toolCallId ? { toolCallId } : {}) };
    if (!toolCalls) { result.push(message); continue; }
    const following = records.slice(i + 1, i + 1 + toolCalls.length);
    if (following.length === toolCalls.length && following.every((m, j) => m.status === 'complete' && m.role === 'tool' && m.toolCallId === toolCalls[j].id)) { result.push(message, ...following.map(m => ({ role: 'tool' as const, content: m.content, toolCallId: m.toolCallId }))); i += following.length; }
  }
  return result;
}
export class AgentService {
  private running = new Map<string, { namespace: Namespace; controller: AbortController; partial: string; error: string | null }>();
  private revoked = new Set<string>();
  private gateway: ToolGateway;
  constructor(private store: Store, private providers: ProviderService, private supervisor: Supervisor, private tools: ToolRegistry, private principal: () => Namespace, private publish: (event: RunEvent) => void) { this.gateway = new ToolGateway(store.runs, tools); }
  async start(n: Namespace, sessionId: string, text: string) {
    sendMessageSchema.parse({ sessionId, text }); if (this.revoked.has(namespaceKey(n)) || namespaceKey(n) !== namespaceKey(this.principal())) throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    const session = this.store.sessions.get(n, sessionId), resolved = await this.providers.resolve(n, session.providerId);
    if (this.revoked.has(namespaceKey(n)) || namespaceKey(n) !== namespaceKey(this.principal())) throw new AppError('PERMISSION_DENIED', '当前身份已失效');
    const run = this.store.runs.createWithUserMessage(n, sessionId, text), state = { namespace: n, controller: new AbortController(), partial: '', error: null as string | null }; this.running.set(run.id, state);
    const event = async (value: AgentEvent) => {
      const persisted = this.store.transaction(() => {
      const current = this.store.runs.get(n, run.id); if (!activeStatuses.includes(current.status)) return;
      // A cancelled worker may finish a pending round; it cannot commit a new successful response.
      if (state.controller.signal.aborted && value.type !== 'status' && value.type !== 'error') return;
      if (value.type === 'status') {
        const status = state.controller.signal.aborted && value.status === 'completed' ? 'cancelled' : value.status;
        if (status !== current.status) this.store.runs.transition(n, run.id, status, state.error);
        value = { ...value, status };
        if (!activeStatuses.includes(status)) { if (state.partial) this.store.sessions.appendMessage(n, sessionId, { role: 'assistant', content: state.partial }, status === 'interrupted' ? 'interrupted' : 'partial'); state.partial = ''; this.running.delete(run.id); }
      } else if (value.type === 'text_delta') state.partial += value.text;
      else if (value.type === 'assistant_message') { this.store.sessions.appendMessage(n, sessionId, value.message, 'complete'); if (value.message.role === 'assistant') state.partial = ''; }
      else if (value.type === 'error') state.error = value.code;
      return this.store.runs.appendEvent(n, run.id, value);
      });
      if (persisted && !this.revoked.has(namespaceKey(n)) && namespaceKey(this.principal()) === namespaceKey(n)) this.publish(persisted);
    };
    const onExit = async () => { const current = this.store.runs.get(n, run.id); if (activeStatuses.includes(current.status)) { state.error = 'WORKER_EXITED'; await event({ type: 'status', status: state.controller.signal.aborted ? 'cancelled' : 'interrupted' }); } };
    try { this.supervisor.start({ runId: run.id, sessionId, namespace: n, profile: resolved.profile, messages: modelHistory(this.store.sessions.messages(n, sessionId)), tools: this.tools.definitions() }, resolved.apiKey, event, async call => { throwIfActive(); return this.gateway.execute(call, { namespace: n, runId: run.id, sessionId }, state.controller.signal); }, onExit); }
    catch { state.error = 'WORKER_START_FAILED'; await event({ type: 'status', status: 'failed' }); }
    function throwIfActive() { if (state.controller.signal.aborted) throw new AppError('ABORTED', '任务已取消'); }
    return this.store.runs.get(n, run.id);
  }
  async cancel(n: Namespace, runId: string) { const run = this.store.runs.get(n, runId); if (!activeStatuses.includes(run.status)) return; const state = this.running.get(runId); state?.controller.abort(); if (run.status !== 'cancelling') { this.store.runs.transition(n, runId, 'cancelling'); const e = this.store.runs.appendEvent(n, runId, { type: 'status', status: 'cancelling' }); if (namespaceKey(n) === namespaceKey(this.principal())) this.publish(e); } this.supervisor.cancel(runId); }
  async cancelNamespace(n: Namespace) { this.revoked.add(namespaceKey(n)); await Promise.all([...this.running.entries()].filter(([, s]) => namespaceKey(s.namespace) === namespaceKey(n)).map(([id]) => this.cancel(n, id))); }
}

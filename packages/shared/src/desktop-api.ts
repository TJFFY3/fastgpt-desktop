import type { MessageRecord, ProviderDraft, ProviderView, RunEvent, RunRecord, SessionDraft, SessionFilter, SessionPatch, SessionRecord } from './types';
export interface DesktopApi {
  providers: { list(): Promise<ProviderView[]>; save(draft: ProviderDraft, apiKey?: string, id?: string): Promise<ProviderView>; test(id: string): Promise<{ reachable: boolean; tools: boolean | 'unknown' }>; remove(id: string): Promise<void> };
  sessions: { list(filter?: SessionFilter): Promise<SessionRecord[]>; create(draft: SessionDraft): Promise<SessionRecord>; update(id: string, patch: SessionPatch): Promise<SessionRecord>; remove(id: string): Promise<void>; messages(id: string): Promise<MessageRecord[]> };
  runs: { list(sessionId: string): Promise<RunRecord[]>; start(sessionId: string, text: string): Promise<RunRecord>; cancel(runId: string): Promise<void>; events(runId: string, afterSeq?: number): Promise<RunEvent[]> };
  onRunEvent(listener: (event: RunEvent) => void): () => void;
}
export type IpcResult<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

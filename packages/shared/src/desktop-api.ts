/** Provides the desktop api module for the desktop application. */
import type {
  MessageRecord,
  ProviderDraft,
  ProviderView,
  RunEvent,
  RunRecord,
  SessionDraft,
  SessionFilter,
  SessionPatch,
  SessionRecord,
} from './types';
import type { RunStartOptions, RunTimingSnapshot } from './feature-types';
/** Describes the desktop Api contract used by this module. */
export interface DesktopApi {
  providers: {
    list(): Promise<ProviderView[]>;
    save(draft: ProviderDraft, apiKey?: string, id?: string): Promise<ProviderView>;
    test(id: string): Promise<{ reachable: boolean; tools: boolean | 'unknown' }>;
    remove(id: string): Promise<void>;
  };
  sessions: {
    list(filter?: SessionFilter): Promise<SessionRecord[]>;
    create(draft: SessionDraft): Promise<SessionRecord>;
    update(id: string, patch: SessionPatch): Promise<SessionRecord>;
    remove(id: string): Promise<void>;
    messages(id: string): Promise<MessageRecord[]>;
  };
  runs: {
    timing(runId: string): Promise<RunTimingSnapshot>;
    list(sessionId: string): Promise<RunRecord[]>;
    start(sessionId: string, text: string, options?: RunStartOptions): Promise<RunRecord>;
    cancel(runId: string): Promise<void>;
    events(runId: string, afterSeq?: number): Promise<RunEvent[]>;
  };
  onRunEvent(listener: (event: RunEvent) => void): () => void;
}
/** Defines the ipc Result data shape used by this module. */
export type IpcResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

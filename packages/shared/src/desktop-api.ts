/** Defines cross-process contracts, validation, and shared domain primitives. */
/* 中文：定义跨进程共享的数据契约、校验规则和基础业务类型。 */
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
import type { FastGptCatalogQuery, FastGptConnection, FastGptResource } from './fastgpt';
/** Specifies the contract callers must satisfy at this module boundary. */
/* 中文：定义调用方在模块边界需要遵守的接口契约。 */
export interface DesktopApi {
  fastgpt: {
    createSession(appId: string): Promise<SessionRecord>;
    connection(): Promise<FastGptConnection>;
    save(baseUrl: string, apiKey: string): Promise<FastGptConnection>;
    disconnect(): Promise<void>;
    list(query: FastGptCatalogQuery): Promise<{ total: number; list: FastGptResource[] }>;
  };
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
/** Defines the data shape exchanged through this module without exposing its implementation. */
/* 中文：定义模块间传递的数据结构，隐藏内部实现细节。 */
export type IpcResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

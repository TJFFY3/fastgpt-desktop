/** Implements namespaced durable storage and record conversion for desktop state. */
import { randomUUID } from 'node:crypto';
import {
  AppError,
  chatMessageSchema,
  messageRecordSchema,
  sessionDraftSchema,
  sessionPatchSchema,
  type ChatMessage,
  type MessageRecord,
  type Namespace,
  type SessionDraft,
  type SessionFilter,
  type SessionPatch,
  type SessionRecord,
} from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Defines the data shape exchanged through this module without exposing its implementation. */
type Row = Record<string, unknown>;
/** Implements one focused part of this module’s public responsibility. */
function record(r: Row): SessionRecord {
  return {
    id: r.id as string,
    namespaceKey: r.namespace_key as string,
    providerId: r.provider_id as string,
    title: r.title as string,
    pinned: !!r.pinned,
    archived: !!r.archived,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    revision: r.revision as number,
    workspaceId: r.workspace_id as string | null,
  };
}
/** Owns the module boundary represented by session Repository and coordinates its collaborators. */
export class SessionRepository {
  constructor(private db: Database) {}
  /** Persists or updates state while maintaining this module’s data invariants. */
  create(n: Namespace, draft: SessionDraft): SessionRecord {
    const value = sessionDraftSchema.parse(draft),
      key = namespaceKey(n);
    if (
      !this.db.raw
        .prepare('SELECT 1 FROM providers WHERE namespace_key=? AND id=?')
        .get(key, value.providerId)
    )
      throw new AppError('NOT_FOUND', '模型配置不存在');
    const id = randomUUID(),
      time = Date.now();
    this.db.raw
      .prepare(
        'INSERT INTO sessions(namespace_key,id,provider_id,title,pinned,archived,created_at,updated_at) VALUES(?,?,?,?,0,0,?,?)',
      )
      .run(key, id, value.providerId, value.title, time, time);
    return this.get(n, id);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  get(n: Namespace, id: string): SessionRecord {
    const r = this.db.raw
      .prepare('SELECT * FROM sessions WHERE namespace_key=? AND id=?')
      .get(namespaceKey(n), id);
    if (!r) throw new AppError('NOT_FOUND', '会话不存在');
    return record(r);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  list(n: Namespace, filter: SessionFilter = {}): SessionRecord[] {
    return this.db.raw
      .prepare(
        'SELECT * FROM sessions WHERE namespace_key=? AND (? IS NULL OR archived=?) AND instr(lower(title),lower(?))>0 ORDER BY pinned DESC,updated_at DESC,rowid DESC',
      )
      .all(
        namespaceKey(n),
        filter.archived === undefined ? null : Number(filter.archived),
        filter.archived === undefined ? null : Number(filter.archived),
        filter.query ?? '',
      )
      .map(record);
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  update(n: Namespace, id: string, patch: SessionPatch): SessionRecord {
    return this.db.transaction(() => {
      const current = this.get(n, id),
        p = sessionPatchSchema.parse(patch);
      if (p.providerId !== undefined) {
        if (
          this.db.raw
            .prepare(
              "SELECT 1 FROM runs WHERE namespace_key=? AND session_id=? AND status IN ('queued','running','waiting_approval','waiting_input','cancelling')",
            )
            .get(namespaceKey(n), id)
        )
          throw new AppError('RUN_ACTIVE', '运行期间不能切换模型');
        if (
          !this.db.raw
            .prepare('SELECT 1 FROM providers WHERE namespace_key=? AND id=?')
            .get(namespaceKey(n), p.providerId)
        )
          throw new AppError('NOT_FOUND', '模型配置不存在');
      }
      this.db.raw
        .prepare(
          'UPDATE sessions SET title=?,pinned=?,archived=?,provider_id=?,revision=revision+1,updated_at=? WHERE namespace_key=? AND id=?',
        )
        .run(
          p.title ?? current.title,
          Number(p.pinned ?? current.pinned),
          Number(p.archived ?? current.archived),
          p.providerId ?? current.providerId,
          Date.now(),
          namespaceKey(n),
          id,
        );
      return this.get(n, id);
    });
  }
  /** Releases managed state and prevents further use of the affected resource. */
  remove(n: Namespace, id: string) {
    this.get(n, id);
    if (
      this.db.raw
        .prepare(
          "SELECT 1 FROM runs WHERE namespace_key=? AND session_id=? AND status IN ('queued','running','waiting_approval','waiting_input','cancelling')",
        )
        .get(namespaceKey(n), id)
    )
      throw new AppError('RUN_ACTIVE', '请先停止当前运行');
    this.db.raw
      .prepare('DELETE FROM sessions WHERE namespace_key=? AND id=?')
      .run(namespaceKey(n), id);
  }
  /** Implements one focused part of this module’s public responsibility. */
  messages(n: Namespace, id: string): MessageRecord[] {
    this.get(n, id);
    return this.db.raw
      .prepare('SELECT data FROM messages WHERE namespace_key=? AND session_id=? ORDER BY seq')
      .all(namespaceKey(n), id)
      .map((r) => messageRecordSchema.parse(JSON.parse(r.data as string)));
  }
  /** Implements one focused part of this module’s public responsibility. */
  appendMessage(
    n: Namespace,
    id: string,
    message: ChatMessage,
    status: MessageRecord['status'],
    metadata: { runId?: string; attachmentIds?: string[] } = {},
  ): MessageRecord {
    return this.db.transaction(() => {
      this.get(n, id);
      const key = namespaceKey(n),
        value = chatMessageSchema.parse(message),
        row = this.db.raw
          .prepare(
            'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM messages WHERE namespace_key=? AND session_id=?',
          )
          .get(key, id)!;
      /** Captures domain configuration or protocol data whose fields are consumed together by this module. */
      const result: MessageRecord = {
        runId: metadata.runId ?? null,
        attachmentIds: metadata.attachmentIds ?? [],
        ...value,
        id: randomUUID(),
        sessionId: id,
        seq: row.seq as number,
        status,
        createdAt: Date.now(),
      };
      messageRecordSchema.parse(result);
      if (
        result.runId &&
        !this.db.raw
          .prepare('SELECT 1 FROM runs WHERE namespace_key=? AND session_id=? AND id=?')
          .get(key, id, result.runId)
      )
        throw new AppError('NOT_FOUND', '运行不属于此会话');
      this.db.raw
        .prepare('INSERT INTO messages(namespace_key,session_id,id,seq,data) VALUES(?,?,?,?,?)')
        .run(key, id, result.id, result.seq, JSON.stringify(result));
      this.db.raw
        .prepare('UPDATE sessions SET updated_at=? WHERE namespace_key=? AND id=?')
        .run(result.createdAt, key, id);
      return result;
    });
  }
}

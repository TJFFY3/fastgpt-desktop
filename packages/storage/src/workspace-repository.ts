/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import {
  AppError,
  workspaceRecordSchema,
  type WorkspaceRecord,
  type Namespace,
} from '../../shared/src/index';
import type { Database } from './database';
import type { SessionRepository } from './session-repository';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by workspace Repository and coordinates its collaborators. */
/* 中文：管理会话工作区记录及其版本关联。 */
export class WorkspaceRepository {
  constructor(
    private db: Database,
    private sessions: SessionRepository,
  ) {}
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  getForSession(n: Namespace, sid: string): WorkspaceRecord | null {
    this.sessions.get(n, sid);
    const r = this.db.raw
      .prepare('SELECT data FROM workspaces WHERE namespace_key=? AND session_id=?')
      .get(namespaceKey(n), sid);
    return r ? workspaceRecordSchema.parse(JSON.parse(r.data as string)) : null;
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
  save(n: Namespace, record: WorkspaceRecord): void {
    this.db.transaction(() => {
      const w = workspaceRecordSchema.parse(record),
        key = namespaceKey(n),
        session = this.sessions.get(n, w.sessionId),
        current = this.getForSession(n, w.sessionId);
      if (current && current.id !== w.id) throw new AppError('CONFIG_CHANGED', '会话已有工作区');
      const existing = this.db.raw
        .prepare('SELECT session_id FROM workspaces WHERE namespace_key=? AND id=?')
        .get(key, w.id);
      if (existing && existing.session_id !== w.sessionId)
        throw new AppError('NOT_FOUND', '工作区不属于此会话');
      this.db.raw
        .prepare(
          'INSERT INTO workspaces(namespace_key,id,session_id,data) VALUES(?,?,?,?) ON CONFLICT(namespace_key,id) DO UPDATE SET data=excluded.data',
        )
        .run(key, w.id, w.sessionId, JSON.stringify(w));
      if (session.workspaceId !== w.id)
        this.db.raw
          .prepare(
            'UPDATE sessions SET workspace_id=?,revision=revision+1 WHERE namespace_key=? AND id=?',
          )
          .run(w.id, key, w.sessionId);
    });
  }
}

/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import {
  AppError,
  attachmentRecordSchema,
  type AttachmentRecord,
  type Namespace,
} from '../../shared/src/index';
import type { Database } from './database';
import type { SessionRepository } from './session-repository';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by attachment Repository and coordinates its collaborators. */
/* 中文：管理会话附件记录的保存、查询和删除。 */
export class AttachmentRepository {
  constructor(
    private db: Database,
    private sessions: SessionRepository,
  ) {}
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  list(n: Namespace, sid: string): AttachmentRecord[] {
    this.sessions.get(n, sid);
    return this.db.raw
      .prepare('SELECT data FROM attachments WHERE namespace_key=? AND session_id=? ORDER BY rowid')
      .all(namespaceKey(n), sid)
      .map((r) => attachmentRecordSchema.parse(JSON.parse(r.data as string)));
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(n: Namespace, id: string): AttachmentRecord {
    const r = this.db.raw
      .prepare('SELECT data FROM attachments WHERE namespace_key=? AND id=?')
      .get(namespaceKey(n), id);
    if (!r) throw new AppError('NOT_FOUND', '附件不存在');
    return attachmentRecordSchema.parse(JSON.parse(r.data as string));
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  insert(n: Namespace, record: AttachmentRecord): void {
    const a = attachmentRecordSchema.parse(record);
    this.sessions.get(n, a.sessionId);
    this.db.raw
      .prepare('INSERT INTO attachments(namespace_key,id,session_id,data) VALUES(?,?,?,?)')
      .run(namespaceKey(n), a.id, a.sessionId, JSON.stringify(a));
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  markSent(n: Namespace, ids: string[], messageId: string): void {
    this.db.transaction(() => {
      const key = namespaceKey(n),
        message = this.db.raw
          .prepare('SELECT session_id FROM messages WHERE namespace_key=? AND id=?')
          .get(key, messageId);
      if (!message) throw new AppError('NOT_FOUND', '消息不存在');
      if (new Set(ids).size !== ids.length || ids.length > 16)
        throw new AppError('INVALID_INPUT', '附件编号无效');
      for (const id of ids) {
        const a = this.get(n, id);
        if (a.sessionId !== message.session_id) throw new AppError('NOT_FOUND', '附件不属于此会话');
        if (a.state !== 'ready') throw new AppError('INVALID_INPUT', '附件已经发送');
        this.db.raw
          .prepare('UPDATE attachments SET data=? WHERE namespace_key=? AND id=?')
          .run(JSON.stringify({ ...a, state: 'sent' }), key, id);
        this.db.raw
          .prepare(
            'INSERT INTO message_attachments(namespace_key,message_id,attachment_id) VALUES(?,?,?)',
          )
          .run(key, messageId, id);
      }
    });
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  removeDraft(n: Namespace, id: string): void {
    const a = this.get(n, id);
    if (a.state !== 'ready') throw new AppError('INVALID_INPUT', '已发送附件不能作为草稿移除');
    this.db.raw
      .prepare('DELETE FROM attachments WHERE namespace_key=? AND id=?')
      .run(namespaceKey(n), id);
  }
}

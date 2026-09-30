/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import { DatabaseSync } from 'node:sqlite';
/** Owns the module boundary represented by database and coordinates its collaborators. */
/* 中文：封装数据库连接与事务执行。 */
export class Database {
  readonly raw: DatabaseSync;
  private depth = 0;
  private closed = false;
  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
    );
  }
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  transaction<T>(operation: () => T): T {
    if (this.depth) return operation();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = operation();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    } finally {
      this.depth--;
    }
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  close() {
    if (!this.closed) {
      this.raw.close();
      this.closed = true;
    }
  }
}

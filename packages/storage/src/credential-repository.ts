/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import type { Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by credential Repository and coordinates its collaborators. */
/* 中文：管理按命名空间隔离的加密凭据记录。 */
export class CredentialRepository {
  constructor(private db: Database) {}
  /** Persists or updates state while maintaining this module’s data invariants. */
  /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
  put(n: Namespace, ref: string, ciphertext: Uint8Array) {
    this.db.raw
      .prepare('INSERT OR REPLACE INTO credentials(namespace_key,ref,ciphertext) VALUES(?,?,?)')
      .run(namespaceKey(n), ref, ciphertext);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(n: Namespace, ref: string): Uint8Array | null {
    const row = this.db.raw
      .prepare('SELECT ciphertext FROM credentials WHERE namespace_key=? AND ref=?')
      .get(namespaceKey(n), ref);
    return row ? new Uint8Array(row.ciphertext as Uint8Array) : null;
  }
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  remove(n: Namespace, ref: string) {
    this.db.raw
      .prepare('DELETE FROM credentials WHERE namespace_key=? AND ref=?')
      .run(namespaceKey(n), ref);
  }
}

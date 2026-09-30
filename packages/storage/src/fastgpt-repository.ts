/** Stores FastGPT endpoints and encrypted-credential references by local namespace. */
/* 中文：按本地身份保存 FastGPT 地址和凭据引用，数据库不保存明文密钥。 */
import type { Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
export class FastGptRepository {
  constructor(private db: Database) {}
  /* 中文：读取当前命名空间的连接配置。 */
  get(n: Namespace) {
    const row = this.db.raw
      .prepare('SELECT base_url,credential_ref FROM fastgpt_connections WHERE namespace_key=?')
      .get(namespaceKey(n));
    return row ? { baseUrl: row.base_url as string, ref: row.credential_ref as string } : null;
  }
  /* 中文：原子替换地址和凭据引用，避免使用旧凭据连接新服务。 */
  save(n: Namespace, baseUrl: string, ref: string) {
    this.db.raw
      .prepare(
        'INSERT INTO fastgpt_connections VALUES(?,?,?) ON CONFLICT(namespace_key) DO UPDATE SET base_url=excluded.base_url,credential_ref=excluded.credential_ref',
      )
      .run(namespaceKey(n), baseUrl, ref);
  }
  /* 中文：断开当前身份的远端连接。 */
  remove(n: Namespace) {
    this.db.raw
      .prepare('DELETE FROM fastgpt_connections WHERE namespace_key=?')
      .run(namespaceKey(n));
  }
}

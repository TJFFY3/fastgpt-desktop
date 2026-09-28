import { randomUUID } from 'node:crypto';
import { AppError, providerDraftSchema, type ModelProfile, type Namespace, type ProviderDraft } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
export class ProviderRepository {
  constructor(private db: Database) {}
  save(n: Namespace, draft: ProviderDraft, credentialRef: string | null, id?: string): ModelProfile {
    if (id) this.get(n, id);
    const profile = { ...providerDraftSchema.parse(draft), id: id ?? randomUUID(), credentialRef };
    this.db.raw.prepare('INSERT INTO providers VALUES(?,?,?) ON CONFLICT(namespace_key,id) DO UPDATE SET data=excluded.data').run(namespaceKey(n), profile.id, JSON.stringify(profile));
    return profile;
  }
  get(n: Namespace, id: string): ModelProfile { const row = this.db.raw.prepare('SELECT data FROM providers WHERE namespace_key=? AND id=?').get(namespaceKey(n), id); if (!row) throw new AppError('NOT_FOUND', '模型配置不存在'); return JSON.parse(row.data as string); }
  list(n: Namespace): ModelProfile[] { return this.db.raw.prepare('SELECT data FROM providers WHERE namespace_key=? ORDER BY rowid').all(namespaceKey(n)).map(r => JSON.parse(r.data as string)); }
  remove(n: Namespace, id: string) { this.get(n, id); if (this.db.raw.prepare('SELECT 1 FROM sessions WHERE namespace_key=? AND provider_id=?').get(namespaceKey(n), id)) throw new AppError('INVALID_INPUT', '请先删除使用该模型的会话'); this.db.raw.prepare('DELETE FROM providers WHERE namespace_key=? AND id=?').run(namespaceKey(n), id); }
}

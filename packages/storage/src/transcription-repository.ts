/** Implements namespaced durable storage and record conversion for desktop state. */
/* 中文：按命名空间隔离桌面状态的持久化存储，并转换数据库记录。 */
import { speechConfigSchema, type SpeechConfig, type Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by transcription Repository and coordinates its collaborators. */
/* 中文：持久化并查询语音转写服务配置。 */
export class TranscriptionRepository {
  constructor(private db: Database) {}
  /** Returns data through this module while preserving its ownership and consistency rules. */
  /* 中文：按本模块的归属校验和一致性规则查询并返回数据。 */
  get(n: Namespace): SpeechConfig | null {
    const r = this.db.raw
      .prepare('SELECT data FROM transcription_configs WHERE namespace_key=?')
      .get(namespaceKey(n));
    return r ? speechConfigSchema.parse(JSON.parse(r.data as string)) : null;
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
  save(n: Namespace, config: SpeechConfig): void {
    const value = speechConfigSchema.parse(config);
    this.db.raw
      .prepare(
        'INSERT INTO transcription_configs(namespace_key,data) VALUES(?,?) ON CONFLICT(namespace_key) DO UPDATE SET data=excluded.data',
      )
      .run(namespaceKey(n), JSON.stringify(value));
  }
}

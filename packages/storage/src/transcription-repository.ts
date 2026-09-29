/** Implements namespaced durable storage and record conversion for desktop state. */
import { speechConfigSchema, type SpeechConfig, type Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by transcription Repository and coordinates its collaborators. */
export class TranscriptionRepository {
  constructor(private db: Database) {}
  /** Returns data through this module while preserving its ownership and consistency rules. */
  get(n: Namespace): SpeechConfig | null {
    const r = this.db.raw
      .prepare('SELECT data FROM transcription_configs WHERE namespace_key=?')
      .get(namespaceKey(n));
    return r ? speechConfigSchema.parse(JSON.parse(r.data as string)) : null;
  }
  /** Persists or updates state while maintaining this module’s data invariants. */
  save(n: Namespace, config: SpeechConfig): void {
    const value = speechConfigSchema.parse(config);
    this.db.raw
      .prepare(
        'INSERT INTO transcription_configs(namespace_key,data) VALUES(?,?) ON CONFLICT(namespace_key) DO UPDATE SET data=excluded.data',
      )
      .run(namespaceKey(n), JSON.stringify(value));
  }
}

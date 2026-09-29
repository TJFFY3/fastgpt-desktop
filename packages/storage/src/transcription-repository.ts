/** Provides the transcription repository module for the desktop application. */
import { speechConfigSchema, type SpeechConfig, type Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Coordinates transcription Repository responsibilities for this module. */
export class TranscriptionRepository {
  constructor(private db: Database) {}
  /** Handles get within this module's workflow. */
  get(n: Namespace): SpeechConfig | null {
    const r = this.db.raw
      .prepare('SELECT data FROM transcription_configs WHERE namespace_key=?')
      .get(namespaceKey(n));
    return r ? speechConfigSchema.parse(JSON.parse(r.data as string)) : null;
  }
  /** Handles save within this module's workflow. */
  save(n: Namespace, config: SpeechConfig): void {
    const value = speechConfigSchema.parse(config);
    this.db.raw
      .prepare(
        'INSERT INTO transcription_configs(namespace_key,data) VALUES(?,?) ON CONFLICT(namespace_key) DO UPDATE SET data=excluded.data',
      )
      .run(namespaceKey(n), JSON.stringify(value));
  }
}

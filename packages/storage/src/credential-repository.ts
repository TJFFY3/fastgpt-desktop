/** Implements namespaced durable storage and record conversion for desktop state. */
import type { Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Owns the module boundary represented by credential Repository and coordinates its collaborators. */
export class CredentialRepository {
  constructor(private db: Database) {}
  /** Persists or updates state while maintaining this module’s data invariants. */
  put(n: Namespace, ref: string, ciphertext: Uint8Array) {
    this.db.raw
      .prepare('INSERT OR REPLACE INTO credentials(namespace_key,ref,ciphertext) VALUES(?,?,?)')
      .run(namespaceKey(n), ref, ciphertext);
  }
  /** Returns data through this module while preserving its ownership and consistency rules. */
  get(n: Namespace, ref: string): Uint8Array | null {
    const row = this.db.raw
      .prepare('SELECT ciphertext FROM credentials WHERE namespace_key=? AND ref=?')
      .get(namespaceKey(n), ref);
    return row ? new Uint8Array(row.ciphertext as Uint8Array) : null;
  }
  /** Releases managed state and prevents further use of the affected resource. */
  remove(n: Namespace, ref: string) {
    this.db.raw
      .prepare('DELETE FROM credentials WHERE namespace_key=? AND ref=?')
      .run(namespaceKey(n), ref);
  }
}

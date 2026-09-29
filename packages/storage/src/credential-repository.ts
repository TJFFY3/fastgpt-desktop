/** Provides the credential repository module for the desktop application. */
import type { Namespace } from '../../shared/src/index';
import type { Database } from './database';
import { namespaceKey } from './namespace';
/** Coordinates credential Repository responsibilities for this module. */
export class CredentialRepository {
  constructor(private db: Database) {}
  /** Handles put within this module's workflow. */
  put(n: Namespace, ref: string, ciphertext: Uint8Array) {
    this.db.raw
      .prepare('INSERT OR REPLACE INTO credentials(namespace_key,ref,ciphertext) VALUES(?,?,?)')
      .run(namespaceKey(n), ref, ciphertext);
  }
  /** Handles get within this module's workflow. */
  get(n: Namespace, ref: string): Uint8Array | null {
    const row = this.db.raw
      .prepare('SELECT ciphertext FROM credentials WHERE namespace_key=? AND ref=?')
      .get(namespaceKey(n), ref);
    return row ? new Uint8Array(row.ciphertext as Uint8Array) : null;
  }
  /** Handles remove within this module's workflow. */
  remove(n: Namespace, ref: string) {
    this.db.raw
      .prepare('DELETE FROM credentials WHERE namespace_key=? AND ref=?')
      .run(namespaceKey(n), ref);
  }
}

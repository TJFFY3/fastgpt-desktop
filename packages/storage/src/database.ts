/** Implements namespaced durable storage and record conversion for desktop state. */
import { DatabaseSync } from 'node:sqlite';
/** Owns the module boundary represented by database and coordinates its collaborators. */
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
  close() {
    if (!this.closed) {
      this.raw.close();
      this.closed = true;
    }
  }
}

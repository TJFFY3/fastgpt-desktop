/** Provides the database module for the desktop application. */
import { DatabaseSync } from 'node:sqlite';
/** Coordinates database responsibilities for this module. */
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
  /** Handles transaction within this module's workflow. */
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
  /** Handles close within this module's workflow. */
  close() {
    if (!this.closed) {
      this.raw.close();
      this.closed = true;
    }
  }
}

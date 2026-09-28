import type { Database } from "./database";
export function migrate(db: Database) {
  db.transaction(() =>
    db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS providers(namespace_key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,id));
    CREATE TABLE IF NOT EXISTS credentials(namespace_key TEXT NOT NULL, ref TEXT NOT NULL, ciphertext BLOB NOT NULL, PRIMARY KEY(namespace_key,ref));
    CREATE TABLE IF NOT EXISTS sessions(namespace_key TEXT NOT NULL, id TEXT NOT NULL, provider_id TEXT NOT NULL, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace_key,id), FOREIGN KEY(namespace_key,provider_id) REFERENCES providers(namespace_key,id));
    CREATE TABLE IF NOT EXISTS messages(namespace_key TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,session_id,seq), FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS runs(namespace_key TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace_key,id), FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(namespace_key,session_id) WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling');
    CREATE TABLE IF NOT EXISTS run_events(namespace_key TEXT NOT NULL, run_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,run_id,seq), FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS tool_calls(namespace_key TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, PRIMARY KEY(namespace_key,run_id,call_id), FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    INSERT OR IGNORE INTO schema_migrations VALUES(1);
  `),
  );
}

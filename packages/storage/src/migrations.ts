import type { Database } from "./database";
import { randomUUID } from "node:crypto";
import { AppError, modelProfileSchema, messageRecordSchema } from "../../shared/src/index";
export function migrate(db: Database): void {
  db.transaction(() => {
    db.raw.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)");
    const version=Number(db.raw.prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations").get()!.version);
    if(version>2) throw new AppError("SCHEMA_TOO_NEW","数据库版本较新，请更新应用");
    if(version===0) db.raw.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS providers(namespace_key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,id));
    CREATE TABLE IF NOT EXISTS credentials(namespace_key TEXT NOT NULL, ref TEXT NOT NULL, ciphertext BLOB NOT NULL, PRIMARY KEY(namespace_key,ref));
    CREATE TABLE IF NOT EXISTS sessions(namespace_key TEXT NOT NULL, id TEXT NOT NULL, provider_id TEXT NOT NULL, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace_key,id), FOREIGN KEY(namespace_key,provider_id) REFERENCES providers(namespace_key,id));
    CREATE TABLE IF NOT EXISTS messages(namespace_key TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,session_id,seq), FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS runs(namespace_key TEXT NOT NULL, session_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace_key,id), FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(namespace_key,session_id) WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling');
    CREATE TABLE IF NOT EXISTS run_events(namespace_key TEXT NOT NULL, run_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(namespace_key,run_id,seq), FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS tool_calls(namespace_key TEXT NOT NULL, run_id TEXT NOT NULL, call_id TEXT NOT NULL, name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, PRIMARY KEY(namespace_key,run_id,call_id), FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    INSERT INTO schema_migrations(version) VALUES(1);
  `);
    if(version<2) {
      db.raw.exec(`
        ALTER TABLE sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN workspace_id TEXT;
        ALTER TABLE runs ADD COLUMN model_snapshot TEXT;
        ALTER TABLE runs ADD COLUMN elapsed_ms REAL NOT NULL DEFAULT 0;
        ALTER TABLE runs ADD COLUMN timing_updated_at INTEGER;
        CREATE UNIQUE INDEX IF NOT EXISTS messages_by_id ON messages(namespace_key,id);
        CREATE UNIQUE INDEX IF NOT EXISTS runs_session_identity ON runs(namespace_key,session_id,id);
        CREATE TABLE attachments(namespace_key TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,id),FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
        CREATE TABLE message_attachments(namespace_key TEXT NOT NULL,message_id TEXT NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(namespace_key,message_id,attachment_id),FOREIGN KEY(namespace_key,message_id) REFERENCES messages(namespace_key,id) ON DELETE CASCADE,FOREIGN KEY(namespace_key,attachment_id) REFERENCES attachments(namespace_key,id) ON DELETE CASCADE);
        CREATE TABLE workspaces(namespace_key TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,id),UNIQUE(namespace_key,session_id),FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
        CREATE TABLE approvals(namespace_key TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,run_id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,id),FOREIGN KEY(namespace_key,session_id,run_id) REFERENCES runs(namespace_key,session_id,id) ON DELETE CASCADE);
        CREATE TABLE transcription_configs(namespace_key TEXT PRIMARY KEY NOT NULL,data TEXT NOT NULL);
      `);
      // Normalize explicit defaults only; never infer a historical model or run from timestamps.
      for(const row of db.raw.prepare("SELECT namespace_key,id,data FROM providers").all()) {
        const old=JSON.parse(row.data as string),profile=modelProfileSchema.parse({...old,revision:randomUUID()});
        db.raw.prepare("UPDATE providers SET data=? WHERE namespace_key=? AND id=?").run(JSON.stringify(profile),row.namespace_key as string,row.id as string);
      }
      for(const row of db.raw.prepare("SELECT namespace_key,id,data FROM messages").all()) {
        const value=messageRecordSchema.parse({...JSON.parse(row.data as string),runId:null,attachmentIds:[]});
        db.raw.prepare("UPDATE messages SET data=? WHERE namespace_key=? AND id=?").run(JSON.stringify(value),row.namespace_key as string,row.id as string);
      }
      db.raw.exec("INSERT INTO schema_migrations(version) VALUES(2)");
    }
  });
}

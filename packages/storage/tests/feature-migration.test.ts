import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { Database } from "../src/database";
import { migrate } from "../src/migrations";
import { openStore, namespaceKey } from "../src/index";
import { namespaceA as n, namespaceB as foreign, validDraft } from "../../../tests/fixtures/data";
import type { AttachmentRecord, WorkspaceRecord, ApprovalRecord, SpeechConfig } from "../../shared/src/index";

const cleanups: (()=>void)[]=[];
afterEach(()=>{ for(const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function oldDatabase() {
  const dir=mkdtempSync(join(tmpdir(),"fastgpt-migration-")), path=join(dir,"old.sqlite"),db=new Database(path);
  cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));
  db.raw.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1);
    CREATE TABLE providers(namespace_key TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,id));
    CREATE TABLE credentials(namespace_key TEXT NOT NULL,ref TEXT NOT NULL,ciphertext BLOB NOT NULL,PRIMARY KEY(namespace_key,ref));
    CREATE TABLE sessions(namespace_key TEXT NOT NULL,id TEXT NOT NULL,provider_id TEXT NOT NULL,title TEXT NOT NULL,pinned INTEGER DEFAULT 0,archived INTEGER DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(namespace_key,id),FOREIGN KEY(namespace_key,provider_id) REFERENCES providers(namespace_key,id));
    CREATE TABLE messages(namespace_key TEXT NOT NULL,session_id TEXT NOT NULL,id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,session_id,seq),FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE runs(namespace_key TEXT NOT NULL,session_id TEXT NOT NULL,id TEXT NOT NULL,status TEXT NOT NULL,error_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(namespace_key,id),FOREIGN KEY(namespace_key,session_id) REFERENCES sessions(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE run_events(namespace_key TEXT NOT NULL,run_id TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(namespace_key,run_id,seq),FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    CREATE TABLE tool_calls(namespace_key TEXT NOT NULL,run_id TEXT NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,arguments TEXT NOT NULL,result TEXT,PRIMARY KEY(namespace_key,run_id,call_id),FOREIGN KEY(namespace_key,run_id) REFERENCES runs(namespace_key,id) ON DELETE CASCADE);
    CREATE UNIQUE INDEX one_active_run ON runs(namespace_key,session_id) WHERE status IN ('queued','running','waiting_approval','waiting_input','cancelling');
  `);
  const {reasoningField:_unused,...capabilities}=validDraft.capabilities as typeof validDraft.capabilities & {reasoningField?:string};
  const profile={...validDraft,capabilities,id:"p",credentialRef:"cipher-ref"};
  db.raw.prepare("INSERT INTO providers VALUES(?,?,?)").run(namespaceKey(n),"p",JSON.stringify(profile));
  db.raw.prepare("INSERT INTO credentials VALUES(?,?,?)").run(namespaceKey(n),"cipher-ref",new Uint8Array([0,2,255,17]));
  db.raw.prepare("INSERT INTO sessions VALUES(?,?,?,?,0,0,1,1)").run(namespaceKey(n),"s","p","old title");
  const message={id:"old-message",sessionId:"s",seq:1,role:"user",content:"旧消息",status:"complete",createdAt:1};
  db.raw.prepare("INSERT INTO messages VALUES(?,?,?,?,?)").run(namespaceKey(n),"s","old-message",1,JSON.stringify(message));
  db.raw.prepare("INSERT INTO runs VALUES(?,?,?,'completed',NULL,1,1)").run(namespaceKey(n),"s","old-run");
  db.close();
  return path;
}

test("v1 migration preserves history and ciphertext without guessing message/model ownership",()=>{
  const path=oldDatabase(),store=openStore(path); cleanups.push(()=>store.close());
  expect(store.sessions.messages(n,"s")[0]).toMatchObject({content:"旧消息",runId:null,attachmentIds:[]});
  expect(store.sessions.get(n,"s")).toMatchObject({revision:0,workspaceId:null});
  expect(store.runs.get(n,"old-run")).toMatchObject({modelSnapshot:null,elapsedMs:0,timingUpdatedAt:null});
  expect(store.providers.get(n,"p").capabilities).toMatchObject({reasoningField:"none"});
  const raw=new Database(path); cleanups.push(()=>raw.close());
  expect(Array.from(raw.raw.prepare("SELECT ciphertext FROM credentials").get()!.ciphertext as Uint8Array)).toEqual([0,2,255,17]);
  const before=JSON.stringify(store.providers.get(n,"p")); migrate(raw); migrate(raw);
  expect(JSON.stringify(store.providers.get(n,"p"))).toBe(before);
  expect(raw.raw.prepare("SELECT count(*) AS n FROM schema_migrations").get()!.n).toBe(2);
});

test("attachments, workspace, approvals and speech persistence remain isolated by identity",()=>{
  const rawStore=openStore(":memory:"); cleanups.push(()=>rawStore.close());
  const store=rawStore,provider=store.providers.save(n,validDraft,null),session=store.sessions.create(n,{title:"scope",providerId:provider.id});
  const attachment:AttachmentRecord={id:"a",sessionId:session.id,name:"note.txt",size:4,sha256:"a".repeat(64),kind:"text",state:"ready",snapshotKey:"owned"};
  store.attachments.insert(n,attachment);
  expect(store.attachments.list(n,session.id)).toEqual([attachment]);
  expect(()=>store.attachments.get(foreign,"a")).toThrow(expect.objectContaining({code:"NOT_FOUND"}));
  const workspace:WorkspaceRecord={id:"w",sessionId:session.id,sourceLabel:null,sourceRoot:null,revision:0,entryCount:0,totalBytes:0,baselineKey:"base",checkpointKey:"current"};
  store.workspaces.save(n,workspace);expect(store.workspaces.getForSession(n,session.id)).toEqual(workspace);
  expect(()=>store.workspaces.getForSession(foreign,session.id)).toThrow(expect.objectContaining({code:"NOT_FOUND"}));
  const before=store.sessions.messages(n,session.id).length;
  expect(()=>store.runs.createWithUserMessage(n,session.id,"",{attachmentIds:["a","missing"]})).toThrow();
  expect(store.sessions.messages(n,session.id)).toHaveLength(before);expect(store.attachments.get(n,"a").state).toBe("ready");
  const run=store.runs.createWithUserMessage(n,session.id,"",{attachmentIds:["a"]});
  expect(store.sessions.messages(n,session.id).at(-1)).toMatchObject({runId:run.id,attachmentIds:["a"],content:"已添加文件"});
  expect(()=>store.attachments.removeDraft(n,"a")).toThrow();
  const approval:ApprovalRecord={view:{id:"approval",runId:run.id,callId:"call",kind:"command",relativePath:null,command:"pwd",arguments:'{"command":"pwd"}',destinationLabel:"local Docker",state:"pending"},namespaceKey:namespaceKey(n),sessionId:session.id,argumentsHash:"b".repeat(64),createdAt:1};
  store.approvals.insert(n,approval);
  expect(()=>store.approvals.decide(foreign,"approval","approved")).toThrow(expect.objectContaining({code:"NOT_FOUND"}));
  store.approvals.revokeRun(n,run.id);
  expect(store.approvals.get(n,"approval").view.state).toBe("revoked");
  expect(()=>store.approvals.decide(n,"approval","approved")).toThrow(expect.objectContaining({code:"PERMISSION_DENIED"}));
  const speech:SpeechConfig={enabled:true,name:"ASR",baseUrl:"https://asr.example/v1",modelId:"speech",timeoutMs:120000,allowInsecureHttp:false,credentialRef:"speech-key",revision:"v1"};
  store.transcriptions.save(n,speech);expect(store.transcriptions.get(n)).toEqual(speech);expect(store.transcriptions.get(foreign)).toBeNull();
});

test("model replacement is transactional and cannot cross identity or an active run",()=>{
  const store=openStore(":memory:");cleanups.push(()=>store.close());
  const a=store.providers.save(n,validDraft,null),b=store.providers.save(n,{...validDraft,name:"B"},null);
  const session=store.sessions.create(n,{title:"test",providerId:a.id});
  const switched=store.sessions.update(n,session.id,{providerId:b.id} as Parameters<typeof store.sessions.update>[2]);
  expect(switched.providerId).toBe(b.id); expect(switched).toMatchObject({revision:1});
  expect(()=>store.sessions.update(foreign,session.id,{providerId:a.id} as Parameters<typeof store.sessions.update>[2])).toThrow();
  store.runs.createWithUserMessage(n,session.id,"hello");
  expect(()=>store.sessions.update(n,session.id,{providerId:a.id} as Parameters<typeof store.sessions.update>[2])).toThrow(expect.objectContaining({code:"RUN_ACTIVE"}));
  expect(store.sessions.get(n,session.id).providerId).toBe(b.id);
});

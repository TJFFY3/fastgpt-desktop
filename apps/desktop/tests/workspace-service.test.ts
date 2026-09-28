import { mkdir, writeFile, truncate, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { namespaceA as n, namespaceB } from "../../../tests/fixtures/data";
import { fileFixture } from "./file-feature-fixture";
import { WorkspaceService } from "../src/main/workspaces/workspace-service";
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanups.splice(0))await f();});
const posix=test.skipIf(process.platform==="win32");
async function setup(){const x=await fileFixture();cleanups.push(x.cleanup);let selected=x.source,principal=n;const service=new WorkspaceService({store:x.store,artifacts:x.artifacts,files:x.files,grants:x.grants,principal:()=>principal,window:()=>7,pick:async()=>selected,credentialRoots:[join(x.root,"artifacts")]});return {...x,service,choose:(path:string)=>selected=path,switchIdentity:(value:typeof n)=>principal=value};}
posix("preview excludes credentials/dependencies without opening them, then imports empty directories and real bytes",async()=>{
  const x=await setup();await mkdir(join(x.source,"empty"));await mkdir(join(x.source,"node_modules"));await writeFile(join(x.source,"node_modules","huge"),"");await truncate(join(x.source,"node_modules","huge"),200*1024*1024);await mkdir(join(x.source,".git"));await writeFile(join(x.source,".env"),"SECRET");await writeFile(join(x.source,"note.txt"),"中文");
  const preview=await x.service.previewSelection(n,x.session.id);expect(preview.excluded).toEqual(expect.arrayContaining([".git",".env","node_modules"]));expect(preview.entryCount).toBe(2);expect(x.store.workspaces.getForSession(n,x.session.id)).toBeNull();
  const w=await x.service.importSelection(n,x.session.id,preview.grantId,new AbortController().signal);expect(w).toMatchObject({entryCount:2,totalBytes:6,sourceLabel:"source"});expect(w).not.toHaveProperty("sourceRoot");
  expect((await x.service.list(n,x.session.id)).entries.map(e=>e.relativePath)).toEqual(["empty","note.txt"]);expect(await x.service.read(n,x.session.id,"note.txt",0,4)).toMatchObject({text:"中",nextOffset:3,remainingBytes:3});
  await expect(x.service.read(n,x.session.id,"note.txt",1,4)).rejects.toMatchObject({code:"INVALID_RANGE"});x.switchIdentity(namespaceB);await expect(x.service.list(namespaceB,x.session.id)).rejects.toMatchObject({code:"NOT_FOUND"});x.switchIdentity(n);
  await expect(x.service.previewSelection(n,x.session.id)).rejects.toMatchObject({code:"WORKSPACE_BOUND"});expect(await lstat(join(x.source,"note.txt"))).toMatchObject({size:6});
});
posix("changed sources, cancelled and stale commits never replace the previous checkpoint",async()=>{
  const x=await setup();await writeFile(join(x.source,"note.txt"),"first");const preview=await x.service.previewSelection(n,x.session.id);await writeFile(join(x.source,"note.txt"),"other");await expect(x.service.importSelection(n,x.session.id,preview.grantId,new AbortController().signal)).rejects.toMatchObject({code:"SOURCE_CHANGED"});
  const p=await x.service.previewSelection(n,x.session.id);await x.service.importSelection(n,x.session.id,p.grantId,new AbortController().signal);const before=x.store.workspaces.getForSession(n,x.session.id)!;
  const a=await x.service.checkout(n,x.session.id);await expect(x.service.checkout(n,x.session.id)).rejects.toMatchObject({code:"WORKSPACE_BUSY"});async function* text(){yield new TextEncoder().encode("after");}await x.artifacts.write(a.snapshotKey,"note.txt",text());
  const abort=new AbortController();abort.abort();await expect(x.service.commit(n,x.session.id,a.workspace.revision,a.snapshotKey,abort.signal)).rejects.toMatchObject({code:"CANCELLED"});expect(x.store.workspaces.getForSession(n,x.session.id)!.checkpointKey).toBe(before.checkpointKey);
  const b=await x.service.checkout(n,x.session.id);x.store.workspaces.save(n,{...before,revision:before.revision+1});
  await expect(x.service.commit(n,x.session.id,b.workspace.revision,b.snapshotKey,new AbortController().signal)).rejects.toMatchObject({code:"CONFIG_CHANGED"});
  const c=await x.service.checkout(n,x.session.id);await x.artifacts.write(c.snapshotKey,"note.txt",text());await x.service.commit(n,x.session.id,c.workspace.revision,c.snapshotKey,new AbortController().signal);expect((await x.service.read(n,x.session.id,"note.txt",0,100)).text).toBe("after");
});
posix("refuses arbitrary promoted keys, special binaries and unbounded read ranges",async()=>{
  const x=await setup();await x.service.ensure(n,x.session.id);const key=await x.artifacts.createSnapshot();async function* bytes(){yield new Uint8Array([0,255]);}await x.artifacts.write(key,"binary",bytes());await x.artifacts.promote(key);
  await expect(x.service.commit(n,x.session.id,1,key,new AbortController().signal)).rejects.toMatchObject({code:"PERMISSION_DENIED"});
  const checkout=await x.service.checkout(n,x.session.id);await x.artifacts.write(checkout.snapshotKey,"binary",bytes());await x.service.commit(n,x.session.id,checkout.workspace.revision,checkout.snapshotKey,new AbortController().signal);
  await expect(x.service.read(n,x.session.id,"binary",0,65536)).rejects.toMatchObject({code:"BINARY_FILE"});await expect(x.service.read(n,x.session.id,"binary",0,65537)).rejects.toMatchObject({code:"INVALID_RANGE"});
});
posix("native filtered scan accepts exactly 10,000 entries and refuses 10,001 before import",async()=>{
  const x=await setup();await mkdir(join(x.source,"empty"));for(let start=0;start<9999;start+=100)await Promise.all(Array.from({length:Math.min(100,9999-start)},(_,i)=>writeFile(join(x.source,`f${start+i}`),"")));
  const preview=await x.service.previewSelection(n,x.session.id);expect(preview.entryCount).toBe(10000);expect(preview.entries).toHaveLength(100);expect(preview.truncated).toBe(true);
  await writeFile(join(x.source,"extra"),"");await expect(x.service.previewSelection(n,x.session.id)).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});expect(await readdir(x.source)).toHaveLength(10001);
},30000);
posix("native scan accepts 100 MiB file boundary and rejects 100 MiB+1 or total above 1 GiB",async()=>{
  const x=await setup();const path=join(x.source,"large");await writeFile(path,"");await truncate(path,100*1024*1024);expect((await x.service.previewSelection(n,x.session.id)).totalBytes).toBe(100*1024*1024);
  await truncate(path,100*1024*1024+1);await expect(x.service.previewSelection(n,x.session.id)).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});await truncate(path,100*1024*1024);
  for(let i=0;i<10;i++){const p=join(x.source,`more${i}`);await writeFile(p,"");await truncate(p,100*1024*1024);}
  await expect(x.service.previewSelection(n,x.session.id)).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});
},30000);
posix("database transaction failure after promotion keeps the old checkpoint and removes owned new bytes",async()=>{
  const x=await setup();await x.service.ensure(n,x.session.id);const old=x.store.workspaces.getForSession(n,x.session.id)!,c=await x.service.checkout(n,x.session.id);async function* bytes(){yield new TextEncoder().encode("new");}await x.artifacts.write(c.snapshotKey,"new.txt",bytes());
  const db=new DatabaseSync(join(x.root,"test.sqlite"));try{db.exec("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON workspaces BEGIN SELECT RAISE(ABORT,'injected commit failure'); END");await expect(x.service.commit(n,x.session.id,c.workspace.revision,c.snapshotKey,new AbortController().signal)).rejects.toThrow("injected commit failure");}finally{db.close();}
  expect(x.store.workspaces.getForSession(n,x.session.id)!.checkpointKey).toBe(old.checkpointKey);await expect(x.artifacts.localPath(c.snapshotKey)).rejects.toMatchObject({code:"NOT_FOUND"});
});
posix("paginates 100 entries and rejects cursors after revision changes",async()=>{
  const x=await setup();await x.service.ensure(n,x.session.id);const c=await x.service.checkout(n,x.session.id);for(let i=0;i<101;i++)await x.artifacts.directory(c.snapshotKey,`d${i}`);await x.service.commit(n,x.session.id,c.workspace.revision,c.snapshotKey,new AbortController().signal);
  const first=await x.service.list(n,x.session.id);expect(first.entries).toHaveLength(100);expect((await x.service.list(n,x.session.id,first.nextCursor!)).entries).toHaveLength(1);
  const w=x.store.workspaces.getForSession(n,x.session.id)!;x.store.workspaces.save(n,{...w,revision:w.revision+1});await expect(x.service.list(n,x.session.id,first.nextCursor!)).rejects.toMatchObject({code:"CONFIG_CHANGED"});
});
posix("Docker result handoff cannot retain the input temporary or steal another checkout",async()=>{
  const x=await setup();await x.service.ensure(n,x.session.id);const c=await x.service.checkout(n,x.session.id),output=await x.artifacts.createSnapshot();
  await expect(x.service.bindResult(n,x.session.id,c.snapshotKey,output)).rejects.toMatchObject({code:"WORKSPACE_BUSY"});
  await x.artifacts.discard(c.snapshotKey);await x.service.bindResult(n,x.session.id,c.snapshotKey,output);await x.service.commit(n,x.session.id,c.workspace.revision,output,new AbortController().signal);expect((await x.service.list(n,x.session.id)).entries).toEqual([]);
});
posix("forbidden workspace roots are refused before native scanning",async()=>{
  const x=await setup();for(const path of ["/",homedir(),join(x.root,"artifacts")]){if(path===join(x.root,"artifacts"))await mkdir(path);x.choose(path);await expect(x.service.previewSelection(n,x.session.id)).rejects.toMatchObject({code:"UNSAFE_PATH"});}expect(x.store.workspaces.getForSession(n,x.session.id)).toBeNull();
});
posix("all .env-prefixed names are excluded, not only dotted variants",async()=>{
  const x=await setup();await writeFile(join(x.source,".env-secret"),"PRIVATE");await writeFile(join(x.source,".envrc"),"PRIVATE");const p=await x.service.previewSelection(n,x.session.id);expect(p.entries).toEqual([]);expect(p.excluded).toEqual([".env-secret",".envrc"]);
});

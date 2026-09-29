import { writeFile, truncate, symlink,rename,mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { namespaceA as n, namespaceB } from "../../../tests/fixtures/data";
import { AttachmentService } from "../src/main/files/attachment-service";
import { fileFixture } from "./file-feature-fixture";
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanups.splice(0)) await f();});
const posix=test.skipIf(process.platform==="win32");
async function setup() {const x=await fileFixture();cleanups.push(x.cleanup);const service=new AttachmentService(x.store,x.artifacts,x.files,x.grants,()=>n,()=>7);return {...x,service,grant:(paths:string[])=>x.grants.issue(n,x.session.id,7,paths)};}
posix("copies actual originals, keeps public DTOs private and atomically sends file-only messages",async()=>{
  const x=await setup(),path=join(x.source,"note.txt");await writeFile(path,"原文本");
  const [a]=await x.service.importPicked(n,x.session.id,x.grant([path]),new AbortController().signal);
  expect(a).toMatchObject({kind:"text",state:"ready",size:9});expect(a).not.toHaveProperty("snapshotKey");
  await writeFile(path,"修改了");const record=x.store.attachments.get(n,a.id),chunks:Uint8Array[]=[];
  for await(const c of x.artifacts.read(record.snapshotKey,`.attachments/${a.id}/${a.name}`)) chunks.push(c);
  expect(Buffer.concat(chunks).toString()).toBe("原文本");
  const run=x.store.runs.createWithUserMessage(n,x.session.id,"",{attachmentIds:[a.id]});
  expect(run.status).toBe("queued");expect(x.store.sessions.messages(n,x.session.id)[0]).toMatchObject({content:"已添加文件",attachmentIds:[a.id]});
  await expect(x.service.removeDraft(n,a.id)).rejects.toMatchObject({code:"INVALID_INPUT"});
});
posix("refuses symlink paths, cancelled imports and foreign identity without saving attachments",async()=>{
  const x=await setup(),path=join(x.source,"note.txt");await writeFile(path,"abc");await symlink(path,join(x.source,"link"));
  await expect(x.service.importPicked(n,x.session.id,x.grant([join(x.source,"link")]),new AbortController().signal)).rejects.toMatchObject({code:"UNSAFE_PATH"});
  const abort=new AbortController();abort.abort();await expect(x.service.importPicked(n,x.session.id,x.grant([path]),abort.signal)).rejects.toMatchObject({code:"CANCELLED"});
  await expect(x.service.importPicked(namespaceB,x.session.id,x.grant([path]),new AbortController().signal)).rejects.toMatchObject({code:"PERMISSION_DENIED"});
  expect(x.service.list(n,x.session.id)).toEqual([]);
});
posix("enforces 16 files, 20 MiB per file and 100 MiB including existing drafts",async()=>{
  const x=await setup();const paths=[];for(let i=0;i<16;i++) {const p=join(x.source,`${i}.bin`);await writeFile(p,Buffer.from([0]));paths.push(p);}
  const first=await x.service.importPicked(n,x.session.id,x.grant(paths),new AbortController().signal);expect(first).toHaveLength(16);
  await expect(x.service.importPicked(n,x.session.id,x.grant([paths[0]]),new AbortController().signal)).rejects.toMatchObject({code:"ATTACHMENT_LIMIT"});
  for(const a of first) await x.service.removeDraft(n,a.id);
  await truncate(paths[0],20*1024*1024+1);
  await expect(x.service.importPicked(n,x.session.id,x.grant([paths[0]]),new AbortController().signal)).rejects.toMatchObject({code:"ATTACHMENT_LIMIT"});
  for(let i=0;i<6;i++) await truncate(paths[i],i<5?20*1024*1024:1);
  await expect(x.service.importPicked(n,x.session.id,x.grant(paths.slice(0,6)),new AbortController().signal)).rejects.toMatchObject({code:"ATTACHMENT_LIMIT"});
  expect(x.service.list(n,x.session.id)).toEqual([]);
});
posix.each(["parent","file"])("preflight %s replacement cannot import unselected bytes or change the checkpoint",async kind=>{
 const x=await setup(),path=join(x.source,"note.txt");await writeFile(path,"SELECTED_BYTES");await x.service.snapshots.ensure(n,x.session.id);const prior=x.store.workspaces.getForSession(n,x.session.id)!;
 const create=x.artifacts.createSnapshot.bind(x.artifacts);let replaced=false;x.artifacts.createSnapshot=async()=>{const key=await create();if(!replaced){replaced=true;if(kind==="parent"){await rename(x.source,join(x.root,"old-source"));await mkdir(x.source);}else await rename(path,join(x.source,"old-note"));await writeFile(path,"UNSELECTED_REPLACEMENT_BYTES");}return key;};
 await expect(x.service.importPicked(n,x.session.id,x.grant([path]),new AbortController().signal)).rejects.toMatchObject({code:expect.stringMatching(/SOURCE_CHANGED|FILE_CONFLICT/)});
 expect(x.service.list(n,x.session.id)).toEqual([]);expect(x.store.workspaces.getForSession(n,x.session.id)).toEqual(prior);
});

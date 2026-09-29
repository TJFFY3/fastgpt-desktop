import { mkdtemp, mkdir, writeFile, readFile, symlink, link, realpath, rm, open, lstat, rename } from "node:fs/promises";
import { createServer } from "node:net";
import { watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { SafeFileOps } from "../src/main/files/safe-file-ops";
import { ArtifactStore } from "../src/main/files/artifact-store";
import { randomUUID } from "node:crypto";
const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const files=new SafeFileOps(resolve("apps/desktop/native-build/safe-files"));
const posixTest=test.skipIf(process.platform==="win32");
const limits={maxEntries:10000,maxFileBytes:100*1024*1024,maxTotalBytes:1024**3};
async function setup() {
  const root=await realpath(await mkdtemp(join(tmpdir(),"fastgpt-safe-")));dirs.push(root);
  const source=join(root,"source"),managed=join(root,"managed");await mkdir(source);await mkdir(managed);await writeFile(join(source,"note.txt"),"abc");
  return {root,source,managed};
}
posixTest("selected regular file copies actual bytes and records a hand-checked SHA256",async()=>{
  const {source,managed}=await setup(),destination=join(managed,"copy");
  const version=await files.copyInto(source,"note.txt",destination,20*1024*1024);
  expect(await readFile(destination,"utf8")).toBe("abc");
  expect(version).toMatchObject({size:3,sha256:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"});
  expect(await files.read(source,"note.txt",1,4)).toEqual(new Uint8Array([98,99]));
});
test.each(["../outside","/etc/passwd","C:/Windows","a//b","CON","a/NUL.txt","space.","e\u0301.txt"])("refuses unsafe or ambiguous path %s before touching the destination",async path=>{
  const {source,managed}=await setup();
  await expect(files.copyInto(source,path,join(managed,"copy"),20*1024*1024)).rejects.toMatchObject({code:"UNSAFE_PATH"});
});
posixTest("links, hardlinks and replaced parents never alter an external sentinel",async()=>{
  const {root,source,managed}=await setup(),outside=join(root,"outside");await mkdir(outside);await writeFile(join(outside,"target"),"untouched");
  await symlink(outside,join(source,"link"));
  await expect(files.copyInto(source,"link/target",join(managed,"copy"),100)).rejects.toMatchObject({code:"UNSAFE_PATH"});
  await expect(files.replace(source,"link/target",join(source,"note.txt"),null,managed)).rejects.toMatchObject({code:"UNSAFE_PATH"});
  expect(await readFile(join(outside,"target"),"utf8")).toBe("untouched");
  await link(join(source,"note.txt"),join(source,"hard"));
  await expect(files.scan(source,limits)).rejects.toMatchObject({code:"UNSAFE_PATH"});
});
posixTest("scanning rejects case collisions and enforces count/file/total limits",async()=>{
  const {source}=await setup();await mkdir(join(source,"A"));await writeFile(join(source,"a.txt"),"four");
  await expect(files.scan(source,{...limits,maxEntries:1})).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});
  await expect(files.scan(source,{...limits,maxFileBytes:2})).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});
  await expect(files.scan(source,{...limits,maxTotalBytes:6})).rejects.toMatchObject({code:"WORKSPACE_LIMIT"});
  // Two representable names on case-sensitive systems; on macOS use Unicode normalization rejection above.
  if(process.platform!=="darwin") {await mkdir(join(source,"a"));await expect(files.scan(source,limits)).rejects.toMatchObject({code:"UNSAFE_PATH"});}
});
posixTest("changed originals refuse replacement; confirmed replacement/deletion return recoverable backups",async()=>{
  const {source,managed}=await setup(),incoming=join(managed,"new"),copy=join(managed,"old");await writeFile(incoming,"new");
  const original=await files.copyInto(source,"note.txt",copy,100);
  await writeFile(join(source,"note.txt"),"edited");
  await expect(files.replace(source,"note.txt",incoming,original,managed)).rejects.toMatchObject({code:"FILE_CONFLICT"});
  expect(await readFile(join(source,"note.txt"),"utf8")).toBe("edited");
  const current=await files.copyInto(source,"note.txt",join(managed,"current"),100);
  const result=await files.replace(source,"note.txt",incoming,current,managed);
  expect(await readFile(join(source,"note.txt"),"utf8")).toBe("new");expect(await readFile(join(managed,result.backupKey!),"utf8")).toBe("edited");
  const deletion=await files.delete(source,"note.txt",result.version,managed);expect(await readFile(join(managed,deletion.backupKey),"utf8")).toBe("new");
});
posixTest("fingerprints inspect existing/absent targets without copies and mutations retain a pre-owned backup inode",async()=>{const x=await setup(),root=await lstat(x.source,{bigint:true}),identity={device:String(root.dev),inode:String(root.ino)};expect(await files.fingerprint(x.source,"note.txt",identity)).toMatchObject({sha256:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",size:3});expect(await files.fingerprint(x.source,"missing",identity)).toBeNull();const original=await files.copyInto(x.source,"note.txt",join(x.managed,"copy"),100),id=randomUUID(),blob=join(x.managed,id);await writeFile(blob,"",{flag:"wx"});const b=await lstat(blob,{bigint:true});await writeFile(join(x.managed,"new"),"replacement");const result=await files.replace(x.source,"note.txt",join(x.managed,"new"),original,x.managed,{backupKey:id,backupOwner:{device:String(b.dev),inode:String(b.ino)},expectedRoot:identity});expect(result.backupKey).toBe(id);expect(await readFile(blob,"utf8")).toBe("abc");expect((await lstat(blob,{bigint:true})).ino).toBe(b.ino);});
posixTest("a plain directory substituted at the authorized root cannot acquire mutation permission",async()=>{const x=await setup(),stat=await lstat(x.source,{bigint:true});await rename(x.source,join(x.root,"old-root"));await mkdir(x.source);await writeFile(join(x.source,"note.txt"),"abc");const newFp=await files.copyInto(x.source,"note.txt",join(x.managed,"copy"),100);await writeFile(join(x.managed,"new"),"replacement");await expect(files.replace(x.source,"note.txt",join(x.managed,"new"),newFp,x.managed,{expectedRoot:{device:String(stat.dev),inode:String(stat.ino)}})).rejects.toMatchObject({code:"SOURCE_CHANGED"});expect(await readFile(join(x.source,"note.txt"),"utf8")).toBe("abc");});
posixTest("new nested export paths create verified ordinary parents without traversing links",async()=>{const x=await setup(),s=await lstat(x.source,{bigint:true}),identity={device:String(s.dev),inode:String(s.ino)};expect(await files.fingerprint(x.source,"new/deep/file.txt",identity)).toBeNull();await files.prepareParents(x.source,"new/deep/file.txt",identity);await writeFile(join(x.managed,"incoming"),"nested");await files.replace(x.source,"new/deep/file.txt",join(x.managed,"incoming"),null,x.managed,{expectedRoot:identity});expect(await readFile(join(x.source,"new/deep/file.txt"),"utf8")).toBe("nested");await symlink(x.managed,join(x.source,"link"));await expect(files.prepareParents(x.source,"link/unsafe/file.txt",identity)).rejects.toThrow();await expect(lstat(join(x.managed,"unsafe"))).rejects.toThrow();});
test("missing trusted helper fails closed, never falls back to unrestricted filesystem writes",async()=>{
  const {source,managed}=await setup(),unavailable=new SafeFileOps(join(managed,"missing-helper"));
  await expect(unavailable.replace(source,"note.txt",join(source,"note.txt"),null,managed)).rejects.toMatchObject({code:"SAFE_FILES_UNAVAILABLE"});
  expect(await readFile(join(source,"note.txt"),"utf8")).toBe("abc");
});
posixTest("source changes during copying abort and only the owned partial destination is removed",async()=>{
  const {source,managed}=await setup();await writeFile(join(source,"large"),Buffer.alloc(40*1024*1024,65));
  const destination=join(managed,"partial");let mutation:Promise<void>|undefined;
  const watcher=watch(managed,(_event,name)=>{if(name==="partial"&&!mutation) mutation=(async()=>{const file=await open(join(source,"large"),"r+");try{await file.write(new Uint8Array([66]),0,1,0);}finally{await file.close();}})();});
  try {
    await expect(files.copyInto(source,"large",destination,100*1024*1024)).rejects.toMatchObject({code:"SOURCE_CHANGED"});
    await mutation;expect(mutation).toBeDefined();expect(await lstat(destination).then(()=>true,()=>false)).toBe(false);
  } finally {watcher.close();}
});
posixTest("snapshot ownership survives restart and unowned keys cannot read or discard files",async()=>{
  const {managed}=await setup(),store=new ArtifactStore(managed,files),key=await store.createSnapshot();
  async function* data(){yield new TextEncoder().encode("中文");}
  await store.write(key,"sub/note.txt",data());await store.promote(key);
  const reopened=new ArtifactStore(managed,files),parts:Uint8Array[]=[];for await(const chunk of reopened.read(key,"sub/note.txt")) parts.push(chunk);
  expect(Buffer.concat(parts).toString("utf8")).toBe("中文");expect((await reopened.manifest(key)).map(e=>e.relativePath)).toEqual(["sub","sub/note.txt"]);
  await expect(reopened.discard("../source")).rejects.toMatchObject({code:"UNSAFE_PATH"});
  await expect(reopened.discard("11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({code:"NOT_FOUND"});
  await expect(reopened.write(key,"new.txt",data())).rejects.toMatchObject({code:"PERMISSION_DENIED"});
});
posixTest("a parent replaced with an external symlink during native copying never traverses it",async()=>{
  const {root,source,managed}=await setup(),parent=join(source,"sub"),outside=join(root,"outside");await mkdir(parent);await mkdir(outside);
  await writeFile(join(parent,"large"),Buffer.alloc(40*1024*1024,65));await writeFile(join(outside,"large"),"untouched");
  let mutation:Promise<void>|undefined;
  const watcher=watch(managed,(_event,name)=>{if(name==="partial"&&!mutation) mutation=(async()=>{await rename(parent,join(source,"old-parent"));await symlink(outside,parent);})();});
  try {
    await expect(files.copyInto(source,"sub/large",join(managed,"partial"),100*1024*1024)).rejects.toMatchObject({code:"UNSAFE_PATH"});
    await mutation;expect(mutation).toBeDefined();expect(await readFile(join(outside,"large"),"utf8")).toBe("untouched");
  } finally {watcher.close();}
});
posixTest("special filesystem entries are rejected without opening or blocking on them",async()=>{
  const {source}=await setup(),server=createServer();
  await new Promise<void>(r=>server.listen(join(source,"socket"),r));
  try {await expect(files.scan(source,limits)).rejects.toMatchObject({code:"UNSAFE_PATH"});}
  finally {await new Promise<void>((r,e)=>server.close(error=>error?e(error):r()));}
});
posixTest("snapshot writes reject cross-platform case collisions before replacing any prior file",async()=>{
  const {managed}=await setup(),store=new ArtifactStore(managed,files),key=await store.createSnapshot();
  async function* data(){yield new TextEncoder().encode("original");}
  await store.write(key,"A.txt",data());await expect(store.write(key,"a.txt",data())).rejects.toMatchObject({code:"UNSAFE_PATH"});
  expect((await store.manifest(key)).filter(e=>e.kind==="file").map(e=>e.relativePath)).toEqual(["A.txt"]);
});

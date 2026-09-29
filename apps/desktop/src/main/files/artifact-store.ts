import { constants } from "node:fs";
import { mkdir, lstat, chmod, open, rename, unlink, rm, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { z } from "zod";
import { AppError, type FileEntry, type SandboxFileBridge } from "../../../../../packages/shared/src/index";
import type { SafeFileOps } from "./safe-file-ops";
import { assertNoPathCollisions, safeRelativePath } from "./path-policy";
const limits={maxEntries:10000,maxFileBytes:100*1024*1024,maxTotalBytes:1024**3};
const keySchema=z.string().uuid();
const ownerSchema=z.strictObject({key:keySchema,device:z.string(),inode:z.string(),state:z.enum(["temporary","promoted"])});
type Owner=z.infer<typeof ownerSchema>;
export class ArtifactStore implements SandboxFileBridge {
  private initialized:Promise<void>|undefined;
  private entries=new Map<string,Map<string,{size:number;kind:"file"|"directory"}>>();
  private queues=new Map<string,Promise<unknown>>();
  private manifests=new Map<string,Map<string,FileEntry>>();
  constructor(private root:string,private files:SafeFileOps) {this.root=resolve(root);}
  private initialize():Promise<void> {
    return this.initialized ??= (async()=>{
      await mkdir(this.root,{recursive:true,mode:0o700});
      const root=await lstat(this.root);if(!root.isDirectory()||root.isSymbolicLink()) throw new AppError("UNSAFE_PATH","快照存储目录无效");
      await chmod(this.root,0o700);this.root=await realpath(this.root);await mkdir(join(this.root,".owners"),{recursive:true,mode:0o700});
      const owners=await lstat(join(this.root,".owners"));if(!owners.isDirectory()||owners.isSymbolicLink()) throw new AppError("UNSAFE_PATH","快照归属目录无效");
    })();
  }
  private async owned(key:string):Promise<Owner> {
    if(!keySchema.safeParse(key).success) throw new AppError("UNSAFE_PATH","快照编号无效");
    await this.initialize();
    const file=await open(join(this.root,".owners",`${key}.json`),constants.O_RDONLY|constants.O_NOFOLLOW).catch(()=>{throw new AppError("NOT_FOUND","快照不存在");});
    let owner:Owner;
    try {
      const buffer=Buffer.alloc(4097),{bytesRead}=await file.read(buffer,0,buffer.length,0);
      if(bytesRead>4096) throw new AppError("UNSAFE_PATH","归属记录过大");
      owner=ownerSchema.parse(JSON.parse(buffer.subarray(0,bytesRead).toString("utf8")));
    } finally {await file.close();}
    const stat=await lstat(join(this.root,key),{bigint:true}).catch(()=>{throw new AppError("NOT_FOUND","快照不存在");});
    if(owner.key!==key || !stat.isDirectory() || stat.isSymbolicLink() || String(stat.dev)!==owner.device || String(stat.ino)!==owner.inode) throw new AppError("SOURCE_CHANGED","快照目录身份已变化");
    return owner;
  }
  private async saveOwner(owner:Owner):Promise<void> {
    const destination=join(this.root,".owners",`${owner.key}.json`),temporary=join(this.root,".owners",`${randomUUID()}.tmp`);
    const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await handle.writeFile(JSON.stringify(ownerSchema.parse(owner)));await handle.sync();} finally {await handle.close();}
    await rename(temporary,destination);
  }
  private async locked<T>(key:string,operation:()=>Promise<T>):Promise<T> {
    const before=this.queues.get(key) ?? Promise.resolve(),next=before.catch(()=>{}).then(operation);this.queues.set(key,next);
    try {return await next;} finally {if(this.queues.get(key)===next) this.queues.delete(key);}
  }
  async createSnapshot():Promise<string> {
    await this.initialize();const key=randomUUID(),path=join(this.root,key);await mkdir(path,{mode:0o700});
    const stat=await lstat(path,{bigint:true});await this.saveOwner({key,device:String(stat.dev),inode:String(stat.ino),state:"temporary"});
    this.entries.set(key,new Map());return key;
  }
  async localPath(key:string):Promise<string> {await this.owned(key);return join(this.root,key);}
  async manifest(key:string):Promise<FileEntry[]> {
    const entries=await this.fileMap(key);return [...entries.values()].map(e=>({...e}));
  }
  private async fileMap(key:string):Promise<Map<string,FileEntry>> {
    const owner=await this.owned(key),cached=this.manifests.get(key);
    if(owner.state==="promoted"&&cached) return cached;
    const entries=new Map((await this.files.scan(join(this.root,key),limits)).map(e=>[e.relativePath,e]));
    if(owner.state==="promoted") {this.manifests.set(key,entries);if(this.manifests.size>8) this.manifests.delete(this.manifests.keys().next().value!);}
    return entries;
  }
  async *read(key:string,path:string):AsyncIterable<Uint8Array> {
    safeRelativePath(path);const entry=(await this.fileMap(key)).get(path);
    if(!entry||entry.kind!=="file") throw new AppError("NOT_FOUND","快照文件不存在");
    for(let offset=0;offset<entry.size;) {const chunk=await this.files.read(join(this.root,key),path,offset,Math.min(65536,entry.size-offset));if(!chunk.length) throw new AppError("SOURCE_CHANGED","快照文件提前结束");offset+=chunk.byteLength;yield chunk;}
  }
  private async current(key:string) {
    let entries=this.entries.get(key);if(!entries) {entries=new Map((await this.manifest(key)).map(e=>[e.relativePath,{size:e.size,kind:e.kind}]));this.entries.set(key,entries);}return entries;
  }
  private async parentDirectories(key:string,path:string,entries:Map<string,{size:number;kind:"file"|"directory"}>) {
    const parts=path.split("/");
    for(let i=1;i<parts.length;i++) {
      const parent=parts.slice(0,i).join("/");if(entries.get(parent)?.kind==="file") throw new AppError("UNSAFE_PATH","父路径不是目录");
      assertNoPathCollisions([...entries.keys(),...(entries.has(parent)?[]:[parent])]);
      if(!entries.has(parent)) {if(entries.size>=limits.maxEntries) throw new AppError("WORKSPACE_LIMIT","工作区条目超限");await mkdir(join(this.root,key,parent),{mode:0o700});entries.set(parent,{size:0,kind:"directory"});}
    }
  }
  async directory(key:string,path:string):Promise<void> {
    await this.locked(key,async()=>{
      if((await this.owned(key)).state!=="temporary") throw new AppError("PERMISSION_DENIED","已提交快照不可修改");
      safeRelativePath(path);const entries=await this.current(key);await this.parentDirectories(key,`${path}/placeholder`,entries);
    });
  }
  async write(key:string,path:string,data:AsyncIterable<Uint8Array>):Promise<void> {
    await this.locked(key,async()=>{
      if((await this.owned(key)).state!=="temporary") throw new AppError("PERMISSION_DENIED","已提交快照不可修改");
      safeRelativePath(path);const entries=await this.current(key);
      if(entries.get(path)?.kind==="directory") throw new AppError("UNSAFE_PATH","不能覆盖目录");
      assertNoPathCollisions([...entries.keys(),...(entries.has(path)?[]:[path])]);await this.parentDirectories(key,path,entries);
      if(!entries.has(path)&&entries.size>=limits.maxEntries) throw new AppError("WORKSPACE_LIMIT","工作区条目超限");
      const destination=join(this.root,key,path),temporary=join(dirname(destination),`.pending-${randomUUID()}`);
      const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      const prior=entries.get(path)?.size ?? 0,existing=[...entries.values()].reduce((sum,e)=>sum+e.size,0);let size=0;
      try {
        for await(const bytes of data) {
          if(!(bytes instanceof Uint8Array) || bytes.byteLength>65536) throw new AppError("INVALID_INPUT","文件传输块无效");
          size+=bytes.byteLength;if(size>limits.maxFileBytes||existing-prior+size>limits.maxTotalBytes) throw new AppError("WORKSPACE_LIMIT","工作区内容超限");
          let offset=0;while(offset<bytes.byteLength) {const result=await handle.write(bytes,offset,bytes.byteLength-offset);if(!result.bytesWritten) throw new AppError("SAFE_FILES_FAILED","文件写入失败");offset+=result.bytesWritten;}
        }
        await handle.sync();await handle.close();await rename(temporary,destination);entries.set(path,{size,kind:"file"});
      } catch(error) {await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
    });
  }
  async discard(key:string):Promise<void> {
    await this.locked(key,async()=>{
      await this.owned(key);await rm(join(this.root,key),{recursive:true});await unlink(join(this.root,".owners",`${key}.json`));this.entries.delete(key);this.manifests.delete(key);
    });
  }
  async promote(key:string):Promise<void> {
    await this.locked(key,async()=>{const owner=await this.owned(key);await this.manifest(key);await this.saveOwner({...owner,state:"promoted"});this.entries.delete(key);});
  }
}

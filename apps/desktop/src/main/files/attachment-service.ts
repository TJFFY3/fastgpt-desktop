import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, dirname, join, extname } from "node:path";
import { AppError, type AttachmentRecord, type AttachmentView, type Namespace } from "../../../../../packages/shared/src/index";
import { activeStatuses, type Store } from "../../../../../packages/storage/src/index";
import type { ArtifactStore } from "./artifact-store";
import type { SafeFileOps } from "./safe-file-ops";
import type { InputGrants } from "./input-grants";
import { safeRelativePath } from "./path-policy";
import { WorkspaceSnapshots } from "./workspace-snapshots";
const maxFile=20*1024*1024,maxBatch=100*1024*1024;
export const attachmentPath=(a:Pick<AttachmentRecord,"id"|"name">)=>`.attachments/${a.id}/${a.name}`;
export const attachmentView=({snapshotKey:_,...view}:AttachmentRecord):AttachmentView=>view;
export async function excerpt(artifacts:ArtifactStore,key:string,path:string,size:number):Promise<{text:string|null;truncated:boolean}> {
  const chunks:Uint8Array[]=[];let length=0;
  for await(const c of artifacts.read(key,path)){const part=c.subarray(0,65536-length);chunks.push(part);length+=part.length;if(length>=65536)break;}
  const bytes=Buffer.concat(chunks),truncated=size>bytes.length;
  for(let trim=0;trim<=(truncated?3:0);trim++) {try {const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,bytes.length-trim));if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {text:null,truncated};return {text,truncated};}catch{/* a cut UTF-8 tail may lose up to 3 bytes */}}
  return {text:null,truncated};
}
export class AttachmentService {
  readonly snapshots:WorkspaceSnapshots;
  constructor(private store:Store,private artifacts:ArtifactStore,private files:SafeFileOps,private grants:InputGrants,principal:()=>Namespace,private window:()=>number,snapshots?:WorkspaceSnapshots) {this.snapshots=snapshots??new WorkspaceSnapshots(store,artifacts,principal);}
  private idle(n:Namespace,sid:string,signal?:AbortSignal):void {this.snapshots.check(n,sid,signal);if(this.store.runs.list(n,sid).some(r=>activeStatuses.includes(r.status)))throw new AppError("RUN_ACTIVE","运行期间不能更改附件");}
  async importPicked(n:Namespace,sid:string,grantId:string,signal:AbortSignal):Promise<AttachmentView[]> {
    this.idle(n,sid,signal);const paths=this.grants.consume(grantId,n,sid,this.window());
    return this.snapshots.locked(n,sid,async()=>{
      this.idle(n,sid,signal);const existing=this.store.attachments.list(n,sid),ready=existing.filter(a=>a.state==="ready");
      if(ready.length+paths.length>16)throw new AppError("ATTACHMENT_LIMIT","一次最多添加 16 个附件");
      let total=ready.reduce((s,a)=>s+a.size,0);
      for(const path of paths){safeRelativePath(basename(path));const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw new AppError("UNSAFE_PATH","只能选择普通文件");if(stat.size>maxFile||(total+=stat.size)>maxBatch)throw new AppError("ATTACHMENT_LIMIT","附件超过 20 MiB 单文件或 100 MiB 批次限制");}
      this.idle(n,sid,signal);const current=await this.snapshots.ensure(n,sid,signal),keys:string[]=[],records:AttachmentRecord[]=[];let checkpoint:string|undefined,committed=false;
      try {
        for(const path of paths){this.idle(n,sid,signal);const id=randomUUID(),name=basename(path),key=await this.artifacts.createSnapshot();keys.push(key);const relative=attachmentPath({id,name});await this.artifacts.directory(key,`.attachments/${id}`);
          const fingerprint=await this.files.copyInto(dirname(path),name,join(await this.artifacts.localPath(key),relative),maxFile);await this.artifacts.promote(key);
          const binary=/^\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|zip|gz|mp[34]|wav|webm)$/i.test(extname(name)),content=binary?null:(await excerpt(this.artifacts,key,relative,fingerprint.size)).text;
          records.push({id,sessionId:sid,name,size:fingerprint.size,sha256:fingerprint.sha256,kind:content===null?"binary":"text",state:"ready",snapshotKey:key});
        }
        if(ready.reduce((s,a)=>s+a.size,0)+records.reduce((s,a)=>s+a.size,0)>maxBatch)throw new AppError("ATTACHMENT_LIMIT","附件批次超限");
        const baselineBytes=(await this.artifacts.manifest(current.baselineKey)).reduce((s,e)=>s+e.size,0);
        if(baselineBytes+existing.reduce((s,a)=>s+a.size,0)+records.reduce((s,a)=>s+a.size,0)>1024**3)throw new AppError("WORKSPACE_LIMIT","工作区和附件原始副本超限");
        checkpoint=await this.snapshots.clone(current.checkpointKey,undefined,signal);
        for(const a of records)await this.artifacts.write(checkpoint,attachmentPath(a),this.artifacts.read(a.snapshotKey,attachmentPath(a)));
        const next=await this.snapshots.prepareCommit(current,checkpoint);
        this.store.transaction(()=>{this.idle(n,sid,signal);this.snapshots.validate(n,current,signal);for(const a of records)this.store.attachments.insert(n,a);this.store.workspaces.save(n,next);});committed=true;
        await this.snapshots.discardOld(current);return records.map(attachmentView);
      } finally {if(!committed){for(const key of [...keys,...(checkpoint?[checkpoint]:[])])await this.artifacts.discard(key).catch(()=>{});}}
    });
  }
  list(n:Namespace,sid:string):AttachmentView[] {this.snapshots.check(n,sid);return this.store.attachments.list(n,sid).map(attachmentView);}
  async removeDraft(n:Namespace,id:string):Promise<void> {
    const original=this.store.attachments.get(n,id);if(original.state!=="ready")throw new AppError("INVALID_INPUT","已发送附件不能移除");this.idle(n,original.sessionId);
    await this.snapshots.locked(n,original.sessionId,async()=>{
      const a=this.store.attachments.get(n,id);if(a.state!=="ready")throw new AppError("INVALID_INPUT","已发送附件不能移除");this.idle(n,a.sessionId);
      const current=await this.snapshots.ensure(n,a.sessionId),prefix=`.attachments/${a.id}`,key=await this.snapshots.clone(current.checkpointKey,p=>p===prefix||p.startsWith(prefix+"/"));let committed=false;
      try {const next=await this.snapshots.prepareCommit(current,key);this.store.transaction(()=>{this.idle(n,a.sessionId);this.snapshots.validate(n,current);this.store.attachments.removeDraft(n,id);this.store.workspaces.save(n,next);});committed=true;await this.snapshots.discardOld(current);await this.artifacts.discard(a.snapshotKey).catch(()=>{});}
      finally{if(!committed)await this.artifacts.discard(key).catch(()=>{});}
    });
  }
}

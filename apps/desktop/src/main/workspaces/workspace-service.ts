import { lstat, realpath, statfs } from "node:fs/promises";
import { basename, join } from "node:path";
import { AppError, type Namespace, type WorkspaceView, type WorkspacePreview, type FileListPage, type FileRead, type WorkspaceRecord, type WorkspaceDiff } from "../../../../../packages/shared/src/index";
import { activeStatuses, namespaceKey, type Store } from "../../../../../packages/storage/src/index";
import type { ArtifactStore } from "../files/artifact-store";
import type { SafeFileOps, FileFingerprint } from "../files/safe-file-ops";
import type { InputGrants } from "../files/input-grants";
import { WorkspaceSnapshots } from "../files/workspace-snapshots";
import { assertWorkspaceRoot, safeRelativePath } from "../files/path-policy";
import { excerpt } from "../files/attachment-service";
import { workspaceDiff } from "./workspace-diff";
type Options={store:Store;artifacts:ArtifactStore;files:SafeFileOps;grants:InputGrants;principal:()=>Namespace;window:()=>number;pick:()=>Promise<string|null>;credentialRoots:string[];snapshots?:WorkspaceSnapshots};
type PreviewData=Awaited<ReturnType<SafeFileOps["scanWorkspace"]>>&{root:string;device:string;inode:string;namespaceKey:string;sessionId:string;window:number;workspaceId:string|null;revision:number;expires:number};
type Checkout={namespaceKey:string;sessionId:string;workspace:WorkspaceRecord;expires:number};
export const workspaceView=({sourceRoot:_,sourceIdentity:____,baselineKey:__,checkpointKey:___,...view}:WorkspaceRecord):WorkspaceView=>view;
export class WorkspaceService {
  readonly snapshots:WorkspaceSnapshots;
  readonly files:SafeFileOps;
  private previews=new Map<string,PreviewData>();private checkouts=new Map<string,Checkout>();
  constructor(private o:Options) {this.files=o.files;this.snapshots=o.snapshots??new WorkspaceSnapshots(o.store,o.artifacts,o.principal);}
  assertIdle(n:Namespace,sid:string):void{this.idle(n,sid);}
  private idle(n:Namespace,sid:string,signal?:AbortSignal):void {this.snapshots.check(n,sid,signal);if(this.o.store.runs.list(n,sid).some(r=>activeStatuses.includes(r.status)))throw new AppError("RUN_ACTIVE","运行期间不能重新导入工作区");if([...this.checkouts.values()].some(c=>c.namespaceKey===namespaceKey(n)&&c.sessionId===sid))throw new AppError("WORKSPACE_BUSY","工作区已有未完成的操作");}
  private current(n:Namespace,sid:string):WorkspaceRecord {this.snapshots.check(n,sid);const w=this.o.store.workspaces.getForSession(n,sid);if(!w)throw new AppError("NOT_FOUND","工作区尚未创建");return w;}
  private async space(key:string,additional:number):Promise<void> {const stat=await statfs(await this.o.artifacts.localPath(key),{bigint:true});if(stat.bavail*stat.bsize<BigInt(Math.ceil(additional))+64n*1024n*1024n)throw new AppError("DISK_FULL","创建工作副本所需磁盘空间不足");}
  async ensure(n:Namespace,sid:string):Promise<WorkspaceView>{return this.snapshots.locked(n,sid,async()=>{this.idle(n,sid);return workspaceView(await this.snapshots.ensure(n,sid));});}
  async previewSelection(n:Namespace,sid:string):Promise<WorkspacePreview> {
    this.idle(n,sid);const w=this.o.store.workspaces.getForSession(n,sid);if(w?.sourceRoot)throw new AppError("WORKSPACE_BOUND","更换目录请创建新会话");
    const revision=this.o.store.sessions.get(n,sid).revision,selected=await this.o.pick();this.idle(n,sid);if(!selected)throw new AppError("CANCELLED","已取消目录选择");
    const stat=await lstat(selected,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink())throw new AppError("UNSAFE_PATH","请选择普通目录");const root=await realpath(selected);assertWorkspaceRoot(root,this.o.credentialRoots);
    const scan=await this.o.files.scanWorkspace(root);this.idle(n,sid);if(this.o.store.sessions.get(n,sid).revision!==revision)throw new AppError("CONFIG_CHANGED","会话已变化");const latest=this.o.store.workspaces.getForSession(n,sid);if(latest?.id!==w?.id||latest?.revision!==w?.revision)throw new AppError("CONFIG_CHANGED","工作区已变化");
    const final=await lstat(root,{bigint:true});if(final.dev!==stat.dev||final.ino!==stat.ino)throw new AppError("SOURCE_CHANGED","选中目录已被替换");
    for(const [id,p]of this.previews)if(p.expires<=performance.now())this.previews.delete(id);if(this.previews.size>=64)throw new AppError("INPUT_LIMIT","待确认目录过多");
    const grantId=this.o.grants.issue(n,sid,this.o.window(),[root]);this.previews.set(grantId,{...scan,root,device:String(stat.dev),inode:String(stat.ino),namespaceKey:namespaceKey(n),sessionId:sid,window:this.o.window(),workspaceId:w?.id??null,revision:w?.revision??0,expires:performance.now()+60000});
    return {grantId,entries:scan.entries.slice(0,100),excluded:scan.excluded.slice(0,100),entryCount:scan.entries.length,totalBytes:scan.entries.reduce((s,e)=>s+e.size,0),truncated:scan.entries.length>100||scan.excluded.length>100};
  }
  async importSelection(n:Namespace,sid:string,grant:string,signal:AbortSignal):Promise<WorkspaceView> {
    this.idle(n,sid,signal);const p=this.previews.get(grant);if(!p||p.namespaceKey!==namespaceKey(n)||p.sessionId!==sid||p.window!==this.o.window()||p.expires<=performance.now())throw new AppError("PERMISSION_DENIED","目录选择授权已失效");this.o.grants.consume(grant,n,sid,this.o.window());this.previews.delete(grant);
    return this.snapshots.locked(n,sid,async()=>{
      this.idle(n,sid,signal);const prior=this.o.store.workspaces.getForSession(n,sid);if((prior?.id??null)!==p.workspaceId||(prior?.revision??0)!==p.revision)throw new AppError("CONFIG_CHANGED","工作区已变化");if(prior?.sourceRoot)throw new AppError("WORKSPACE_BOUND","此会话已有源目录");
      const rootStat=await lstat(p.root,{bigint:true});if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||String(rootStat.dev)!==p.device||String(rootStat.ino)!==p.inode)throw new AppError("SOURCE_CHANGED","目录已变化");
      const now=await this.o.files.scanWorkspace(p.root);if(JSON.stringify(now.entries)!==JSON.stringify(p.entries))throw new AppError("SOURCE_CHANGED","预览后文件清单已变化，请重新选择");
      const bytes=p.entries.reduce((s,e)=>s+e.size,0),originals=this.o.store.attachments.list(n,sid).reduce((s,a)=>s+a.size,0);if(bytes+originals>1024**3)throw new AppError("WORKSPACE_LIMIT","基线与附件原始副本超过 1 GiB");
      const current=await this.snapshots.ensure(n,sid,signal);await this.space(current.checkpointKey,bytes*2+current.totalBytes);const baseline=await this.o.artifacts.createSnapshot();let checkpoint:string|undefined,committed=false;
      try {for(const e of p.entries){this.idle(n,sid,signal);if(e.kind==="directory")await this.o.artifacts.directory(baseline,e.relativePath);else{
          const parent=e.relativePath.split("/").slice(0,-1).join("/");if(parent)await this.o.artifacts.directory(baseline,parent);
          const fp=await this.o.files.copyInto(p.root,e.relativePath,join(await this.o.artifacts.localPath(baseline),e.relativePath),100*1024*1024);const expected=p.fingerprints.get(e.relativePath)!;
          if(!Object.keys(expected).every(k=>fp[k as keyof FileFingerprint]===expected[k as keyof FileFingerprint]))throw new AppError("SOURCE_CHANGED","文件在预览后变化");
        }}await this.o.artifacts.promote(baseline);checkpoint=await this.snapshots.clone(baseline,undefined,signal);
        const imported=new Map(p.entries.map(e=>[e.relativePath,e]));for(const e of await this.o.artifacts.manifest(current.checkpointKey)){if(imported.has(e.relativePath)){if(e.kind==="directory"&&imported.get(e.relativePath)!.kind==="directory")continue;throw new AppError("FILE_CONFLICT","导入目录与现有工作区文件重名");}if(e.kind==="directory")await this.o.artifacts.directory(checkpoint,e.relativePath);else await this.o.artifacts.write(checkpoint,e.relativePath,this.o.artifacts.read(current.checkpointKey,e.relativePath));}
        const next={...await this.snapshots.prepareCommit(current,checkpoint),baselineKey:baseline,sourceRoot:p.root,sourceIdentity:{device:p.device,inode:p.inode},sourceLabel:basename(p.root)};
        this.o.store.transaction(()=>{this.idle(n,sid,signal);this.snapshots.validate(n,current,signal);this.o.store.workspaces.save(n,next);});committed=true;await this.snapshots.discardOld(current);if(current.baselineKey!==current.checkpointKey)await this.o.artifacts.discard(current.baselineKey).catch(()=>{});else await this.o.artifacts.discard(current.checkpointKey).catch(()=>{});return workspaceView(next);
      }finally{if(!committed){await this.o.artifacts.discard(baseline).catch(()=>{});if(checkpoint)await this.o.artifacts.discard(checkpoint).catch(()=>{});}}
    });
  }
  async list(n:Namespace,sid:string,cursor?:string):Promise<FileListPage> {
    this.snapshots.check(n,sid);const w=this.o.store.workspaces.getForSession(n,sid);if(!w)return {entries:[],nextCursor:null};
    let offset=0;if(cursor){const match=/^(\d+):(\d+)$/.exec(cursor);if(!match||Number(match[1])!==w.revision||!Number.isSafeInteger(Number(match[2])))throw new AppError("CONFIG_CHANGED","清单已变化，请重新读取");offset=Number(match[2]);}
    const entries=await this.o.artifacts.manifest(w.checkpointKey);this.snapshots.validate(n,w);if(offset>entries.length)throw new AppError("INVALID_RANGE","清单位置无效");return {entries:entries.slice(offset,offset+100),nextCursor:offset+100<entries.length?`${w.revision}:${offset+100}`:null};
  }
  async read(n:Namespace,sid:string,path:string,offset:number,max:number):Promise<FileRead> {
    safeRelativePath(path);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(max)||max<4||max>65536)throw new AppError("INVALID_RANGE","读取范围须为 4–65,536 字节");
    const w=this.current(n,sid),e=(await this.o.artifacts.manifest(w.checkpointKey)).find(e=>e.relativePath===path&&e.kind==="file");if(!e)throw new AppError("NOT_FOUND","文件不存在");if(offset>e.size)throw new AppError("INVALID_RANGE","偏移超出文件");
    if(/\.(pdf|png|jpe?g|gif|webp|docx?|xlsx?|pptx?|zip|gz|mp[34]|wav|webm)$/i.test(path))throw new AppError("BINARY_FILE","此文件未提取文本");
    const bytes=await this.o.files.read(await this.o.artifacts.localPath(w.checkpointKey),path,offset,max);this.snapshots.validate(n,w);if(bytes.length&&(bytes[0]&0xc0)===0x80)throw new AppError("INVALID_RANGE","偏移须落在 UTF-8 字符边界");
    for(let trim=0;trim<=(offset+bytes.length<e.size?3:0);trim++){try{const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,bytes.length-trim));if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))break;const nextOffset=offset+bytes.length-trim;return {text,offset,nextOffset,remainingBytes:e.size-nextOffset,truncated:nextOffset<e.size};}catch{/* complete UTF-8 prefix only */}}
    throw new AppError("BINARY_FILE","文件不是有效 UTF-8 文本");
  }
  async checkout(n:Namespace,sid:string):Promise<{workspace:WorkspaceView;snapshotKey:string}> {
    return this.snapshots.locked(n,sid,async()=>{const w=this.current(n,sid);if([...this.checkouts.values()].some(c=>c.namespaceKey===namespaceKey(n)&&c.sessionId===sid))throw new AppError("WORKSPACE_BUSY","工作区已有未完成操作");await this.space(w.checkpointKey,1024**3);const snapshotKey=await this.snapshots.clone(w.checkpointKey);try{this.snapshots.validate(n,w);this.checkouts.set(snapshotKey,{namespaceKey:namespaceKey(n),sessionId:sid,workspace:w,expires:performance.now()+600000});return {workspace:workspaceView(w),snapshotKey};}catch(e){await this.o.artifacts.discard(snapshotKey).catch(()=>{});throw e;}});
  }
  private claim(n:Namespace,sid:string,key:string):Checkout {const claim=this.checkouts.get(key);if(!claim||claim.namespaceKey!==namespaceKey(n)||claim.sessionId!==sid)throw new AppError("PERMISSION_DENIED","工作副本不属于此操作");return claim;}
  async bindResult(n:Namespace,sid:string,inputKey:string,outputKey:string):Promise<void> {
    this.snapshots.check(n,sid);const claim=this.claim(n,sid,inputKey);if(inputKey===outputKey||this.checkouts.has(outputKey)||!await this.o.artifacts.isTemporary(outputKey))throw new AppError("PERMISSION_DENIED","只能接受新的临时产物");
    await this.o.artifacts.localPath(inputKey).then(()=>{throw new AppError("WORKSPACE_BUSY","接收产物前必须释放已传输的输入副本");},e=>{if(!(e instanceof AppError&&e.code==="NOT_FOUND"))throw e;});
    this.snapshots.check(n,sid);this.checkouts.delete(inputKey);this.checkouts.set(outputKey,claim);
  }
  async discardCheckout(n:Namespace,sid:string,key:string):Promise<void> {this.claim(n,sid,key);this.checkouts.delete(key);await this.o.artifacts.discard(key).catch(()=>{});}
  async commit(n:Namespace,sid:string,revision:number,key:string,signal:AbortSignal):Promise<WorkspaceView> {
    const claim=this.claim(n,sid,key);return this.snapshots.locked(n,sid,async()=>{let committed=false;try{this.snapshots.check(n,sid,signal);if(claim.expires<=performance.now()||claim.workspace.revision!==revision)throw new AppError("CONFIG_CHANGED","工作副本已失效");this.snapshots.validate(n,claim.workspace,signal);await this.space(key,0);const next=await this.snapshots.prepareCommit(claim.workspace,key);this.o.store.transaction(()=>{this.snapshots.validate(n,claim.workspace,signal);this.o.store.workspaces.save(n,next);});committed=true;await this.snapshots.discardOld(claim.workspace);return workspaceView(next);}finally{this.checkouts.delete(key);if(!committed)await this.o.artifacts.discard(key).catch(()=>{});}});
  }
  async diff(n:Namespace,sid:string):Promise<WorkspaceDiff[]> {const w=this.current(n,sid),result=await workspaceDiff(await this.o.artifacts.manifest(w.baselineKey),await this.o.artifacts.manifest(w.checkpointKey),async(path,key)=>{const snapshot=key==="before"?w.baselineKey:w.checkpointKey,e=(await this.o.artifacts.manifest(snapshot)).find(e=>e.relativePath===path)!;return /\.(pdf|png|jpe?g|docx?|xlsx?|pptx?|zip)$/i.test(path)||(await excerpt(this.o.artifacts,snapshot,path,e.size)).text===null;});this.snapshots.validate(n,w);return result;}
}

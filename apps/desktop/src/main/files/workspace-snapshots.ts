import { randomUUID } from "node:crypto";
import { AppError, type Namespace, type WorkspaceRecord } from "../../../../../packages/shared/src/index";
import { namespaceKey, type Store } from "../../../../../packages/storage/src/index";
import type { ArtifactStore } from "./artifact-store";
export class WorkspaceSnapshots {
  private queues=new Map<string,Promise<unknown>>();
  private retired=new Set<string>();private closed=false;
  constructor(readonly store:Store,readonly artifacts:ArtifactStore,private principal:()=>Namespace) {}
  check(n:Namespace,sid:string,signal?:AbortSignal):void {
    if(this.closed||this.retired.has(namespaceKey(n)+sid))throw new AppError("CANCELLED","会话资源正在关闭，请等待清理或重试删除");
    if(namespaceKey(n)!==namespaceKey(this.principal())) throw new AppError("PERMISSION_DENIED","当前身份已失效");
    if(signal?.aborted) throw new AppError("CANCELLED","操作已取消");
    this.store.sessions.get(n,sid);
  }
  retire(n:Namespace,sid:string):void{this.retired.add(namespaceKey(n)+sid);}
  resume(n:Namespace,sid:string):void{this.retired.delete(namespaceKey(n)+sid);}
  close():void{this.closed=true;}
  assertStartAllowed(n:Namespace,sid:string):void{this.check(n,sid);if(this.queues.has(namespaceKey(n)+sid))throw new AppError("WORKSPACE_BUSY","文件操作尚未完成");}
  async drain(n?:Namespace,sid?:string):Promise<void>{const work=n&&sid?[this.queues.get(namespaceKey(n)+sid)]:[...this.queues.values()];await Promise.allSettled(work.filter((p):p is Promise<unknown>=>!!p));}
  async locked<T>(n:Namespace,sid:string,operation:()=>Promise<T>):Promise<T> {
    const key=namespaceKey(n)+sid,before=this.queues.get(key)??Promise.resolve(),next=before.catch(()=>{}).then(operation);this.queues.set(key,next);
    try{return await next;}finally{if(this.queues.get(key)===next)this.queues.delete(key);}
  }
  async ensure(n:Namespace,sid:string,signal?:AbortSignal):Promise<WorkspaceRecord> {
    this.check(n,sid,signal);const current=this.store.workspaces.getForSession(n,sid);if(current)return current;
    const key=await this.artifacts.createSnapshot();
    try {await this.artifacts.promote(key);this.check(n,sid,signal);const existing=this.store.workspaces.getForSession(n,sid);if(existing){await this.artifacts.discard(key);return existing;}
      const w:WorkspaceRecord={id:randomUUID(),sessionId:sid,sourceLabel:null,sourceRoot:null,revision:1,entryCount:0,totalBytes:0,baselineKey:key,checkpointKey:key};this.store.workspaces.save(n,w);return w;
    } catch(e){await this.artifacts.discard(key).catch(()=>{});throw e;}
  }
  async clone(key:string,exclude:(path:string)=>boolean=()=>false,signal?:AbortSignal):Promise<string> {
    const result=await this.artifacts.createSnapshot();
    try {for(const e of await this.artifacts.manifest(key)){if(signal?.aborted)throw new AppError("CANCELLED","操作已取消");if(exclude(e.relativePath))continue;
      if(e.kind==="directory")await this.artifacts.directory(result,e.relativePath);else await this.artifacts.write(result,e.relativePath,this.artifacts.read(key,e.relativePath));}return result;
    } catch(e){await this.artifacts.discard(result).catch(()=>{});throw e;}
  }
  async prepareCommit(current:WorkspaceRecord,key:string):Promise<WorkspaceRecord> {
    await this.artifacts.promote(key);const entries=await this.artifacts.manifest(key);return {...current,checkpointKey:key,revision:current.revision+1,entryCount:entries.length,totalBytes:entries.reduce((s,e)=>s+e.size,0)};
  }
  validate(n:Namespace,current:WorkspaceRecord,signal?:AbortSignal):void {
    this.check(n,current.sessionId,signal);const latest=this.store.workspaces.getForSession(n,current.sessionId);
    if(!latest||latest.id!==current.id||latest.revision!==current.revision||latest.checkpointKey!==current.checkpointKey)throw new AppError("CONFIG_CHANGED","工作区已变化");
  }
  async discardOld(current:WorkspaceRecord):Promise<void> {if(current.checkpointKey!==current.baselineKey)await this.artifacts.discard(current.checkpointKey).catch(()=>{});}
}

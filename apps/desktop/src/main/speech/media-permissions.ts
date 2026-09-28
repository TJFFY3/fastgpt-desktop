import { AppError,type Namespace } from "../../../../../packages/shared/src/index";
import type { TranscriptionService } from "./transcription-service";
import { namespaceKey } from "../../../../../packages/storage/src/index";
export type MediaWindow={id:number;getURL():string;isDestroyed():boolean};
export type MediaOptions={speech:TranscriptionService;principal:()=>Namespace;window:()=>MediaWindow;consent:()=>Promise<boolean>;devOrigin?:string};
type Grant={id:string;n:Namespace;sid:string;owner:number;expires:number;timer:ReturnType<typeof setTimeout>};
export class MediaPermissionService{
  private grants=new Map<string,Grant>();private closed=false;
  constructor(private o:MediaOptions){}
  private window(wc:MediaWindow|null):boolean{return !this.closed&&!!wc&&wc===this.o.window()&&!wc.isDestroyed()&&this.origin(wc.getURL());}
  private origin(value:string):boolean{try{const u=new URL(value);return !u.username&&!u.password&&((u.protocol==="app:"&&u.hostname==="desktop"&&!u.port)||(!!this.o.devOrigin&&u.origin===this.o.devOrigin));}catch{return false;}}
  async beginCapture(n:Namespace,sid:string,wc:MediaWindow):Promise<{operationId:string}>{if(!this.window(wc)||namespaceKey(n)!==namespaceKey(this.o.principal()))throw new AppError("PERMISSION_DENIED","录音页面来源无效");const op=await this.o.speech.begin(n,sid,wc.id);try{if(!await this.o.consent())throw new AppError("MICROPHONE_DENIED","麦克风权限未授予，请检查系统设置");this.o.speech.captureScope(n,op.operationId);if(!this.window(wc))throw new AppError("PERMISSION_DENIED","录音窗口已变化");const grant:Grant={id:op.operationId,n:{...n},sid,owner:wc.id,expires:performance.now()+60000,timer:setTimeout(()=>this.revoke(op.operationId),60000)};grant.timer.unref?.();this.grants.set(grant.id,grant);return op;}catch(e){this.o.speech.cancel(n,op.operationId);throw e;}}
  // check, sometimes without mediaType. Borrow only that validated audio-only
  check(_wc:MediaWindow|null,_permission:string,_origin:string,_details:unknown):boolean{return false;}
  request(wc:MediaWindow|null,permission:string,callback:(allowed:boolean)=>void,raw:unknown):void{let allowed=false;try{const d=raw as {isMainFrame?:unknown;requestingUrl?:unknown;securityOrigin?:unknown;mediaTypes?:unknown};if(!this.window(wc)||permission!=="media"||!d||d.isMainFrame!==true||typeof d.requestingUrl!=="string"||!this.origin(d.requestingUrl)||typeof d.securityOrigin!=="string"||!this.origin(d.securityOrigin)||!Array.isArray(d.mediaTypes)||d.mediaTypes.length!==1||d.mediaTypes[0]!=="audio")return;for(const grant of this.grants.values()){if(grant.owner!==wc!.id||grant.expires<=performance.now()||namespaceKey(grant.n)!==namespaceKey(this.o.principal()))continue;const scope=this.o.speech.captureScope(grant.n,grant.id);if(scope.owner!==wc!.id||scope.sessionId!==grant.sid)continue;clearTimeout(grant.timer);this.grants.delete(grant.id);allowed=true;break;}}catch{/* missing/stale metadata grants no authority */}finally{callback(allowed);}}
  revoke(id:string):void{const g=this.grants.get(id);if(g){clearTimeout(g.timer);this.grants.delete(id);this.o.speech.cancel(g.n,id);}}
  revokeSession(n:Namespace,sid:string):void{for(const g of this.grants.values())if(namespaceKey(g.n)===namespaceKey(n)&&g.sid===sid)this.revoke(g.id);}
  revokeNamespace(n:Namespace):void{for(const g of this.grants.values())if(namespaceKey(g.n)===namespaceKey(n))this.revoke(g.id);}
  shutdown():void{this.closed=true;for(const g of this.grants.values())this.revoke(g.id);}
}

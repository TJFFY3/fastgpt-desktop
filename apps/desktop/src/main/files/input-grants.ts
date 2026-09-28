import { AppError, type Namespace } from "../../../../../packages/shared/src/index";
import { namespaceKey } from "../../../../../packages/storage/src/index";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
export class InputGrants {
  private grants=new Map<string,{namespaceKey:string;session:string;window:number;paths:string[];expires:number}>();
  constructor(private now:()=>number=()=>performance.now()) {}
  issue(n:Namespace,session:string,window:number,paths:string[]):string {
    if(!session||!Number.isSafeInteger(window)||window<1||!paths.length||paths.length>16||new Set(paths).size!==paths.length||paths.some(p=>!isAbsolute(p)||p.length>8192||/[\x00-\x1f]/.test(p))) throw new AppError("INVALID_INPUT","选择的文件无效");
    for(const [id,grant] of this.grants) if(grant.expires<this.now()) this.grants.delete(id);
    if(this.grants.size>=128) throw new AppError("INPUT_LIMIT","待导入授权过多");
    const id=randomUUID();this.grants.set(id,{namespaceKey:namespaceKey(n),session,window,paths:[...paths],expires:this.now()+60000});return id;
  }
  consume(id:string,n:Namespace,session:string,window:number):string[] {
    const grant=this.grants.get(id);
    if(!grant||grant.namespaceKey!==namespaceKey(n)||grant.session!==session||grant.window!==window||grant.expires<=this.now()) throw new AppError("PERMISSION_DENIED","文件选择授权无效或已过期");
    this.grants.delete(id);return [...grant.paths];
  }
  revokeSession(n:Namespace,sid:string):void {for(const [id,grant] of this.grants) if(grant.namespaceKey===namespaceKey(n)&&grant.session===sid) this.grants.delete(id);}
  revokeNamespace(n:Namespace):void {for(const [id,grant] of this.grants) if(grant.namespaceKey===namespaceKey(n)) this.grants.delete(id);}
  clear():void {this.grants.clear();}
}

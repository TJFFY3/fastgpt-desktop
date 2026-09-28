import { AppError } from "../../shared/src/index";
export class ExecutionQueue {
  private active=0;private closed=false;private pending:{signal:AbortSignal;resolve:(release:()=>void)=>void;reject:(error:AppError)=>void;abort:()=>void}[]=[];
  private cancelled(){return new AppError("CANCELLED","排队操作已取消");}
  private lease():()=>void{this.active++;let released=false;return()=>{if(released)return;released=true;this.active--;this.drain();};}
  private drain(){while(!this.closed&&this.active<2&&this.pending.length){const item=this.pending.shift()!;item.signal.removeEventListener("abort",item.abort);if(item.signal.aborted)item.reject(this.cancelled());else item.resolve(this.lease());}}
  private acquire(signal:AbortSignal):Promise<()=>void>{
    if(this.closed||signal.aborted)return Promise.reject(this.cancelled());if(this.active<2)return Promise.resolve(this.lease());
    return new Promise((resolve,reject)=>{const item={signal,resolve,reject,abort:()=>{const index=this.pending.indexOf(item);if(index>=0)this.pending.splice(index,1);signal.removeEventListener("abort",item.abort);reject(this.cancelled());}};this.pending.push(item);signal.addEventListener("abort",item.abort,{once:true});if(signal.aborted)item.abort();});
  }
  async run<T>(signal:AbortSignal,operation:()=>Promise<T>):Promise<T>{const release=await this.acquire(signal);try{if(signal.aborted||this.closed)throw this.cancelled();return await operation();}finally{release();}}
  close():void{this.closed=true;for(const item of this.pending.splice(0)){item.signal.removeEventListener("abort",item.abort);item.reject(this.cancelled());}}
}

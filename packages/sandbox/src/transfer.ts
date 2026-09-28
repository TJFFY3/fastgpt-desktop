import { createHash } from "node:crypto";
import { AppError, fileEntrySchema, type FileEntry, type SandboxFileBridge } from "../../shared/src/index";
import { sandboxPath } from "./policy";
const invalid=()=>new AppError("TRANSFER_INVALID","文件传输数据无效或不完整");
function check(signal:AbortSignal,started:number){if(signal.aborted)throw new AppError("CANCELLED","文件传输已取消");if(performance.now()-started>120000)throw new AppError("TRANSFER_TIMEOUT","文件传输超时");}
class Reader {
  private iterator:AsyncIterator<Uint8Array>;private pending:Uint8Array=new Uint8Array(0);private offset=0;private chunks=0;
  constructor(input:AsyncIterable<Uint8Array>,private signal:AbortSignal,private started:number){this.iterator=input[Symbol.asyncIterator]();}
  private async next():Promise<IteratorResult<Uint8Array>> {
    check(this.signal,this.started);if(++this.chunks>2000000)throw invalid();let listener:()=>void=()=>{};
    try {return await Promise.race([this.iterator.next(),new Promise<never>((_,reject)=>{listener=()=>reject(new AppError("CANCELLED","文件传输已取消"));this.signal.addEventListener("abort",listener,{once:true});if(this.signal.aborted)listener();})]);}finally{this.signal.removeEventListener("abort",listener);}
  }
  async take(size:number):Promise<Uint8Array>{const out=new Uint8Array(size);let count=0;
    while(count<size){check(this.signal,this.started);if(this.offset===this.pending.length){const n=await this.next();if(n.done)throw invalid();if(!(n.value instanceof Uint8Array)||n.value.length>65536)throw invalid();this.pending=n.value;this.offset=0;if(!this.pending.length)continue;}const bytes=this.pending.subarray(this.offset,this.offset+Math.min(size-count,this.pending.length-this.offset));out.set(bytes,count);count+=bytes.length;this.offset+=bytes.length;}return out;
  }
  async end():Promise<void>{if(this.offset!==this.pending.length)throw invalid();while(true){const n=await this.next();if(n.done)return;if(!(n.value instanceof Uint8Array)||n.value.byteLength)throw invalid();}}
  close(){void this.iterator.return?.().catch(()=>{});}
}
function frame(value:unknown):Uint8Array {const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>4096)throw invalid();const out=Buffer.alloc(4+bytes.length);out.writeUInt32BE(bytes.length);bytes.copy(out,4);return out;}
export async function receiveTransfer(input:AsyncIterable<Uint8Array>,bridge:SandboxFileBridge,signal:AbortSignal):Promise<string>{
  const started=performance.now(),deadline=AbortSignal.timeout(120000),combined=AbortSignal.any([signal,deadline]),reader=new Reader(input,combined,started),seen=new Map<string,FileEntry>(),entries:FileEntry[]=[];let total=0,key:string|undefined,success=false;
  try {check(signal,started);key=await bridge.createSnapshot();while(true){const headerSize=Buffer.from(await reader.take(4)).readUInt32BE();if(!headerSize||headerSize>4096)throw invalid();let header:any;try{header=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await reader.take(headerSize)));}catch{throw invalid();}
    if(!header||typeof header!=="object"||Array.isArray(header))throw invalid();if(header.type==="end"){if(Object.keys(header).length!==1)throw invalid();await reader.end();break;}
    if(header.type!=="entry"||Object.keys(header).length!==2)throw invalid();const parsed=fileEntrySchema.safeParse(header.entry);if(!parsed.success)throw invalid();const entry=parsed.data,path=sandboxPath(entry.relativePath),canonical=path.toLowerCase();if(seen.has(canonical))throw new AppError("UNSAFE_PATH","重复或碰撞的文件路径");
    const parents=path.split("/").slice(0,-1);for(let i=1;i<=parents.length;i++)if(seen.get(parents.slice(0,i).join("/").toLowerCase())?.kind!=="directory")throw invalid();
    if(entries.length>=10000||(total+=entry.size)>1024**3)throw new AppError("WORKSPACE_LIMIT","工作区传输超过限额");seen.set(canonical,entry);entries.push(entry);
    if(entry.kind==="directory")await bridge.directory(key,path);else {const hash=createHash("sha256"),size=entry.size;async function* bytes(){let remaining=size;while(remaining){const chunk=await reader.take(Math.min(remaining,65536));hash.update(chunk);remaining-=chunk.length;yield chunk;}if(hash.digest("hex")!==entry.sha256)throw invalid();}await bridge.write(key,path,bytes());}
  }check(signal,started);const manifest=await bridge.manifest(key),sort=(e:FileEntry[])=>JSON.stringify([...e].sort((a,b)=>a.relativePath<b.relativePath?-1:a.relativePath>b.relativePath?1:0));if(sort(manifest)!==sort(entries))throw invalid();success=true;return key;
  }catch(e){if(deadline.aborted&&!signal.aborted)throw new AppError("TRANSFER_TIMEOUT","文件传输超时");throw e;}finally{reader.close();if(key&&!success)await bridge.discard(key).catch(()=>{});}
}
export async function* encodeTransfer(key:string,bridge:SandboxFileBridge,signal:AbortSignal):AsyncIterable<Uint8Array>{
  const started=performance.now();for(const entry of await bridge.manifest(key)){check(signal,started);sandboxPath(entry.relativePath);yield frame({type:"entry",entry});if(entry.kind==="file"){let size=0;const hash=createHash("sha256");for await(const bytes of bridge.read(key,entry.relativePath)){check(signal,started);if(bytes.length>65536||(size+=bytes.length)>entry.size)throw invalid();hash.update(bytes);yield bytes;}if(size!==entry.size||hash.digest("hex")!==entry.sha256)throw invalid();}}yield frame({type:"end"});
}

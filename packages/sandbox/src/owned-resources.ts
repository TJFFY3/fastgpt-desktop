import { chmod, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/src/index";
import type { DockerExecutor } from "./docker-client";
import type { SandboxExecution } from "./types";
import { immutableImage } from "./policy";
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const container=/^[a-f0-9]{64}$/;
export type OwnedResource={token:string;owner:SandboxExecution["owner"];engineId:string;imageId:string;containerId:string|null};
function valid(value:unknown):value is OwnedResource {
  const r=value as OwnedResource|undefined;
  return !!r&&Object.keys(r).sort().join(",")==="containerId,engineId,imageId,owner,token"&&uuid.test(r.token)&&typeof r.engineId==="string"&&r.engineId.length>0&&r.engineId.length<=256&&immutableImage(r.imageId)&&(r.containerId===null||container.test(r.containerId))&&!!r.owner&&Object.keys(r.owner).sort().join(",")==="callId,namespaceKey,runId,sessionId"&&Object.entries(r.owner).every(([key,v])=>typeof v==="string"&&v.length>0&&v.length<=(key==="namespaceKey"?2048:512))&&Buffer.byteLength(JSON.stringify(r))<=16384;
}
export class OwnedResources {
  constructor(private directory:string) {}
  private async ready(){await mkdir(this.directory,{recursive:true,mode:0o700});const s=await lstat(this.directory);if(!s.isDirectory()||s.isSymbolicLink())throw new AppError("UNSAFE_PATH","沙箱归属目录无效");await chmod(this.directory,0o700);}
  private async read(token:string):Promise<OwnedResource>{if(!uuid.test(token))throw new AppError("INVALID_INPUT","沙箱归属无效");const file=await open(join(this.directory,`${token}.json`),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await file.stat();if(!s.isFile()||s.nlink!==1||s.size>16384)throw new Error("invalid");const raw=await file.readFile();if(raw.length>16384)throw new Error("invalid");const record:unknown=JSON.parse(raw.toString("utf8"));if(!valid(record)||record.token!==token)throw new Error("invalid");return record;}finally{await file.close();}}
  private async write(record:OwnedResource,replace=false){await this.ready();if(!valid(record))throw new AppError("INVALID_INPUT","沙箱归属无效");const path=join(this.directory,`${record.token}.json`),pending=replace?join(this.directory,`${record.token}.${randomUUID()}.tmp`):path;const file=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(JSON.stringify(record));await file.sync();}finally{await file.close();}if(replace)try{await rename(pending,path);}catch(e){await unlink(pending).catch(()=>{});throw e;}}
  async reserve(owner:OwnedResource["owner"],engineId:string,imageId:string):Promise<OwnedResource>{const record={token:randomUUID(),owner:{...owner},engineId,imageId,containerId:null};await this.write(record);return record;}
  async bind(record:OwnedResource,id:string):Promise<OwnedResource>{if(!container.test(id)||JSON.stringify(await this.read(record.token))!==JSON.stringify(record))throw new AppError("CONFIG_CHANGED","沙箱归属记录已变化");const bound={...record,containerId:id};await this.write(bound,true);return bound;}
  async list():Promise<OwnedResource[]>{await this.ready();const entries=await readdir(this.directory);if(entries.length>4096)throw new AppError("SANDBOX_UNAVAILABLE","沙箱归属记录过多");const records:OwnedResource[]=[];for(const name of entries)if(name.endsWith(".json")&&uuid.test(name.slice(0,-5)))try{records.push(await this.read(name.slice(0,-5)));}catch{/* malformed ownership grants no authority */}return records;}
  private matches(record:OwnedResource,value:any):boolean{return value?.Id===record.containerId&&value.Name===`/fastgpt-${record.token}`&&value.Image===record.imageId&&value.Config?.Labels?.["org.fastgpt.desktop.owner"]===record.token;}
  private async resolve(client:DockerExecutor,record:OwnedResource,engineId:string):Promise<{record:OwnedResource;exists:boolean}|null>{
    if(record.engineId!==engineId)return null;const current=await client.run(["info","--format","{{json .}}"]);try{if(current.code!==0||JSON.parse(current.stdout).ID!==record.engineId)return null;}catch{return null;}const actual=await this.read(record.token);if(JSON.stringify(actual)!==JSON.stringify(record))return null;
    const found=await client.run(["ps","-aq","--no-trunc","--filter",`label=org.fastgpt.desktop.owner=${record.token}`]);if(found.code!==0)return null;const ids=found.stdout.trim().split(/\s+/).filter(Boolean);if(!ids.length)return {record,exists:false};if(ids.length!==1||!container.test(ids[0])||record.containerId&&ids[0]!==record.containerId)return null;
    const bound={...record,containerId:ids[0]},inspect=await client.run(["inspect",ids[0]]);let value:any;try{value=JSON.parse(inspect.stdout)?.[0];}catch{return null;}return inspect.code===0&&this.matches(bound,value)?{record:bound,exists:true}:null;
  }
  async kill(client:DockerExecutor,record:OwnedResource,engineId:string):Promise<void>{const resolved=await this.resolve(client,record,engineId);if(resolved?.exists)await client.run(["kill","--signal","KILL",resolved.record.containerId!]);}
  async cleanup(client:DockerExecutor,record:OwnedResource,engineId:string):Promise<boolean>{const resolved=await this.resolve(client,record,engineId);if(!resolved)return false;if(resolved.exists){const result=await client.run(["rm","-f",resolved.record.containerId!]);if(result.code!==0)return false;}await unlink(join(this.directory,`${record.token}.json`));return true;}
}

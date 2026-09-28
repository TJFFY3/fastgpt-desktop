import { AppError, type CommandFinishReason, type SandboxAvailability, type SandboxFileBridge } from "../../shared/src/index";
import { once } from "node:events";
import type { Readable } from "node:stream";
import type { DockerExecutor, DockerProcess } from "./docker-client";
import type { ImageService } from "./image-service";
import type { SandboxExecution, SandboxProvider, SandboxResult } from "./types";
import { ExecutionQueue } from "./execution-queue";
import { OwnedResources, type OwnedResource } from "./owned-resources";
import { assertCapabilities, containerArgs, sandboxPath } from "./policy";
import { assertIsolation, assertQuiescent, type Probe } from "./isolation";
import { encodeTransfer, receiveTransfer } from "./transfer";
export type ProviderOptions={client:DockerExecutor;images:ImageService;files:SandboxFileBridge;stateDirectory:string};
const execArgs=(id:string,operation:string,...args:string[])=>["exec",...(operation==="import"?["-i"]:[]),id,"/usr/bin/python3","-I",`/opt/fastgpt/${operation==="import"||operation==="export"?"transfer":"runner"}.py`,operation,...args];
class PlainText {
  private state:"text"|"escape"|"csi"|"osc"|"oscEscape"="text";
  filter(text:string):string {let result="";for(const c of text){const code=c.codePointAt(0)!;if(this.state==="text"){if(code===27)this.state="escape";else if(code>=32&&code!==127&&(code<128||code>159)||c==="\n"||c==="\r"||c==="\t")result+=c;}
    else if(this.state==="escape")this.state=c==="["?"csi":c==="]"?"osc":"text";
    else if(this.state==="csi"){if(code>=64&&code<=126)this.state="text";}
    else if(this.state==="osc"){if(code===7)this.state="text";else if(code===27)this.state="oscEscape";}
    else this.state=c==="\\"?"text":"osc";}return result;}
}
type Operation={input:SandboxExecution;abort:AbortController;promise:Promise<SandboxResult>};
export class DockerSandboxProvider implements SandboxProvider {
  private queue=new ExecutionQueue();private resources:OwnedResources;private operations=new Map<string,Operation>();private closed=false;
  private timings=new Map<string,{started:number;elapsedMs:number;active:boolean}>();
  constructor(private o:ProviderOptions){this.resources=new OwnedResources(o.stateDirectory);}
  private async engine():Promise<string>{await this.o.client.assertLocal();const result=await this.o.client.run(["info","--format","{{json .}}"]);let info:any;try{info=JSON.parse(result.stdout);}catch{throw new AppError("SANDBOX_UNAVAILABLE","容器引擎信息无效");}assertCapabilities(info);if(result.code!==0||typeof info.ID!=="string"||!info.ID.length||info.ID.length>256)throw new AppError("SANDBOX_UNAVAILABLE","无法确定容器引擎归属");return info.ID;}
  async detect():Promise<SandboxAvailability>{try{await this.engine();const imageReady=!!await this.o.images.getReadyImage();return {available:true,reason:imageReady?null:"IMAGE_NOT_READY",imageReady};}catch(e){return {available:false,reason:e instanceof AppError?e.code:"SANDBOX_UNAVAILABLE",imageReady:false};}}
  async prepareImage(signal:AbortSignal,progress:(text:string)=>void):Promise<{imageId:string}>{if(this.closed)throw new AppError("CANCELLED","沙箱已关闭");await this.engine();return this.o.images.prepare(signal,progress);}
  timing(runId:string,callId:string):{elapsedMs:number;active:boolean}{const t=this.timings.get(`${runId}:${callId}`);return t?{elapsedMs:t.active?Math.max(t.elapsedMs,performance.now()-t.started):t.elapsedMs,active:t.active}:{elapsedMs:0,active:false};}
  async execute(input:SandboxExecution):Promise<SandboxResult>{
    if(this.closed||input.signal.aborted)return {reason:"cancelled",exitCode:null,elapsedMs:0,truncated:false,snapshotKey:null};
    if(!input.command.trim()||Buffer.byteLength(input.command)>16384||input.command.includes("\0")||Buffer.byteLength(input.cwd)>1024)throw new AppError("INVALID_INPUT","命令或相对目录无效");if(input.cwd!==".")sandboxPath(input.cwd);
    const key=`${input.owner.runId}:${input.owner.callId}`;if(this.operations.has(key))throw new AppError("RUN_ACTIVE","命令调用已在执行");
    const abort=new AbortController(),signal=AbortSignal.any([abort.signal,input.signal]);const promise=this.queue.run(signal,()=>this.perform({...input,signal},key,abort)).catch(e=>{if(signal.aborted||e instanceof AppError&&e.code==="CANCELLED")return {reason:"cancelled" as const,exitCode:null,elapsedMs:0,truncated:false,snapshotKey:null};throw e;}).finally(()=>this.operations.delete(key));this.operations.set(key,{input,abort,promise});return promise;
  }
  private async inspect(record:OwnedResource,signal:AbortSignal):Promise<{container:any;probe:Probe}>{const [metadata,measurement]=await Promise.all([this.o.client.run(["inspect",record.containerId!],signal),this.o.client.run(execArgs(record.containerId!,"probe"),signal)]);let container:any,probe:unknown;try{container=JSON.parse(metadata.stdout)?.[0];probe=JSON.parse(measurement.stdout);}catch{throw new AppError("SANDBOX_UNAVAILABLE","隔离验证失败");}if(metadata.code!==0||measurement.code!==0)throw new AppError("SANDBOX_UNAVAILABLE","隔离验证失败");assertIsolation(record,container,probe);return {container,probe};}
  private async stderr(process:DockerProcess):Promise<void>{let size=0;for await(const bytes of process.stderr)if((size+=bytes.length)>65536){process.kill();throw new AppError("TRANSFER_INVALID","文件传输诊断输出超限");}}
  private async upload(record:OwnedResource,input:SandboxExecution){const process=await this.o.client.start(execArgs(record.containerId!,"import"),{signal:input.signal});process.stdin.on("error",()=>{});
    try {const write=async()=>{for await(const bytes of encodeTransfer(input.snapshotKey,this.o.files,input.signal)){if(input.signal.aborted)throw new AppError("CANCELLED","传输已取消");if(!process.stdin.write(bytes))await once(process.stdin,"drain",{signal:input.signal});}process.stdin.end();};const [result]=await Promise.all([process.wait(),write(),this.stderr(process)]);if(result.code!==0||input.signal.aborted)throw new AppError("TRANSFER_INVALID","工作区导入失败");}catch(e){process.kill();throw e;}
  }
  private async download(record:OwnedResource,signal:AbortSignal):Promise<string>{const process=await this.o.client.start(execArgs(record.containerId!,"export"),{signal});process.stdin.end();let key:string|undefined;
    async function* chunks(stream:Readable){for await(const bytes of stream)for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);}
    try{const [result,snapshot]=await Promise.all([process.wait(),receiveTransfer(chunks(process.stdout),this.o.files,signal).then(k=>{key=k;return k;}),this.stderr(process)]);if(result.code!==0||signal.aborted)throw new AppError("TRANSFER_INVALID","工作区导出失败");return snapshot;}catch(e){process.kill();if(key)await this.o.files.discard(key).catch(()=>{});throw e;}
  }
  private async perform(input:SandboxExecution,key:string,abort:AbortController):Promise<SandboxResult>{
    let record:OwnedResource|undefined,engineId="",process:DockerProcess|undefined,started=false,snapshotKey:string|null=null,exitCode:number|null=null,reason:CommandFinishReason="failed",elapsedMs=0,truncated=false,stopCause:CommandFinishReason|undefined,kill:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
    const stop=(cause:CommandFinishReason)=>{if(!stopCause)stopCause=cause;abort.abort();process?.kill();if(record&&!kill)kill=this.resources.kill(this.o.client,record,engineId).catch(()=>{});};
    const cancelled=()=>{if(started)stop(stopCause??"cancelled");};input.signal.addEventListener("abort",cancelled,{once:true});
    try {engineId=await this.engine();const imageId=await this.o.images.getReadyImage();if(!imageId)throw new AppError("IMAGE_NOT_READY","请先明确准备沙箱镜像");if(input.signal.aborted)throw new AppError("CANCELLED","命令已取消");record=await this.resources.reserve(input.owner,engineId,imageId);
      const created=await this.o.client.run(containerArgs(imageId,record.token),input.signal);if(created.code!==0)throw new AppError("SANDBOX_UNAVAILABLE","无法创建隔离容器");record=await this.resources.bind(record,created.stdout.trim());const running=await this.o.client.run(["start",record.containerId!],input.signal);if(running.code!==0)throw new AppError("SANDBOX_UNAVAILABLE","无法启动隔离容器");
      const before=await this.inspect(record,input.signal);await this.upload(record,input);await this.o.files.discard(input.snapshotKey);if(input.signal.aborted)throw new AppError("CANCELLED","命令已取消");
      process=await this.o.client.start(execArgs(record.containerId!,"command",input.cwd,input.command),{signal:input.signal,timeoutMs:125000});started=true;const timing={started:performance.now(),elapsedMs:0,active:true};this.timings.set(key,timing);timer=setTimeout(()=>stop("timeout"),120000);timer.unref();await input.onEvent({type:"command_started",id:input.owner.callId,command:input.command,cwd:input.cwd});
      let raw=0,rendered=0;const output=async(stream:Readable,channel:"stdout"|"stderr")=>{const decoder=new TextDecoder(),plain=new PlainText();const publish=async(text:string)=>{const filtered=plain.filter(text);let offset=0;while(offset<filtered.length){let end=Math.min(offset+8192,filtered.length);if(end<filtered.length&&/[\uD800-\uDBFF]/.test(filtered[end-1]))end--;const part=filtered.slice(offset,end);offset=end;if((rendered+=Buffer.byteLength(part))>1024*1024){truncated=true;stop("output_limit");return;}if(part)await input.onEvent({type:"command_output",id:input.owner.callId,channel,text:part});}};
        for await(const bytes of stream){if(stopCause)return;const allowed=Math.max(0,1024*1024-raw);raw+=bytes.length;await publish(decoder.decode(bytes.subarray(0,allowed),{stream:true}));if(raw>1024*1024){truncated=true;stop("output_limit");return;}}if(!stopCause)await publish(decoder.decode());};
      const [completed]=await Promise.all([process.wait(),output(process.stdout,"stdout"),output(process.stderr,"stderr")]);clearTimeout(timer);timer=undefined;timing.elapsedMs=Math.max(0,performance.now()-timing.started);timing.active=false;elapsedMs=timing.elapsedMs;
      if(stopCause)reason=stopCause;else {exitCode=completed.code;const after=await this.inspect(record,input.signal);if(after.container.State.OOMKilled===true||after.probe.oomKills>before.probe.oomKills){reason="oom";stop("oom");}else{assertQuiescent(before.probe,after.probe);if(completed.code===null)throw new AppError("SANDBOX_UNAVAILABLE","命令状态无法确认");snapshotKey=await this.download(record,input.signal);reason="exited";}}
    }catch{reason=stopCause??(input.signal.aborted?"cancelled":"failed");if(started&&record&&reason==="failed")try{const metadata=await this.o.client.run(["inspect",record.containerId!]),c=JSON.parse(metadata.stdout)?.[0];if(metadata.code===0&&c?.Id===record.containerId&&c.Image===record.imageId&&c.Name===`/fastgpt-${record.token}`&&c.Config?.Labels?.["org.fastgpt.desktop.owner"]===record.token&&c.State?.OOMKilled===true)reason="oom";}catch{/* no evidence: keep failed */}if(started)stop(reason);}
    finally {if(timer)clearTimeout(timer);input.signal.removeEventListener("abort",cancelled);const timing=this.timings.get(key);if(timing?.active){timing.elapsedMs=Math.max(0,performance.now()-timing.started);timing.active=false;elapsedMs=timing.elapsedMs;}if(kill)await kill;
      let clean=true;if(record)try{clean=await this.resources.cleanup(this.o.client,record,engineId);}catch{clean=false;}
      if(!clean||reason!=="exited"||input.signal.aborted){if(snapshotKey)await this.o.files.discard(snapshotKey).catch(()=>{});snapshotKey=null;if(reason==="exited")reason=input.signal.aborted?"cancelled":"failed";}
      if(started)try{await input.onEvent({type:"command_finished",id:input.owner.callId,exitCode,reason,elapsedMs,truncated});}catch(e){if(snapshotKey)await this.o.files.discard(snapshotKey).catch(()=>{});throw e;}while(this.timings.size>1000)this.timings.delete(this.timings.keys().next().value!);
    }return {exitCode,reason,elapsedMs,truncated,snapshotKey};
  }
  async cancel(runId:string):Promise<void>{const matching=[...this.operations.values()].filter(o=>o.input.owner.runId===runId);for(const op of matching)op.abort.abort();await Promise.allSettled(matching.map(o=>o.promise));}
  async cleanupOwned():Promise<void>{const engine=await this.engine();for(const record of await this.resources.list())if(![...this.operations.values()].some(o=>o.input.owner.runId===record.owner.runId&&o.input.owner.callId===record.owner.callId))await this.resources.cleanup(this.o.client,record,engine);}
  async shutdown():Promise<void>{this.closed=true;this.queue.close();const operations=[...this.operations.values()];for(const op of operations)op.abort.abort();await Promise.allSettled(operations.map(o=>o.promise));await this.cleanupOwned().catch(()=>{});}
}

import type { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { AppError } from "../../shared/src/index";
import { localEndpoint } from "./policy";
export type DockerProcess={stdin:Writable;stdout:Readable;stderr:Readable;wait():Promise<{code:number|null;signal:NodeJS.Signals|null}>;kill():void};
export interface DockerExecutor {assertLocal():Promise<void>;run(args:string[],signal?:AbortSignal):Promise<{stdout:string;stderr:string;code:number|null}>;start(args:string[],options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<DockerProcess>;}
export class DockerClient implements DockerExecutor {
  private env:NodeJS.ProcessEnv;private host:string;private selected:string;private contextName="";private endpoint="";private connected:Promise<void>|undefined;
  constructor(private executable:string,options:{configurationDirectory?:string;host?:string;context?:string}={}) {
    this.host=options.host??process.env.DOCKER_HOST??"";this.selected=options.context??process.env.DOCKER_CONTEXT??"";
    this.env={PATH:[dirname(executable),"/usr/bin","/bin"].join(process.platform==="win32"?";":":"),HOME:homedir(),DOCKER_CONFIG:options.configurationDirectory??join(homedir(),".docker"),LANG:"C.UTF-8",LC_ALL:"C.UTF-8",...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})};
  }
  private async rawStart(args:string[],options:{signal?:AbortSignal;timeoutMs?:number}={}):Promise<DockerProcess> {
    if(!isAbsolute(this.executable)||args.length>256||args.some(a=>typeof a!=="string"||a.includes("\0"))||args.reduce((n,a)=>n+Buffer.byteLength(a),0)>65536)throw new AppError("INVALID_INPUT","Docker 命令参数无效");
    if(options.signal?.aborted)throw new AppError("CANCELLED","Docker 操作已取消");const executable=await realpath(this.executable).catch(()=>{throw new AppError("SANDBOX_UNAVAILABLE","未找到 Docker 客户端");});await access(executable,constants.X_OK);
    const child=spawn(executable,[...args],{shell:false,windowsHide:true,env:this.env,stdio:["pipe","pipe","pipe"]});
    const abort=()=>child.kill("SIGKILL"),timer=setTimeout(abort,options.timeoutMs??120000);timer.unref();options.signal?.addEventListener("abort",abort,{once:true});if(options.signal?.aborted)abort();
    const finished=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once("error",()=>reject(new AppError("SANDBOX_UNAVAILABLE","Docker 客户端无法启动")));child.once("close",(code,signal)=>resolve({code,signal}));}).finally(()=>{clearTimeout(timer);options.signal?.removeEventListener("abort",abort);});void finished.catch(()=>{});
    return {stdin:child.stdin,stdout:child.stdout,stderr:child.stderr,wait:()=>finished,kill:()=>{child.kill("SIGKILL");}};
  }
  private async collect(process:DockerProcess):Promise<{stdout:string;stderr:string;code:number|null}> {
    let total=0;const read=async(stream:Readable)=>{const chunks:Buffer[]=[];for await(const bytes of stream){total+=bytes.length;if(total>1024*1024){process.kill();throw new AppError("DOCKER_OUTPUT_LIMIT","Docker 控制输出超限");}chunks.push(bytes);}return Buffer.concat(chunks).toString("utf8");};
    try {const [stdout,stderr,result]=await Promise.all([read(process.stdout),read(process.stderr),process.wait()]);return {stdout,stderr,code:result.code};}catch(e){process.kill();throw e;}
  }
  private async inspectContext(name:string):Promise<string> {
    if(!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(name))throw new AppError("SANDBOX_UNAVAILABLE","Docker 上下文无效");const result=await this.collect(await this.rawStart(["context","inspect",name],{timeoutMs:10000}));
    let endpoint:unknown;try {endpoint=JSON.parse(result.stdout)?.[0]?.Endpoints?.docker?.Host;}catch{/* deny malformed metadata */}
    if(result.code!==0||typeof endpoint!=="string"||!localEndpoint(endpoint))throw new AppError("DOCKER_REMOTE","只允许命名的本机 Docker 容器引擎");return endpoint;
  }
  private connect():Promise<void> {return this.connected??=(async()=>{if(this.host)throw new AppError("DOCKER_REMOTE","请使用命名的本机 Docker 上下文，而非 DOCKER_HOST 覆盖");const result=this.selected?null:await this.collect(await this.rawStart(["context","show"],{timeoutMs:10000}));if(result&&result.code!==0)throw new AppError("SANDBOX_UNAVAILABLE","无法读取 Docker 上下文");const name=this.selected||result!.stdout.trim(),endpoint=await this.inspectContext(name);this.contextName=name;this.endpoint=endpoint;})();}
  async assertLocal():Promise<void>{await this.connect();if(await this.inspectContext(this.contextName)!==this.endpoint)throw new AppError("CONFIG_CHANGED","Docker 上下文的连接已变化，请重启应用后检查");}
  async run(args:string[],signal?:AbortSignal):Promise<{stdout:string;stderr:string;code:number|null}>{return this.collect(await this.start(args,{signal,timeoutMs:10000}));}
  async start(args:string[],options?:{signal?:AbortSignal;timeoutMs?:number}):Promise<DockerProcess>{const values=[...args];await this.assertLocal();return this.rawStart(["--context",this.contextName,...values],options);}
}

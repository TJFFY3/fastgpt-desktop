import { AppError } from "../../shared/src/index";
import { constants } from "node:fs";
import { open, mkdir, lstat, chmod, mkdtemp, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DockerExecutor } from "./docker-client";
import { immutableImage } from "./policy";
const names=["Dockerfile","runner.py","transfer.py",".dockerignore"];
async function boundedFile(path:string,max:number):Promise<Buffer> {const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await file.stat();if(!before.isFile()||before.nlink!==1||before.size>max)throw new AppError("IMAGE_UNTRUSTED","镜像输入无效");const buffer=Buffer.alloc(max+1),{bytesRead}=await file.read(buffer,0,buffer.length,0),after=await file.stat();if(bytesRead>max||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new AppError("IMAGE_UNTRUSTED","镜像输入已变化");return buffer.subarray(0,bytesRead);}finally{await file.close();}}
async function inputs(directory:string):Promise<{hash:string;files:Map<string,Buffer>}> {const files=new Map<string,Buffer>(),hash=createHash("sha256");for(const name of names){const bytes=await boundedFile(join(directory,name),65536);hash.update(name).update("\0").update(bytes);files.set(name,bytes);}return {hash:hash.digest("hex"),files};}
export async function trustedInputHash(directory:string):Promise<string>{return (await inputs(directory)).hash;}
export class ImageService {
  private preparing=false;
  constructor(private o:{client:DockerExecutor;assetDirectory:string;stateDirectory:string}) {}
  private async directory():Promise<void>{await mkdir(this.o.stateDirectory,{recursive:true,mode:0o700});const stat=await lstat(this.o.stateDirectory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new AppError("IMAGE_UNTRUSTED","镜像记录目录无效");await chmod(this.o.stateDirectory,0o700);}
  private async inspect(imageId:string,sourceHash:string):Promise<void>{if(!immutableImage(imageId))throw new AppError("IMAGE_UNTRUSTED","镜像 ID 无效");const result=await this.o.client.run(["image","inspect",imageId]);let image:any;try{image=JSON.parse(result.stdout)?.[0];}catch{/* fail closed */}
    const env=image?.Config?.Env,seen=new Set<string>(),safeEnv=Array.isArray(env)&&env.length<=8&&env.every((e:unknown)=>{if(typeof e!=="string"||e.length>8192||e.includes("\0"))return false;const key=e.split("=",1)[0];if(seen.has(key)||!["PATH","NODE_VERSION","YARN_VERSION"].includes(key))return false;seen.add(key);return true;});
    if(result.code!==0||image?.Id!==imageId||!safeEnv||image.Config?.User!=="1000:1000"||image.Config?.WorkingDir!=="/workspace"||image.Config?.Labels?.["org.fastgpt.desktop.source"]!==sourceHash||image.Config?.Volumes&&Object.keys(image.Config.Volumes).length||image.Config?.Entrypoint?.length)throw new AppError("IMAGE_UNTRUSTED","镜像内容或来源未通过验证");}
  async getReadyImage():Promise<string|null>{
    try {const record=JSON.parse((await boundedFile(join(this.o.stateDirectory,"image.json"),2048)).toString("utf8"));if(Object.keys(record).length!==2||!immutableImage(record.imageId)||record.sourceHash!==await trustedInputHash(this.o.assetDirectory))return null;await this.o.client.assertLocal();await this.inspect(record.imageId,record.sourceHash);return record.imageId;}catch{return null;}
  }
  async prepare(signal:AbortSignal,onProgress:(text:string)=>void):Promise<{imageId:string}>{
    if(signal.aborted)throw new AppError("CANCELLED","已取消镜像准备");if(this.preparing)throw new AppError("IMAGE_PREPARING","镜像正在准备");this.preparing=true;let context:string|undefined,pending:string|undefined,process:Awaited<ReturnType<DockerExecutor["start"]>>|undefined;
    try {await this.o.client.assertLocal();const source=await inputs(this.o.assetDirectory);await this.directory();context=await mkdtemp(join(this.o.stateDirectory,"build-"));
      for(const [name,bytes]of source.files){const handle=await open(join(context,name),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(bytes);}finally{await handle.close();}}
      if(signal.aborted)throw new AppError("CANCELLED","已取消镜像准备");const iid=join(context,"image-id");process=await this.o.client.start(["build","--pull","--progress","plain","--iidfile",iid,"--label",`org.fastgpt.desktop.source=${source.hash}`,"--file",join(context,"Dockerfile"),context],{signal,timeoutMs:600000});
      let count=0;const progress=async(stream:AsyncIterable<Uint8Array>)=>{const decoder=new TextDecoder();for await(const bytes of stream){if((count+=bytes.byteLength)>1024*1024){process!.kill();throw new AppError("IMAGE_BUILD_FAILED","镜像构建输出超限");}if(signal.aborted)throw new AppError("CANCELLED","已取消镜像准备");const text=decoder.decode(bytes,{stream:true});if(text)onProgress(text);}const tail=decoder.decode();if(tail)onProgress(tail);};
      const [result]=await Promise.all([process.wait(),progress(process.stdout),progress(process.stderr)]);if(signal.aborted)throw new AppError("CANCELLED","已取消镜像准备");if(result.code!==0)throw new AppError("IMAGE_BUILD_FAILED","镜像构建失败，请检查本机 Docker 与网络");
      const imageId=(await boundedFile(iid,256)).toString("utf8").trim();await this.inspect(imageId,source.hash);if(await trustedInputHash(this.o.assetDirectory)!==source.hash)throw new AppError("CONFIG_CHANGED","镜像构建输入已变化，请重新准备");if(signal.aborted)throw new AppError("CANCELLED","已取消镜像准备");
      pending=join(this.o.stateDirectory,`${randomUUID()}.json.tmp`);const record=await open(pending,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await record.writeFile(JSON.stringify({imageId,sourceHash:source.hash}));await record.sync();}finally{await record.close();}await rename(pending,join(this.o.stateDirectory,"image.json"));pending=undefined;return {imageId};
    }catch(e){process?.kill();throw e;}finally{this.preparing=false;if(pending)await unlink(pending).catch(()=>{});if(context)await rm(context,{recursive:true,force:true});}
  }
}

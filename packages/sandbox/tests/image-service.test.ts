import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { afterEach, expect, test } from "vitest";
import { AppError } from "../../shared/src/index";
import { ImageService, trustedInputHash } from "../src/image-service";
import type { DockerExecutor, DockerProcess } from "../src/docker-client";
const dirs:string[]=[];afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true});});
const imageId="sha256:"+"a".repeat(64);
async function setup(){const root=await mkdtemp(join(tmpdir(),"fastgpt-image-"));dirs.push(root);const assets=join(root,"assets"),state=join(root,"state");await mkdir(assets);for(const name of ["Dockerfile","runner.py","transfer.py",".dockerignore"])await writeFile(join(assets,name),`trusted ${name}`);return {root,assets,state};}
class FakeDocker implements DockerExecutor {
  calls:string[][]=[];source="";progress="building\n";kills=0;remote=false;contextFiles:string[]=[];user="1000:1000";env:string[]=[];
  async assertLocal(){if(this.remote)throw new AppError("DOCKER_REMOTE","remote");}
  async run(args:string[]){this.calls.push(args);return {code:0,stderr:"",stdout:JSON.stringify([{Id:imageId,Config:{Env:this.env,User:this.user,WorkingDir:"/workspace",Volumes:null,Entrypoint:null,Labels:{"org.fastgpt.desktop.source":this.source}}}])};}
  async start(args:string[]):Promise<DockerProcess>{this.calls.push(args);this.contextFiles=await readdir(args.at(-1)!);await writeFile(args[args.indexOf("--iidfile")+1],imageId);this.source=args[args.indexOf("--label")+1].split("=")[1];return {stdin:new PassThrough(),stdout:Readable.from([Buffer.from(this.progress)]),stderr:Readable.from([]),wait:async()=>({code:0,signal:null}),kill:()=>{this.kills++;}};}
}
test("only explicit preparation pins an inspected image and current trusted build-input hash",async()=>{
  const x=await setup(),client=new FakeDocker(),service=new ImageService({client,assetDirectory:x.assets,stateDirectory:x.state});expect(await service.getReadyImage()).toBeNull();expect(client.calls).toEqual([]);
  const progress:string[]=[];expect(await service.prepare(new AbortController().signal,p=>progress.push(p))).toEqual({imageId});expect(progress.join("")).toContain("building");expect(client.calls[0][0]).toBe("build");
  expect(client.contextFiles.sort()).toEqual([".dockerignore","Dockerfile","runner.py","transfer.py"]);expect(client.calls[0].at(-1)).not.toBe(x.assets);
  const record=JSON.parse(await readFile(join(x.state,"image.json"),"utf8"));expect(record).toEqual({imageId,sourceHash:await trustedInputHash(x.assets)});expect(await service.getReadyImage()).toBe(imageId);
  await writeFile(join(x.assets,"runner.py"),"changed");expect(await service.getReadyImage()).toBeNull();expect(client.calls.filter(c=>c[0]==="build")).toHaveLength(1);
});
test("an inspected root-user image is never persisted as trusted",async()=>{
  const x=await setup(),client=new FakeDocker();client.user="0";const service=new ImageService({client,assetDirectory:x.assets,stateDirectory:x.state});await expect(service.prepare(new AbortController().signal,()=>{})).rejects.toMatchObject({code:"IMAGE_UNTRUSTED"});expect(await service.getReadyImage()).toBeNull();
});
test("unexpected image environment variables are not exposed to commands",async()=>{
  const x=await setup(),client=new FakeDocker();client.env=["OPENAI_API_KEY=sentinel"];const service=new ImageService({client,assetDirectory:x.assets,stateDirectory:x.state});await expect(service.prepare(new AbortController().signal,()=>{})).rejects.toMatchObject({code:"IMAGE_UNTRUSTED"});expect(await service.getReadyImage()).toBeNull();
});
test("remote engine, cancellation and excessive build progress never enable execution",async()=>{
  const x=await setup(),client=new FakeDocker(),service=new ImageService({client,assetDirectory:x.assets,stateDirectory:x.state});client.remote=true;await expect(service.prepare(new AbortController().signal,()=>{})).rejects.toMatchObject({code:"DOCKER_REMOTE"});expect(client.calls).toEqual([]);client.remote=false;
  const cancelled=new AbortController();cancelled.abort();await expect(service.prepare(cancelled.signal,()=>{})).rejects.toMatchObject({code:"CANCELLED"});client.progress="x".repeat(1024*1024+1);
  await expect(service.prepare(new AbortController().signal,()=>{})).rejects.toMatchObject({code:"IMAGE_BUILD_FAILED"});expect(client.kills).toBeGreaterThan(0);expect(await service.getReadyImage()).toBeNull();
});

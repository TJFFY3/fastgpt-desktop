import { z } from "zod";
import { AppError, asAppError, type Namespace } from "../../../../../packages/shared/src/index";
import { namespaceKey, type Store } from "../../../../../packages/storage/src/index";
import { authorizeSender } from "../ipc";
import type { ApprovalService } from "../tools/approval-service";
import type { DockerSandboxProvider } from "../../../../../packages/sandbox/src/index";
import type { ImagePreparation } from "../feature-services";
const id=z.string().min(1).max(512),inputs={"approvals:decide":z.strictObject({id,decision:z.enum(["approved","rejected"])}),"sandbox:detect":z.strictObject({}),"sandbox:prepare":z.strictObject({}),"sandbox:timing":z.strictObject({runId:id,callId:id})};
export function registerApprovalHandlers(ipc:{handle(channel:string,listener:(event:any,raw:unknown)=>Promise<unknown>):void},o:{approvals:ApprovalService;sandbox:DockerSandboxProvider;store:Store;principal:()=>Namespace;window:()=>Parameters<typeof authorizeSender>[1]&{send(channel:string,value:unknown):void};imagePreparation:ImagePreparation;dataDirectory:string;devOrigin?:string}) {
  for(const channel of Object.keys(inputs))ipc.handle(channel,async(event,raw)=>{try{authorizeSender(event,o.window(),o.devOrigin);const parsed=inputs[channel as keyof typeof inputs].safeParse(raw);if(!parsed.success)throw new AppError("INVALID_INPUT","请求参数无效");const n=o.principal(),v=parsed.data as {id?:string;decision?:"approved"|"rejected";runId?:string;callId?:string};const check=()=>{authorizeSender(event,o.window(),o.devOrigin);if(namespaceKey(n)!==namespaceKey(o.principal()))throw new AppError("PERMISSION_DENIED","当前身份已失效");};let data:unknown;
    if(channel==="approvals:decide")data=await o.approvals.decide(n,v.id!,v.decision!);
    else if(channel==="sandbox:detect")data=await o.sandbox.detect();
    else if(channel==="sandbox:timing"){o.store.runs.get(n,v.runId!);data=o.sandbox.timing(v.runId!,v.callId!);}
    else {if(o.imagePreparation.controller)throw new AppError("IMAGE_PREPARING","镜像正在准备");const controller=new AbortController();o.imagePreparation.controller=controller;const promise=o.sandbox.prepareImage(controller.signal,text=>{try{check();const publicText=text.split(o.dataDirectory).join("[应用私有目录]");for(let offset=0;offset<publicText.length;offset+=8192)o.window().send("sandbox:progress",publicText.slice(offset,offset+8192));}catch{controller.abort();}});o.imagePreparation.promise=promise;try{data=await promise;}finally{if(o.imagePreparation.controller===controller){o.imagePreparation.controller=null;o.imagePreparation.promise=null;}}}
    check();return {ok:true,data};}catch(e){const error=asAppError(e);return {ok:false,error:{code:error.code,message:error.safeMessage}};}});
}

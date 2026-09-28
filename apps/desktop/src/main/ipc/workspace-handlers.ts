import { AppError, asAppError, type Namespace } from "../../../../../packages/shared/src/index";
import { authorizeSender } from "../ipc";
import type { WorkspaceService } from "../workspaces/workspace-service";
import { workspaceInputs } from "./feature-inputs";
export function registerWorkspaceHandlers(ipc:{handle(channel:string,listener:(event:any,raw:unknown)=>Promise<unknown>):void},options:{workspaces:WorkspaceService;principal:()=>Namespace;window:()=>Parameters<typeof authorizeSender>[1];devOrigin?:string}) {
  for(const channel of Object.keys(workspaceInputs))ipc.handle(channel,async(event,raw)=>{
    try {authorizeSender(event,options.window(),options.devOrigin);const parsed=workspaceInputs[channel as keyof typeof workspaceInputs].safeParse(raw);if(!parsed.success)throw new AppError("INVALID_INPUT","请求参数无效");const v=parsed.data as {sessionId:string;grantId?:string;cursor?:string;path?:string;offset?:number;maxBytes?:number},n=options.principal(),service=options.workspaces;let data:unknown;
      switch(channel){case"workspaces:ensure":data=await service.ensure(n,v.sessionId);break;case"workspaces:preview":data=await service.previewSelection(n,v.sessionId);break;case"workspaces:import":data=await service.importSelection(n,v.sessionId,v.grantId!,new AbortController().signal);break;case"workspaces:list":data=await service.list(n,v.sessionId,v.cursor);break;case"workspaces:read":data=await service.read(n,v.sessionId,v.path!,v.offset!,v.maxBytes!);break;case"workspaces:diff":data=await service.diff(n,v.sessionId);break;}
      authorizeSender(event,options.window(),options.devOrigin);service.snapshots.check(n,v.sessionId);return {ok:true,data};
    }catch(e){const error=asAppError(e);return {ok:false,error:{code:error.code,message:error.safeMessage}};}
  });
}

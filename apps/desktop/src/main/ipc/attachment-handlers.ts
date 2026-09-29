import { AppError, asAppError, type Namespace } from "../../../../../packages/shared/src/index";
import type { AttachmentService } from "../files/attachment-service";
import type { InputGrants } from "../files/input-grants";
import { authorizeSender } from "../ipc";
import { attachmentInputs } from "./feature-inputs";
import { namespaceKey } from "../../../../../packages/storage/src/index";
export function registerAttachmentHandlers(ipc:{handle(channel:string,listener:(event:any,raw:unknown)=>Promise<unknown>):void},options:{attachments:AttachmentService;grants:InputGrants;principal:()=>Namespace;window:()=>Parameters<typeof authorizeSender>[1];devOrigin?:string;pick:()=>Promise<string[]>;confirmDrop:(paths:string[])=>Promise<boolean>}) {
  const {attachments,grants}=options;
  for(const channel of Object.keys(attachmentInputs))ipc.handle(channel,async(event,raw)=>{
    try {authorizeSender(event,options.window(),options.devOrigin);const parsed=attachmentInputs[channel as keyof typeof attachmentInputs].safeParse(raw);if(!parsed.success)throw new AppError("INVALID_INPUT","请求参数无效");const value=parsed.data as {id?:string;sessionId?:string;paths?:string[]},n=options.principal();let data:unknown;
      if(channel==="attachments:list")data=attachments.list(n,value.sessionId!);
      else if(channel==="attachments:remove")data=await attachments.removeDraft(n,value.id!);
      else {attachments.snapshots.check(n,value.sessionId!);const paths=channel==="attachments:pick"?await options.pick():await options.confirmDrop(value.paths!)?value.paths!:[];
        authorizeSender(event,options.window(),options.devOrigin);attachments.snapshots.check(n,value.sessionId!);
        data=paths.length?await attachments.importPicked(n,value.sessionId!,grants.issue(n,value.sessionId!,event.sender.id,paths),new AbortController().signal):[];
      }authorizeSender(event,options.window(),options.devOrigin);if(namespaceKey(n)!==namespaceKey(options.principal()))throw new AppError("PERMISSION_DENIED","当前身份已失效");if(value.sessionId)attachments.snapshots.check(n,value.sessionId);return {ok:true,data};
    }catch(e){const error=asAppError(e);return {ok:false,error:{code:error.code,message:error.safeMessage}};}
  });
}

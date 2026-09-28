import { useEffect, useRef, useState } from "react";
import type { AttachmentView } from "../../../../../packages/shared/src/index";
type Draft={text:string;files:AttachmentView[];pending:boolean;error:string};
const empty:Draft={text:"",files:[],pending:false,error:""};
export function useDrafts(sessionId:string|null,onFilesChange:()=>Promise<void>) {
  const [drafts,setDrafts]=useState<Record<string,Draft>>({}),tokens=useRef(new Map<string,number>()),alive=useRef(true),working=useRef(new Set<string>());
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const change=(sid:string,fn:(d:Draft)=>Draft)=>{if(alive.current)setDrafts(all=>({...all,[sid]:fn(all[sid]??empty)}));};
  const refresh=async(sid:string)=>{const token=(tokens.current.get(sid)??0)+1;tokens.current.set(sid,token);const files=await window.desktop.attachments.list(sid);if(tokens.current.get(sid)===token)change(sid,d=>({...d,files}));};
  useEffect(()=>{if(sessionId)void refresh(sessionId).catch(e=>change(sessionId,d=>({...d,error:String(e)})));},[sessionId]);
  const operation=async(sid:string,fn:()=>Promise<unknown>)=>{
    if(working.current.has(sid))return;working.current.add(sid);tokens.current.set(sid,(tokens.current.get(sid)??0)+1);change(sid,d=>({...d,pending:true,error:""}));
    try{await fn();await refresh(sid);await onFilesChange();}catch(e){change(sid,d=>({...d,error:String(e).replace(/^Error:\s*/,"")}));}
    finally{working.current.delete(sid);change(sid,d=>({...d,pending:false}));}
  };
  return {draft:sessionId?drafts[sessionId]??empty:empty,
    setText:(text:string)=>{if(sessionId)change(sessionId,d=>({...d,text}));},
    appendText:(sid:string,text:string)=>change(sid,d=>({...d,text:d.text?`${d.text}\n${text}`:text})),
    clearError:()=>{if(sessionId)change(sessionId,d=>({...d,error:""}));},
    pick:()=>sessionId?operation(sessionId,()=>window.desktop.attachments.pick(sessionId)):Promise.resolve(),
    drop:(files:File[])=>sessionId?operation(sessionId,()=>window.desktop.attachments.importDropped(sessionId,files)):Promise.resolve(),
    remove:(id:string)=>sessionId?operation(sessionId,()=>window.desktop.attachments.removeDraft(id)):Promise.resolve(),
    sent:async(sid:string,text:string,attachmentIds:string[])=>{const consumed=new Set(attachmentIds);change(sid,d=>({...d,text:d.text.trim()===text?"":d.text,files:d.files.map(file=>consumed.has(file.id)?{...file,state:"sent"}:file)}));await refresh(sid);},
  };
}

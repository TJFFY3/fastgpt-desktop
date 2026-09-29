import type { AttachmentView } from "../../../../../packages/shared/src/index";
export function AttachmentList({files,disabled=false,onRemove}:{files:AttachmentView[];disabled?:boolean;onRemove?:(id:string)=>void}) {
  return files.length?<div className="attachment-list">{files.map(a=><div className="attachment-card" key={a.id}><span aria-hidden="true">▤</span><div><strong>{a.name}</strong><small>{a.size<1024?`${a.size} B`:`${(a.size/1024).toFixed(1)} KiB`} · {a.kind==="text"?"文本摘录最多 64 KiB":"未提取正文"}</small></div>{onRemove&&a.state==="ready"&&<button aria-label={`移除 ${a.name}`} disabled={disabled} onClick={()=>onRemove(a.id)}>×</button>}</div>)}</div>:null;
}

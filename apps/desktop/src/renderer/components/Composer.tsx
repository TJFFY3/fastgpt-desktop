import { useRef } from "react";
import type { AttachmentView } from "../../../../../packages/shared/src/index";
import { AttachmentList } from "./AttachmentList";
export function Composer({
  busy,
  stopping,
  disabled,
  onSend,
  onStop,
  text,onText,files,pending,error,onPick,onDrop,onRemove,onClearError,destination,
}: {
  busy: boolean;
  stopping: boolean;
  disabled: boolean;
  onSend(text: string): Promise<boolean>;
  onStop(): void;
  text:string;onText(text:string):void;files:AttachmentView[];pending:boolean;error:string;onPick():void;onDrop(files:File[]):void;onRemove(id:string):void;onClearError():void;destination:string;
}) {
  const composing = useRef(false),
    sending = useRef(false);
  const send = async () => {
    if (sending.current || busy || disabled || pending || error || (!text.trim()&&!files.length)) return;
    sending.current = true;
    try {
      await onSend(text.trim());
    } finally {
      sending.current = false;
    }
  };
  return (
    <div className="composer" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!disabled&&!busy&&!pending)onDrop(Array.from(e.dataTransfer.files));}}>
      <AttachmentList files={files} disabled={disabled||busy||pending} onRemove={onRemove}/>
      {files.length>0&&<div className="attachment-consent">发送将把以上文本摘录、文件信息和对话历史传给：{destination}。未提取的二进制正文不会上传。</div>}
      {pending&&<div role="status">正在创建本地文件副本…</div>}
      {error&&<div role="alert" className="draft-error">{error}<button onClick={onClearError}>清除导入错误</button></div>}
      <textarea
        aria-label="消息"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        value={text}
        disabled={disabled}
        onChange={(e) => onText(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            !composing.current &&
            e.keyCode !== 229
          ) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="composer-footer">
        <div className="composer-actions"><button aria-label="添加文件" disabled={disabled||busy||pending} onClick={onPick}>＋ 文件</button><span>工具执行受权限限制</span></div>
        {busy ? (
          <button className="stop" disabled={stopping} onClick={onStop}>
            {stopping ? "停止中…" : "停止"}
          </button>
        ) : (
          <button
            className="primary"
            aria-label="发送"
            disabled={disabled || pending || !!error || (!text.trim()&&!files.length)}
            onClick={() => void send()}
          >
            发送 <span aria-hidden="true">↵</span>
          </button>
        )}
      </div>
    </div>
  );
}

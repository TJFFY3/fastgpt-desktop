/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function Composer({
  busy,
  stopping,
  disabled,
  modelPicker,
  onSend,
  onStop,
}: {
  busy: boolean;
  stopping: boolean;
  disabled: boolean;
  modelPicker?: ReactNode;
  onSend(text: string): Promise<boolean>;
  onStop(): void;
}) {
  const [text, setText] = useState(''),
    composing = useRef(false),
    sending = useRef(false);
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  const send = async () => {
    if (sending.current || busy || disabled || !text.trim()) return;
    sending.current = true;
    try {
      if (await onSend(text.trim())) setText('');
    } finally {
      sending.current = false;
    }
  };
  return (
    <div className="composer">
      <textarea
        aria-label="消息"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
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
        <span>Enter 发送 · Shift+Enter 换行</span>
        <div className="composer-actions">
          {modelPicker}
          {busy ? (
            <button className="stop" disabled={stopping} onClick={onStop}>
              {stopping ? '停止中…' : '停止生成'}
            </button>
          ) : (
            <button
              className="primary"
              aria-label="发送"
              disabled={disabled || !text.trim()}
              onClick={() => void send()}
            >
              发送 <span aria-hidden="true">↵</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

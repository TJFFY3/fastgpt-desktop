import { useEffect, useRef } from "react";
import type {
  MessageRecord,
  RunEvent,
} from "../../../../../packages/shared/src/index";
export function ChatView({
  messages,
  events,
  hasSession,
  hasModels,
  onSettings,
}: {
  messages: MessageRecord[];
  events: RunEvent[];
  hasSession: boolean;
  hasModels: boolean;
  onSettings(): void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  let partial = "";
  for (const e of events) {
    if (e.type === "text_delta") partial += e.text;
    if (e.type === "assistant_message" && e.message.role === "assistant")
      partial = "";
  }
  const terminal = events.at(-1);
  if (
    terminal?.type === "status" &&
    ["cancelled", "failed", "interrupted"].includes(terminal.status) &&
    messages.at(-1)?.status !== "complete"
  )
    partial = "";
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, partial]);
  return (
    <div className="chat-scroll">
      {!messages.length && !partial ? (
        <div className="welcome">
          <div className="welcome-icon">✦</div>
          <div className="eyebrow">YOUR PERSONAL AGENT</div>
          <h1>让想法开始行动</h1>
          <p>
            {hasModels
              ? "在你的本地空间中，与模型对话并安全调用工具。"
              : "连接一个 OpenAI 兼容模型，开启你的第一个 Agent 会话。"}
          </p>
          {!hasModels && (
            <button className="primary" onClick={onSettings}>
              配置模型
            </button>
          )}
          <div className="welcome-cards">
            <article>
              <span>◈</span>
              <h3>连续对话</h3>
              <p>会话与消息保存在本机，随时继续。</p>
            </article>
            <article>
              <span>⌘</span>
              <h3>受控工具</h3>
              <p>按能力启用工具，每次调用留有记录。</p>
            </article>
            <article>
              <span>⏣</span>
              <h3>安全边界</h3>
              <p>密钥由主进程管理，页面无系统权限。</p>
            </article>
          </div>
          <small>
            {hasSession ? "输入消息开始对话" : "选择模型，然后新建会话"}
          </small>
        </div>
      ) : (
        <div className="messages">
          {messages.map((m) =>
            m.role === "tool" ? (
              <details key={m.id} className="stored-tool">
                <summary>工具结果 · {m.toolCallId}</summary>
                <pre>{m.content}</pre>
              </details>
            ) : (
              <article key={m.id} className={`message ${m.role}`}>
                <div className="message-body">
                  {m.status !== "complete" && (
                    <div className="message-status">
                      {m.status === "interrupted"
                        ? "已中断 · 未完成"
                        : "部分回复"}
                    </div>
                  )}
                  {m.content && <p>{m.content}</p>}
                  {m.toolCalls?.map((c) => (
                    <div className="tool-request" key={c.id}>
                      调用工具 <code>{c.name}</code>
                    </div>
                  ))}
                </div>
              </article>
            ),
          )}
          {partial && (
            <article className="message assistant streaming">
              <div className="message-body">
                <div className="message-status">正在生成</div>
                <p>{partial}</p>
              </div>
            </article>
          )}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}

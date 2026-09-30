/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { Fragment, useEffect, useRef } from 'react';
import type { MessageRecord, RunEvent, RunRecord } from '../../../../../packages/shared/src/index';
import { RunTrace } from './RunTrace';
import { WorkspaceIcon } from './WorkspaceIcon';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function ChatView({
  messages,
  events,
  hasSession,
  hasModels,
  onSettings,
  runs = [],
  eventsByRun = new Map(),
  onLoadRun,
  favoriteIds = new Set(),
  onFavorite,
}: {
  messages: MessageRecord[];
  events: RunEvent[];
  hasSession: boolean;
  hasModels: boolean;
  onSettings(): void;
  runs?: RunRecord[];
  eventsByRun?: Map<string, RunEvent[]>;
  onLoadRun?(id: string): void;
  favoriteIds?: Set<string>;
  onFavorite?(message: MessageRecord): void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const known = new Set(messages.map((m) => m.id));
  const displayed = [...messages];
  for (const e of events) {
    if (e.type === 'assistant_message' && e.messageId && !known.has(e.messageId)) {
      known.add(e.messageId);
      displayed.push({
        ...e.message,
        id: e.messageId,
        sessionId: e.sessionId,
        runId: e.runId,
        attachmentIds: [],
        seq: e.seq,
        status: 'complete',
        createdAt: e.createdAt,
      });
    }
  }
  let partial = '';
  for (const e of events) {
    if (e.type === 'text_delta') partial += e.text;
    if (e.type === 'assistant_message' && e.message.role === 'assistant') partial = '';
  }
  const terminal = events.at(-1);
  if (
    terminal?.type === 'status' &&
    ['cancelled', 'failed', 'interrupted'].includes(terminal.status) &&
    messages.at(-1)?.status !== 'complete'
  )
    partial = '';
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, partial, events.length, runs.length]);
  const lastIndex = new Map<string, number>();
  displayed.forEach((m, i) => {
    if (m.runId) lastIndex.set(m.runId, i);
  });
  const liveRunId = events[0]?.runId;
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  const trace = (r: RunRecord) => (
    <RunTrace
      key={r.id}
      run={r}
      events={eventsByRun.get(r.id) ?? (liveRunId === r.id ? events : [])}
      latest={r.id === runs.at(-1)?.id}
      onOpen={() => onLoadRun?.(r.id)}
    />
  );
  return (
    <div className="chat-scroll">
      {!displayed.length && !partial ? (
        <div className="welcome">
          <div className="welcome-icon">✦</div>
          <div className="eyebrow">开始一段工作对话</div>
          <h1>有什么可以帮你？</h1>
          <p>
            {hasModels
              ? '在你的本地空间中，与模型对话并安全调用工具。'
              : '连接一个 OpenAI 兼容模型，开启你的第一个 Agent 会话。'}
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
          <small>{hasSession ? '输入消息开始对话' : '选择模型，然后新建会话'}</small>
        </div>
      ) : (
        <div className="messages">
          {displayed.map((m, index) => (
            <Fragment key={m.id}>
              {m.role === 'tool' ? (
                <details key={m.id} className="stored-tool">
                  <summary>工具结果 · {m.toolCallId}</summary>
                  <pre>{m.content}</pre>
                </details>
              ) : (
                <article key={m.id} className={`message ${m.role}`}>
                  <div className="message-body">
                    {m.status !== 'complete' && (
                      <div className="message-status">
                        {m.status === 'interrupted' ? '已中断 · 未完成' : '部分回复'}
                      </div>
                    )}
                    {m.content && <p>{m.content}</p>}
                    {m.toolCalls?.map((c) => (
                      <div className="tool-request" key={c.id}>
                        调用工具 <code>{c.name}</code>
                      </div>
                    ))}
                    {m.role === 'assistant' &&
                      m.status === 'complete' &&
                      m.content &&
                      onFavorite && (
                        <div className="answer-actions">
                          <button
                            className={favoriteIds.has(m.id) ? 'saved' : ''}
                            aria-label={favoriteIds.has(m.id) ? '取消收藏回答' : '收藏回答'}
                            aria-pressed={favoriteIds.has(m.id)}
                            onClick={() => onFavorite(m)}
                          >
                            <WorkspaceIcon name="star" size={14} />
                            {favoriteIds.has(m.id) ? '已收藏' : '收藏回答'}
                          </button>
                          <time>
                            {new Date(m.createdAt).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}
                          </time>
                        </div>
                      )}
                  </div>
                </article>
              )}
              {m.runId &&
                lastIndex.get(m.runId) === index &&
                !(partial && liveRunId === m.runId) &&
                runs.filter((r) => r.id === m.runId).map(trace)}
            </Fragment>
          ))}
          {partial && (
            <article className="message assistant streaming">
              <div className="message-body">
                <div className="message-status">正在生成</div>
                <p>{partial}</p>
              </div>
            </article>
          )}
          {runs.filter((r) => !lastIndex.has(r.id) || (partial && r.id === liveRunId)).map(trace)}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}

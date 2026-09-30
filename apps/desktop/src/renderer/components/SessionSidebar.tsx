/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useEffect, useRef, useState } from 'react';
import type { SessionRecord } from '../../../../../packages/shared/src/index';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export function SessionSidebar(p: {
  sessions: SessionRecord[];
  selectedId: string | null;
  query: string;
  archived: boolean;
  onQuery(value: string): void;
  onArchived(value: boolean): void;
  onSelect(id: string): void;
  onNew(): void;
  onUpdate(
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ): Promise<void>;
  onDelete(session: SessionRecord): void;
}) {
  const [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState('');
  const sidebar = useRef<HTMLElement>(null);
  /* 中文：点击菜单以外的任何位置或按 Escape 时关闭已打开的会话操作菜单。 */
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      sidebar.current
        ?.querySelectorAll<HTMLDetailsElement>('.session-menu[open]')
        .forEach((menu) => {
          if (!menu.contains(target)) menu.open = false;
        });
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      sidebar.current
        ?.querySelectorAll<HTMLDetailsElement>('.session-menu[open]')
        .forEach((menu) => {
          menu.open = false;
        });
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  return (
    <aside ref={sidebar} className="sidebar conversation-sidebar" aria-label="会话历史">
      <div className="brand">
        <span className="brand-mark">F</span>
        <div>
          会话历史<span>随时继续你的工作</span>
        </div>
      </div>
      <button className="new-session" aria-label="新建会话" onClick={p.onNew}>
        ＋ 新建会话
      </button>
      <input
        aria-label="搜索会话"
        className="search"
        placeholder="搜索会话"
        value={p.query}
        onChange={(e) => p.onQuery(e.target.value)}
      />
      <div className="section-heading">
        <span>{p.archived ? '已归档' : '我的会话'}</span>
        <button onClick={() => p.onArchived(!p.archived)}>
          {p.archived ? '返回会话' : '查看归档'}
        </button>
      </div>
      <div className="session-list">
        {p.sessions.map((s) => (
          <div key={s.id} className={`session-item ${s.id === p.selectedId ? 'selected' : ''}`}>
            {editing === s.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (title.trim())
                    void p.onUpdate(s.id, { title: title.trim() }).then(() => setEditing(null));
                }}
              >
                <input
                  aria-label="会话名称"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={256}
                  autoFocus
                />
                <button type="submit">保存名称</button>
                <button type="button" onClick={() => setEditing(null)}>
                  取消
                </button>
              </form>
            ) : (
              <>
                <button className="session-title" onClick={() => p.onSelect(s.id)}>
                  <span>{s.pinned ? '◆' : '◇'}</span>
                  <span>{s.title}</span>
                </button>
                <details
                  className="session-menu"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button'))
                      event.currentTarget.open = false;
                  }}
                >
                  <summary aria-label={`管理会话 ${s.title}`}>···</summary>
                  <div>
                    <button
                      onClick={() => {
                        setEditing(s.id);
                        setTitle(s.title);
                      }}
                    >
                      重命名
                    </button>
                    <button onClick={() => void p.onUpdate(s.id, { pinned: !s.pinned })}>
                      {s.pinned ? '取消置顶' : '置顶'}
                    </button>
                    <button onClick={() => void p.onUpdate(s.id, { archived: !s.archived })}>
                      {s.archived ? '取消归档' : '归档'}
                    </button>
                    <button className="danger-text" onClick={() => p.onDelete(s)}>
                      删除
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        ))}
        {!p.sessions.length && (
          <p className="sidebar-empty">{p.query ? '没有匹配的会话' : '从一个新会话开始'}</p>
        )}
      </div>
    </aside>
  );
}

/** Persistent workspace navigation modeled after the Canva UI reference. */
/* 中文：按照设计稿组织全局导航，保持页面切换和会话状态相互独立。 */
import { useEffect, useRef, useState } from 'react';
import { WorkspaceIcon, type WorkspaceIconName } from './WorkspaceIcon';

/* 中文：工作空间主页面；对话页作为 Agent 和会话入口的下级页面。 */
export type WorkspacePage =
  'home' | 'agents' | 'chat' | 'knowledge' | 'knowledge-search' | 'history' | 'favorites';
const links: { page: WorkspacePage; label: string; icon: WorkspaceIconName }[] = [
  { page: 'home', label: '主页', icon: 'home' },
  { page: 'agents', label: 'Agent 广场', icon: 'grid' },
  { page: 'knowledge', label: '知识库', icon: 'book' },
  { page: 'history', label: '历史记录', icon: 'history' },
  { page: 'favorites', label: '收藏', icon: 'star' },
];

/* 中文：渲染固定窄版侧栏，悬停图标时显示菜单名。 */
export function WorkspaceNavigation({
  page,
  onNavigate,
  onHelp,
  onSettings,
}: {
  page: WorkspacePage;
  onNavigate(page: WorkspacePage): void;
  onHelp(): void;
  onSettings(): void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountControl = useRef<HTMLDivElement>(null);
  /* 中文：点击用户菜单外部或按 Escape 后收起菜单。 */
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountControl.current?.contains(event.target))
        setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const activePage = page === 'chat' ? 'agents' : page === 'knowledge-search' ? 'knowledge' : page;
  return (
    <aside className="workspace-nav">
      <nav id="workspace-navigation" aria-label="工作空间导航">
        {links.map((link) => (
          <button
            key={link.page}
            className={activePage === link.page ? 'active' : ''}
            aria-current={activePage === link.page ? 'page' : undefined}
            aria-label={link.label}
            title={link.label}
            onClick={() => onNavigate(link.page)}
          >
            <WorkspaceIcon name={link.icon} />
            <span>{link.label}</span>
            <span className="nav-tooltip" role="tooltip">
              {link.label}
            </span>
          </button>
        ))}
      </nav>
      <div className="nav-illustration" aria-hidden="true">
        <div className="illustration-sheet">
          <WorkspaceIcon name="book" size={34} />
        </div>
        <span />
        <i />
      </div>
      <div className="nav-footer">
        <button onClick={onHelp} aria-label="帮助中心" title="帮助中心">
          <WorkspaceIcon name="help" />
          <span>帮助中心</span>
          <span className="nav-tooltip" role="tooltip">
            帮助中心
          </span>
        </button>
        <div className="account-control" ref={accountControl}>
          <button
            className="account-trigger"
            aria-label="用户中心"
            title="用户中心"
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen(!accountOpen)}
          >
            <span className="account-avatar">L</span>
            <span>用户中心</span>
            <span className="nav-tooltip" role="tooltip">
              用户中心
            </span>
          </button>
          {accountOpen && (
            <div className="account-menu" role="menu" aria-label="用户中心">
              <div className="account-identity">
                <span className="account-avatar">L</span>
                <div>
                  <strong>本地空间</strong>
                  <small>个人工作区 · 本机保存</small>
                </div>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  onSettings();
                }}
              >
                <WorkspaceIcon name="settings" size={18} />
                设置
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

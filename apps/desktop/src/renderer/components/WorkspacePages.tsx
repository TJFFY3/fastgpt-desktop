/** Workspace landing, catalog, history, favorites, and knowledge-library views. */
/* 中文：工作空间各功能页使用真实模型和会话记录，未接入知识库时展示明确的空状态。 */
import { useEffect, useState } from 'react';
import type {
  MessageRecord,
  ProviderView,
  SessionRecord,
} from '../../../../../packages/shared/src/index';
import type { FavoriteAnswer } from '../hooks/useFavoriteAnswers';
import type { WorkspacePage } from './WorkspaceNavigation';
import { WorkspaceIcon } from './WorkspaceIcon';

/* 中文：页面操作回调由应用容器提供，保证所有入口共用同一组会话和配置流程。 */
type Props = {
  page: WorkspacePage;
  sessions: SessionRecord[];
  providers: ProviderView[];
  favorites: FavoriteAnswer[];
  archived: boolean;
  onNavigate(page: WorkspacePage): void;
  onOpen(session: SessionRecord): void;
  onStart(providerId: string): void;
  onSettings(): void;
  onArchived(value: boolean): void;
  onUpdate(id: string, patch: { pinned?: boolean; archived?: boolean }): Promise<void>;
  onDelete(session: SessionRecord): void;
  onFavorite(reference: FavoriteAnswer): void;
  onError(message: string): void;
};

/* 中文：统一显示本机记录时间，避免使用设计稿中的示例日期。 */
function dateLabel(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

/* 中文：展示可执行下一步操作的空状态，覆盖首次使用和筛选无结果场景。 */
function EmptyState({
  icon = 'chat',
  title,
  description,
  action,
  onAction,
}: {
  icon?: 'chat' | 'book' | 'star' | 'search';
  title: string;
  description: string;
  action?: string;
  onAction?(): void;
}) {
  return (
    <div className="workspace-empty">
      <div className="empty-symbol">
        <WorkspaceIcon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <button className="primary" onClick={onAction}>
          {action}
          <WorkspaceIcon name="arrow" size={15} />
        </button>
      )}
    </div>
  );
}

/* 中文：模型入口显示实际连接能力；密钥缺失时引导进入设置，不虚构已发布 Agent。 */
function AgentCard({
  provider,
  index,
  onStart,
  onSettings,
}: {
  provider: ProviderView;
  index: number;
  onStart(id: string): void;
  onSettings(): void;
}) {
  const ready = provider.credentialState !== 'missing';
  return (
    <article className="agent-card">
      <div className="agent-card-heading">
        <span className={`feature-icon tone-${index % 4}`}>
          <WorkspaceIcon name={provider.capabilities.tools ? 'grid' : 'book'} size={24} />
        </span>
        <div>
          <h3>{provider.name}</h3>
          <small>{provider.capabilities.tools ? '工具协作' : '模型对话'}</small>
        </div>
      </div>
      <p>
        使用 {provider.modelId}{' '}
        {provider.capabilities.tools
          ? '开展多轮对话，按权限调用本地工具。'
          : '进行交流、整理信息和辅助日常工作。'}
      </p>
      <div className="agent-card-status">
        <span className={ready ? 'available' : 'unavailable'}>
          <i />
          {ready ? '已配置 · 可用' : '需要填写密钥'}
        </span>
        <small>
          {provider.credentialState === 'session_only' ? '凭据仅本次会话有效' : 'OpenAI 兼容接口'}
        </small>
      </div>
      <button className="primary" onClick={() => (ready ? onStart(provider.id) : onSettings())}>
        {ready ? '立即使用' : '完善配置'}
        <WorkspaceIcon name="arrow" size={15} />
      </button>
    </article>
  );
}

/* 中文：以设计稿的导航和卡片结构呈现真实数据，并在收藏页按原会话读取回答。 */
export function WorkspacePages(p: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [providerFilter, setProviderFilter] = useState('');
  const [favoriteMessages, setFavoriteMessages] = useState<MessageRecord[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [favoriteError, setFavoriteError] = useState('');
  useEffect(() => {
    setSearch('');
    setCategory('全部');
    setProviderFilter('');
  }, [p.page]);
  useEffect(() => {
    if (p.page !== 'favorites') return;
    let alive = true;
    setLoadingFavorites(true);
    setFavoriteError('');
    setFavoriteMessages([]);
    const sessions = p.sessions.filter((session) =>
      p.favorites.some(
        (ref) => ref.sessionId === session.id && ref.namespaceKey === session.namespaceKey,
      ),
    );
    void Promise.all(sessions.map((session) => window.desktop.sessions.messages(session.id)))
      .then((groups) => {
        if (alive)
          setFavoriteMessages(
            groups
              .flat()
              .filter(
                (message) =>
                  message.role === 'assistant' &&
                  p.favorites.some(
                    (ref) => ref.messageId === message.id && ref.sessionId === message.sessionId,
                  ),
              ),
          );
      })
      .catch(() => {
        if (alive) setFavoriteError('暂时无法读取收藏内容，请重新进入收藏页面重试。');
      })
      .finally(() => {
        if (alive) setLoadingFavorites(false);
      });
    return () => {
      alive = false;
    };
  }, [p.page, p.favorites, p.sessions]);

  const recent = [...p.sessions]
    .filter((session) => !session.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const localProviders = p.providers.filter((provider) => !provider.fastgpt);
  const filteredProviders = localProviders.filter(
    (provider) =>
      `${provider.name} ${provider.modelId}`.toLowerCase().includes(search.toLowerCase()) &&
      (category === '全部' ||
        (category === '工具协作' ? provider.capabilities.tools : !provider.capabilities.tools)),
  );
  const providerName = (id: string) =>
    p.providers.find((provider) => provider.id === id)?.name ?? '模型已移除';

  if (p.page === 'home')
    return (
      <div className="workspace-page home-page">
        <section className="workspace-hero">
          <div>
            <span className="hero-kicker">你的 AI 工作空间</span>
            <h1>欢迎回到 FastGPT Workspace</h1>
            <p>让每一次对话，都成为工作的下一步。</p>
            <button
              className="primary"
              onClick={() =>
                localProviders.length ? p.onStart(localProviders[0].id) : p.onSettings()
              }
            >
              开始新对话
              <WorkspaceIcon name="arrow" size={16} />
            </button>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-document">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="hero-chat">
              <WorkspaceIcon name="chat" size={44} />
            </div>
            <span className="hero-spark">✦</span>
          </div>
        </section>
        <div className="home-columns">
          <section className="workspace-panel">
            <header>
              <h2>
                <WorkspaceIcon name="history" />
                最近对话
              </h2>
              <button className="text-action" onClick={() => p.onNavigate('history')}>
                查看全部
                <WorkspaceIcon name="arrow" size={14} />
              </button>
            </header>
            {recent.length ? (
              <div className="recent-list">
                {recent.slice(0, 4).map((session, index) => (
                  <button key={session.id} className="recent-row" onClick={() => p.onOpen(session)}>
                    <span className={`feature-icon small tone-${index % 4}`}>
                      <WorkspaceIcon name="chat" size={16} />
                    </span>
                    <div>
                      <strong>{session.title}</strong>
                      <small>{providerName(session.providerId)}</small>
                    </div>
                    <time>{dateLabel(session.updatedAt)}</time>
                    <span className="continue-label">
                      继续对话
                      <WorkspaceIcon name="arrow" size={13} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="从第一段对话开始"
                description="你的对话会保存在本机，随时回来继续。"
                action="新建对话"
                onAction={() =>
                  localProviders.length ? p.onStart(localProviders[0].id) : p.onSettings()
                }
              />
            )}
          </section>
          <section className="workspace-panel">
            <header>
              <h2>
                <WorkspaceIcon name="grid" />
                本地模型
              </h2>
              <button className="text-action" onClick={() => p.onNavigate('agents')}>
                浏览云端 Agent
                <WorkspaceIcon name="arrow" size={14} />
              </button>
            </header>
            {localProviders.length ? (
              <div className="home-agents">
                {localProviders.slice(0, 3).map((provider, index) => (
                  <AgentCard
                    key={provider.id}
                    provider={provider}
                    index={index}
                    onStart={p.onStart}
                    onSettings={p.onSettings}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="连接你的第一个模型"
                description="配置一个 OpenAI 兼容模型，即可开始使用。"
                action="配置模型"
                onAction={p.onSettings}
              />
            )}
          </section>
        </div>
        <section className="workspace-panel knowledge-shortcut">
          <header>
            <h2>
              <WorkspaceIcon name="book" />
              知识库快速入口
            </h2>
            <button className="text-action" onClick={() => p.onNavigate('knowledge')}>
              浏览知识库
              <WorkspaceIcon name="arrow" size={14} />
            </button>
          </header>
          <div className="knowledge-intro">
            <span className="feature-icon tone-1">
              <WorkspaceIcon name="book" size={24} />
            </span>
            <div>
              <h3>让知识成为可信答案</h3>
              <p>查看企业资料、检索文档，并在对话中追溯来源。</p>
            </div>
            <span className="neutral-tag">进入知识库连接 FastGPT</span>
          </div>
        </section>
      </div>
    );

  if (p.page === 'agents')
    return (
      <div className="workspace-page">
        <div className="page-heading">
          <div>
            <h1>Agent 广场</h1>
            <p>选择一个已配置的模型，开始新的工作对话。</p>
          </div>
          <button className="outline-action" onClick={p.onSettings}>
            <WorkspaceIcon name="settings" size={16} />
            管理模型
          </button>
        </div>
        <label className="workspace-search">
          <WorkspaceIcon name="search" />
          <input
            aria-label="搜索 Agent"
            placeholder="搜索 Agent 名称或模型"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="filter-chips" role="group" aria-label="Agent 分类">
          {['全部', '工具协作', '模型对话'].map((value) => (
            <button
              key={value}
              aria-pressed={category === value}
              className={category === value ? 'selected' : ''}
              onClick={() => setCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="agent-grid">
          {filteredProviders.map((provider, index) => (
            <AgentCard
              key={provider.id}
              provider={provider}
              index={index}
              onStart={p.onStart}
              onSettings={p.onSettings}
            />
          ))}
        </div>
        {!filteredProviders.length && (
          <EmptyState
            title={p.providers.length ? '没有找到匹配的 Agent' : '还没有可用的 Agent'}
            description={
              p.providers.length
                ? '尝试其他名称，或调整上方的分类筛选。'
                : '当前 Agent 入口对应本机配置的模型；配置后即可使用。'
            }
            action={p.providers.length ? '清除筛选' : '添加模型'}
            onAction={() =>
              p.providers.length ? (setSearch(''), setCategory('全部')) : p.onSettings()
            }
          />
        )}
      </div>
    );

  if (p.page === 'history' || p.page === 'favorites') {
    const history = [...p.sessions]
      .filter(
        (session) =>
          session.archived === p.archived &&
          session.title.toLowerCase().includes(search.toLowerCase()) &&
          (!providerFilter || session.providerId === providerFilter),
      )
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    const answers = favoriteMessages.filter((message) =>
      (message.content ?? '').toLowerCase().includes(search.toLowerCase()),
    );
    return (
      <div className="workspace-page">
        <div className="page-heading">
          <div>
            <h1>历史记录与收藏</h1>
            <p>找回工作脉络，保留值得再次阅读的回答。</p>
          </div>
          <button className="outline-action" onClick={() => p.onNavigate('agents')}>
            新建对话
            <WorkspaceIcon name="arrow" size={15} />
          </button>
        </div>
        <div className="workspace-tabs">
          <button
            className={p.page === 'history' ? 'active' : ''}
            onClick={() => p.onNavigate('history')}
          >
            全部会话
          </button>
          <button
            className={p.page === 'favorites' ? 'active' : ''}
            onClick={() => p.onNavigate('favorites')}
          >
            已收藏回答<span>{p.favorites.length}</span>
          </button>
        </div>
        <div className="history-filters">
          <label className="workspace-search">
            <WorkspaceIcon name="search" />
            <input
              aria-label="搜索历史记录"
              placeholder={p.page === 'history' ? '搜索会话名称' : '搜索收藏回答内容'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {p.page === 'history' && (
            <>
              <select
                aria-label="按 Agent 筛选"
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
              >
                <option value="">全部 Agent</option>
                {p.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <button className="outline-action" onClick={() => p.onArchived(!p.archived)}>
                {p.archived ? '返回未归档会话' : '查看归档'}
              </button>
            </>
          )}
        </div>
        {p.page === 'history' ? (
          <section className="workspace-panel history-list">
            <header>
              <h2>
                {p.archived ? '已归档会话' : '全部会话'}
                <span className="count-label">{history.length} 条</span>
              </h2>
              <span className="muted">置顶优先 · 最近更新</span>
            </header>
            {history.map((session) => (
              <article className="history-row" key={session.id}>
                <span className="feature-icon tone-0">
                  <WorkspaceIcon name="chat" size={20} />
                </span>
                <div className="history-info">
                  <h3>
                    <button onClick={() => p.onOpen(session)}>{session.title}</button>
                    {session.pinned && <span className="neutral-tag">置顶</span>}
                  </h3>
                  <p>
                    {providerName(session.providerId)}
                    <span>·</span>
                    {dateLabel(session.updatedAt)}
                  </p>
                </div>
                <div className="history-actions">
                  <button className="text-action" onClick={() => p.onOpen(session)}>
                    继续对话
                    <WorkspaceIcon name="arrow" size={14} />
                  </button>
                  <details className="workspace-menu">
                    <summary aria-label={`更多操作 ${session.title}`}>•••</summary>
                    <div>
                      <button
                        onClick={() => void p.onUpdate(session.id, { pinned: !session.pinned })}
                      >
                        {session.pinned ? '取消置顶' : '置顶'}
                      </button>
                      <button
                        onClick={() => void p.onUpdate(session.id, { archived: !session.archived })}
                      >
                        {session.archived ? '取消归档' : '归档'}
                      </button>
                      <button className="danger-text" onClick={() => p.onDelete(session)}>
                        删除会话
                      </button>
                    </div>
                  </details>
                </div>
              </article>
            ))}
            {!history.length && (
              <EmptyState
                title="没有匹配的会话"
                description="创建一段新对话，或调整搜索与归档筛选。"
                action="浏览 Agent"
                onAction={() => p.onNavigate('agents')}
              />
            )}
          </section>
        ) : (
          <section className="favorite-list">
            {loadingFavorites ? (
              <p role="status">正在读取收藏回答…</p>
            ) : favoriteError ? (
              <p role="alert">{favoriteError}</p>
            ) : answers.length ? (
              answers.map((message) => {
                const session = p.sessions.find((item) => item.id === message.sessionId);
                return (
                  <article className="workspace-panel favorite-card" key={message.id}>
                    <div className="favorite-heading">
                      <span className="feature-icon tone-1">
                        <WorkspaceIcon name="star" size={18} />
                      </span>
                      <div>
                        <h3>{session?.title ?? '原会话'}</h3>
                        <small>
                          {dateLabel(message.createdAt)} ·{' '}
                          {session ? providerName(session.providerId) : ''}
                        </small>
                      </div>
                      <button
                        className="text-action"
                        aria-label="取消收藏"
                        onClick={() => {
                          const ref = p.favorites.find((item) => item.messageId === message.id);
                          if (ref) p.onFavorite(ref);
                        }}
                      >
                        取消收藏
                      </button>
                    </div>
                    <p className="favorite-content">{message.content}</p>
                    {session && (
                      <button className="text-action" onClick={() => p.onOpen(session)}>
                        返回原会话
                        <WorkspaceIcon name="arrow" size={14} />
                      </button>
                    )}
                  </article>
                );
              })
            ) : (
              <EmptyState
                icon="star"
                title="还没有收藏的回答"
                description="在对话中点击回答下方的收藏按钮，重要信息会出现在这里。已删除会话的回答将不再展示。"
                action="浏览历史记录"
                onAction={() => p.onNavigate('history')}
              />
            )}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <h1>{p.page === 'knowledge-search' ? '知识检索' : '知识库'}</h1>
          <p>浏览可访问的资料，让答案有据可查。</p>
        </div>
        <button
          className="outline-action"
          onClick={() => p.onNavigate(p.page === 'knowledge' ? 'knowledge-search' : 'knowledge')}
        >
          {p.page === 'knowledge' ? '进入检索' : '返回知识库'}
          <WorkspaceIcon name="arrow" size={15} />
        </button>
      </div>
      <div className="knowledge-layout">
        <aside className="knowledge-directory">
          <h2>我的知识库</h2>
          <p className="muted">尚无已连接的知识库</p>
          <div className="knowledge-line" />
          <h3>目录</h3>
          <p className="muted">连接后可浏览文档目录</p>
        </aside>
        <section className="knowledge-results">
          {p.page === 'knowledge-search' && (
            <>
              <div className="workspace-search">
                <WorkspaceIcon name="search" />
                <input aria-label="知识检索" placeholder="连接知识库后即可搜索文档" disabled />
              </div>
              <div className="filter-chips">
                <button disabled>关键词检索</button>
                <button disabled>语义检索</button>
              </div>
            </>
          )}
          <EmptyState
            icon="book"
            title="知识库尚未接入"
            description="当前版本支持本地会话和模型对话，暂未提供企业知识库连接与检索接口。连接能力就绪后，这里将展示文档目录、检索结果与引用来源。"
            action="先开始模型对话"
            onAction={() => p.onNavigate('agents')}
          />
          <div className="knowledge-capabilities">
            <span>
              <WorkspaceIcon name="file" />
              文档浏览
            </span>
            <span>
              <WorkspaceIcon name="search" />
              知识检索
            </span>
            <span>
              <WorkspaceIcon name="book" />
              来源引用
            </span>
          </div>
        </section>
        {p.page === 'knowledge-search' && (
          <aside className="knowledge-preview">
            <h2>文本预览</h2>
            <div className="preview-empty">
              <WorkspaceIcon name="file" size={30} />
              <p>
                选择检索结果后，
                <br />
                在这里查看原文与出处。
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

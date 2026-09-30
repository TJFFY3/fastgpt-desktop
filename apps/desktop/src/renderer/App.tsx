/** Defines renderer UI behavior and presentation for the desktop chat workspace. */
/* 中文：定义桌面聊天工作区的渲染层界面和交互行为。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MessageRecord,
  ProviderView,
  RunRecord,
  SessionRecord,
} from '../../../../packages/shared/src/index';
import { useSessions } from './hooks/useSessions';
import { useRunEvents } from './hooks/useRunEvents';
import { SessionSidebar } from './components/SessionSidebar';
import { ProviderSettings } from './components/ProviderSettings';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { ModelPicker } from './components/ModelPicker';
import { useSessionRuns } from './hooks/useSessionRuns';
import { useFavoriteAnswers } from './hooks/useFavoriteAnswers';
import { WorkspaceNavigation, type WorkspacePage } from './components/WorkspaceNavigation';
import { WorkspacePages } from './components/WorkspacePages';
import { WorkspaceIcon } from './components/WorkspaceIcon';
import { useDialogFocus } from './hooks/useDialogFocus';
import { FastGptCatalog } from './components/FastGptCatalog';
const active = ['queued', 'running', 'waiting_approval', 'waiting_input', 'cancelling'];
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
export default function App() {
  const [page, setPage] = useState<WorkspacePage>('home');
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const helpDialog = useRef<HTMLElement>(null);
  useDialogFocus(helpDialog, helpOpen, () => setHelpOpen(false));
  const creatingSession = useRef(false);
  const initiallySelected = useRef(false);
  const selection = useRef({ id: null as string | null, generation: 0 });
  const [providers, setProviders] = useState<ProviderView[]>([]),
    [providerId, setProviderId] = useState(''),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedSnapshot, setSelectedSnapshot] = useState<SessionRecord | null>(null),
    [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(''),
    [messages, setMessages] = useState<MessageRecord[]>([]),
    [run, setRun] = useState<RunRecord | null>(null),
    [pendingStarts, setPendingStarts] = useState<Set<string>>(new Set());
  const [modelSwitching, setModelSwitching] = useState(false);
  const sessionRuns = useSessionRuns(selectedId);
  const selectSession = useCallback((record: SessionRecord | null) => {
    initiallySelected.current = true;
    selection.current = {
      id: record?.id ?? null,
      generation: selection.current.generation + 1,
    };
    setSelectedSnapshot(record);
    setSelectedId(record?.id ?? null);
    setSelectionVersion((version) => version + 1);
    setRun(null);
    setMessages([]);
    setError('');
  }, []);
  const fail = useCallback((value: string) => setError(value.replace(/^Error:\s*/, '')), []),
    { sessions, refresh: refreshVisible } = useSessions(query, archived, fail),
    selected =
      sessions.find((s) => s.id === selectedId) ??
      (selectedSnapshot?.id === selectedId ? selectedSnapshot : undefined),
    { events, error: eventError } = useRunEvents(run?.id ?? null);
  const catalog = useSessions('', false, fail);
  const archivedCatalog = useSessions('', true, fail);
  const allSessions = useMemo(
    () => [...catalog.sessions, ...archivedCatalog.sessions],
    [catalog.sessions, archivedCatalog.sessions],
  );
  const { favorites, toggle: toggleFavorite } = useFavoriteAnswers(fail);
  /* 中文：刷新各视图的数据源，使主页、归档和会话侧栏及时保持一致。 */
  const refresh = useCallback(async () => {
    await Promise.all([refreshVisible(), catalog.refresh(), archivedCatalog.refresh()]);
  }, [refreshVisible, catalog.refresh, archivedCatalog.refresh]);
  /* 中文：从任意工作空间页面打开原会话，保留其模型和运行记录。 */
  const openSession = (record: SessionRecord) => {
    setArchived(record.archived);
    setQuery('');
    selectSession(record);
    setPage('chat');
  };
  const latestStatus =
      events.flatMap((e) => (e.type === 'status' ? [e.status] : [])).at(-1) ?? run?.status ?? null,
    busy =
      modelSwitching ||
      pendingStarts.has(selectedId ?? '') ||
      (!!latestStatus && active.includes(latestStatus));
  const refreshProviders = useCallback(async () => {
    try {
      const values = await window.desktop.providers.list();
      setProviders(values);
      setProviderId((current) =>
        values.some((p) => p.id === current && !p.fastgpt)
          ? current
          : (values.find((p) => !p.fastgpt)?.id ?? ''),
      );
    } catch (e) {
      fail(String(e));
    }
  }, [fail]);
  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);
  useEffect(() => {
    if (!initiallySelected.current && sessions.length) {
      selectSession(sessions[0]);
    }
  }, [sessions, selectSession]);
  useEffect(() => {
    const record = sessions.find((s) => s.id === selectedId);
    if (record) setSelectedSnapshot(record);
  }, [sessions, selectedId]);
  useEffect(() => {
    let alive = true;
    const generation = selection.current.generation;
    setMessages([]);
    setRun(null);
    if (selectedId)
      void Promise.all([
        window.desktop.sessions.messages(selectedId),
        window.desktop.runs.list(selectedId),
      ])
        .then(([m, r]) => {
          if (alive && selection.current.generation === generation) {
            setMessages(m);
            setRun(r.at(-1) ?? null);
          }
        })
        .catch((e) => {
          if (alive && selection.current.generation === generation) fail(String(e));
        });
    return () => {
      alive = false;
    };
  }, [selectedId, selectionVersion, fail]);
  useEffect(() => {
    if (!selectedId || !latestStatus || active.includes(latestStatus)) return;
    let alive = true;
    const generation = selection.current.generation;
    void window.desktop.sessions
      .messages(selectedId)
      .then((m) => {
        if (alive && selection.current.generation === generation) setMessages(m);
      })
      .catch((e) => {
        if (alive && selection.current.generation === generation) fail(String(e));
      });
    void refresh();
    return () => {
      alive = false;
    };
  }, [latestStatus, selectedId, fail, refresh]);
  /** Implements one focused part of this module’s public responsibility. */
  /* 中文：实现本模块职责中的一项具体操作。 */
  const newSession = async (chosenProviderId = providerId) => {
    if (creatingSession.current) return;
    const remote = providers.find((provider) => provider.id === chosenProviderId)?.fastgpt;
    if (remote) {
      await startRemote(remote.appId).catch((e) => fail(String(e)));
      return;
    }
    if (
      !chosenProviderId ||
      providers.find((provider) => provider.id === chosenProviderId)?.credentialState === 'missing'
    ) {
      setSettings(true);
      return;
    }
    creatingSession.current = true;
    try {
      const generation = selection.current.generation;
      setError('');
      setArchived(false);
      setQuery('');
      const s = await window.desktop.sessions.create({
        title: '新会话',
        providerId: chosenProviderId,
      });
      if (selection.current.generation === generation) {
        selectSession(s);
        setProviderId(chosenProviderId);
        setPage('chat');
      }
      await refresh();
    } catch (e) {
      fail(String(e));
    } finally {
      creatingSession.current = false;
    }
  };
  /* 中文：创建专属远程会话并刷新云端目标，界面沿用已有消息、运行和收藏流程。 */
  const startRemote = async (appId: string) => {
    if (creatingSession.current) return;
    creatingSession.current = true;
    const generation = selection.current.generation;
    try {
      const record = await window.desktop.fastgpt.createSession(appId);
      await refreshProviders();
      if (selection.current.generation === generation) openSession(record);
      await refresh();
    } finally {
      creatingSession.current = false;
    }
  };
  /** Persists or updates state while maintaining this module’s data invariants. */
  /* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
  const update = async (
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) => {
    try {
      const updated = await window.desktop.sessions.update(id, patch);
      if (id === selection.current.id) setSelectedSnapshot(updated);
      if (patch.archived !== undefined && id === selection.current.id) selectSession(null);
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  /** Releases managed state and prevents further use of the affected resource. */
  /* 中文：释放受管理的状态，并阻止继续使用已失效的资源。 */
  const remove = async (s: SessionRecord) => {
    if (
      !window.confirm(
        `删除会话“${s.title}”及其消息和运行记录？正在执行的任务会先停止。此操作无法撤销。`,
      )
    )
      return;
    try {
      await window.desktop.sessions.remove(s.id);
      if (s.id === selection.current.id) selectSession(null);
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  /** Implements one focused part of this module’s public responsibility. */
  const changeModel = async (id: string) => {
    if (busy) return;
    if (!selectedId) {
      setProviderId(id);
      return;
    }
    const sid = selectedId,
      generation = selection.current.generation;
    setModelSwitching(true);
    try {
      const value = await window.desktop.sessions.update(sid, { providerId: id });
      if (selection.current.id === sid && selection.current.generation === generation)
        setSelectedSnapshot(value);
      await refresh();
    } catch (e) {
      if (selection.current.id === sid) fail(String(e));
    } finally {
      setModelSwitching(false);
    }
  };
  /** Implements one focused part of this module’s public responsibility. */
  const send = async (text: string) => {
    if (!selectedId || busy) return false;
    const id = selectedId,
      generation = ++selection.current.generation;
    /** Implements one focused part of this module’s public responsibility. */
    const stillSelected = () =>
      selection.current.id === id && selection.current.generation === generation;
    setPendingStarts((previous) => new Set(previous).add(id));
    setError('');
    try {
      const next = await window.desktop.runs.start(id, text, {
        attachmentIds: [],
        expectedSessionRevision: selected?.revision,
      });
      if (stillSelected()) setRun(next);
      const history = await window.desktop.sessions.messages(id);
      if (stillSelected()) setMessages(history);
      if (selected?.title === '新会话') await update(id, { title: text.slice(0, 30) });
      await refresh();
      await sessionRuns.refresh();
      return true;
    } catch (e) {
      if (stillSelected()) fail(String(e));
      return false;
    } finally {
      setPendingStarts((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  };
  const runtimeError = events
      .flatMap((e) => (e.type === 'error' ? [`${e.code}: ${e.message}`] : []))
      .at(-1),
    selectedProvider = providers.find((p) => p.id === (selected?.providerId ?? providerId));
  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <button className="workspace-brand" aria-label="返回主页" onClick={() => setPage('home')}>
          <span className="workspace-logo">F</span>
          <strong>FastGPT Workspace</strong>
        </button>
        <div className="workspace-location">
          <WorkspaceIcon name="grid" size={16} />
          <span>
            本地空间 <span className="muted">/ AI 工作空间</span>
          </span>
        </div>
      </header>
      <WorkspaceNavigation
        page={page}
        onNavigate={setPage}
        onHelp={() => setHelpOpen(!helpOpen)}
        onSettings={() => setSettings(true)}
      />
      <div className="workspace-content">
        {(error || (page === 'chat' && (eventError || runtimeError))) && (
          <div role="alert" className="error-banner">
            <span>{error || eventError || runtimeError}</span>
            {error && (
              <button aria-label="关闭错误" onClick={() => setError('')}>
                ×
              </button>
            )}
          </div>
        )}
        {page === 'agents' || page === 'knowledge' || page === 'knowledge-search' ? (
          <FastGptCatalog
            key={page === 'agents' ? 'agents' : 'knowledge'}
            kind={page === 'agents' ? 'agents' : 'knowledge'}
            onStart={startRemote}
            onConnectionChanged={refreshProviders}
          />
        ) : page !== 'chat' ? (
          <WorkspacePages
            page={page}
            sessions={allSessions}
            providers={providers}
            favorites={favorites}
            archived={archived}
            onNavigate={setPage}
            onOpen={openSession}
            onStart={(id) => void newSession(id)}
            onSettings={() => setSettings(true)}
            onArchived={setArchived}
            onUpdate={update}
            onDelete={(session) => void remove(session)}
            onFavorite={toggleFavorite}
            onError={fail}
          />
        ) : (
          <>
            <div className="chat-breadcrumb">
              <button onClick={() => setPage('agents')}>Agent 广场</button>
              <span>/</span>
              <span>{selectedProvider?.name ?? '模型对话'}</span>
              <span>/</span>
              <span>{selected?.title ?? '新对话'}</span>
            </div>
            <div className={`conversation-layout ${detailsOpen ? '' : 'details-hidden'}`}>
              <SessionSidebar
                sessions={sessions}
                selectedId={selectedId}
                query={query}
                archived={archived}
                onQuery={setQuery}
                onArchived={setArchived}
                onSelect={(id) => {
                  const record = sessions.find((s) => s.id === id);
                  if (record) openSession(record);
                }}
                onNew={() => {
                  if (selectedProvider?.fastgpt)
                    void startRemote(selectedProvider.fastgpt.appId).catch((e) => fail(String(e)));
                  else void newSession();
                }}
                onUpdate={update}
                onDelete={(s) => void remove(s)}
              />
              <main className="chat-main">
                <header className="chat-header">
                  <div>
                    <h2>
                      <span className="chat-agent-icon">
                        <WorkspaceIcon name="chat" size={18} />
                      </span>
                      {selectedProvider?.name ?? '模型对话'}
                      <span className="available">
                        <i />
                        {busy ? '运行中' : selectedProvider?.fastgpt ? '远程应用' : '本地会话'}
                      </span>
                    </h2>
                    <span className="workspace-label">
                      本地空间 <span>／</span> 对话
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={detailsOpen ? '收起会话详情' : '展开会话详情'}
                    aria-expanded={detailsOpen}
                    onClick={() => setDetailsOpen(!detailsOpen)}
                  >
                    <WorkspaceIcon name="book" size={18} />
                  </button>
                </header>
                {selectedProvider?.credentialState === 'missing' && (
                  <div className="credential-banner">
                    {selectedProvider?.fastgpt
                      ? 'FastGPT 连接已失效或已变更；为避免跨账号发送，请从 Agent 广场重新创建会话。'
                      : '此模型需要重新填写密钥。'}
                    <button
                      onClick={() =>
                        selectedProvider?.fastgpt ? setPage('agents') : setSettings(true)
                      }
                    >
                      {selectedProvider?.fastgpt ? '返回 Agent 广场' : '打开模型设置'}
                    </button>
                  </div>
                )}
                <ChatView
                  messages={messages}
                  events={events}
                  hasSession={!!selectedId}
                  hasModels={!!providers.length}
                  onSettings={() => setSettings(true)}
                  runs={sessionRuns.runs}
                  eventsByRun={sessionRuns.eventsByRun}
                  onLoadRun={(id) => void sessionRuns.loadEvents(id).catch((e) => fail(String(e)))}
                  favoriteIds={
                    new Set(
                      favorites
                        .filter((reference) => reference.namespaceKey === selected?.namespaceKey)
                        .map((reference) => reference.messageId),
                    )
                  }
                  onFavorite={(message) => {
                    if (selected)
                      toggleFavorite({
                        messageId: message.id,
                        sessionId: message.sessionId,
                        namespaceKey: selected.namespaceKey,
                      });
                  }}
                />
                <div className="chat-bottom">
                  <Composer
                    key={selectedId ?? 'none'}
                    modelPicker={
                      <ModelPicker
                        providers={
                          selectedProvider?.fastgpt
                            ? [selectedProvider]
                            : providers.filter((p) => !p.fastgpt)
                        }
                        value={selected?.providerId ?? providerId}
                        disabled={busy || !!selected?.archived || !!selectedProvider?.fastgpt}
                        onChange={(id) => void changeModel(id)}
                      />
                    }
                    busy={busy}
                    stopping={latestStatus === 'cancelling'}
                    disabled={
                      !selected ||
                      selected.archived ||
                      selectedProvider?.credentialState === 'missing'
                    }
                    onSend={send}
                    onStop={() => {
                      if (run)
                        void window.desktop.runs.cancel(run.id).catch((e) => fail(String(e)));
                    }}
                  />
                  <div className="bottom-note">
                    内容由 AI 生成，请结合实际情况核实 <span>·</span>{' '}
                    {selectedProvider?.fastgpt
                      ? '消息发送至 FastGPT，历史同时保存在本机'
                      : '对话保存在本机'}
                  </div>
                </div>
              </main>
              {detailsOpen && (
                <aside className="conversation-details">
                  <h3>会话详情</h3>
                  <div className="detail-card">
                    <span className="feature-icon tone-1">
                      <WorkspaceIcon name="book" size={20} />
                    </span>
                    <h4>引用来源</h4>
                    <p>
                      {selectedProvider?.fastgpt
                        ? '当前回答由 FastGPT 工作流生成；引用来源展示尚未接入，不代表应用未使用知识库。'
                        : '当前为模型直接对话，未连接知识库，暂无文档引用。'}
                    </p>
                  </div>
                  <h3>{selectedProvider?.fastgpt ? '当前应用' : '当前模型'}</h3>
                  <dl>
                    <dt>{selectedProvider?.fastgpt ? '应用 ID' : '模型'}</dt>
                    <dd>{selectedProvider?.modelId ?? '尚未选择'}</dd>
                    <dt>工具调用</dt>
                    <dd>
                      {selectedProvider?.fastgpt
                        ? '由云端工作流决定'
                        : selectedProvider?.capabilities.tools
                          ? '按权限启用'
                          : '未启用'}
                    </dd>
                    <dt>数据保存</dt>
                    <dd>本地工作空间</dd>
                  </dl>
                  <button
                    className="outline-action"
                    onClick={() =>
                      selectedProvider?.fastgpt ? setPage('agents') : setSettings(true)
                    }
                  >
                    {selectedProvider?.fastgpt ? '返回 Agent 广场' : '管理模型配置'}
                    <WorkspaceIcon name="arrow" size={14} />
                  </button>
                  <div className="conversation-tip">
                    <WorkspaceIcon name="help" size={17} />
                    <p>收藏有价值的回答，稍后可以在「收藏」中返回原会话。</p>
                  </div>
                </aside>
              )}
            </div>
          </>
        )}
      </div>
      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            className="workspace-help"
            ref={helpDialog}
            role="dialog"
            aria-modal="true"
            aria-label="帮助中心"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2>开始使用 FastGPT Workspace</h2>
              <button
                className="icon-button"
                aria-label="关闭帮助"
                onClick={() => setHelpOpen(false)}
              >
                <WorkspaceIcon name="close" />
              </button>
            </header>
            <ol>
              <li>
                <strong>连接模型</strong>
                <p>在模型设置中填写兼容 OpenAI 的接口、模型名称和密钥。</p>
              </li>
              <li>
                <strong>开始工作</strong>
                <p>
                  主页可使用本地模型创建对话；Agent 广场展示 FastGPT 云端应用。Enter
                  发送，Shift+Enter 换行。
                </p>
              </li>
              <li>
                <strong>继续与收藏</strong>
                <p>在历史记录中继续会话，在回答下方收藏重要内容。</p>
              </li>
            </ol>
            <button
              className="primary"
              onClick={() => {
                setHelpOpen(false);
                setSettings(true);
              }}
            >
              打开模型设置
              <WorkspaceIcon name="arrow" size={15} />
            </button>
          </section>
        </div>
      )}
      {settings && (
        <ProviderSettings
          providers={providers.filter((p) => !p.fastgpt)}
          onRefresh={refreshProviders}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

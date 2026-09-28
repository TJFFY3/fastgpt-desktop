import { useCallback, useEffect, useState } from "react";
import type {
  MessageRecord,
  ProviderView,
  RunRecord,
  SessionRecord,
} from "../../../../packages/shared/src/index";
import { useSessions } from "./hooks/useSessions";
import { useRunEvents } from "./hooks/useRunEvents";
import { SessionSidebar } from "./components/SessionSidebar";
import { ProviderSettings } from "./components/ProviderSettings";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { RunDetails } from "./components/RunDetails";
const active = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "cancelling",
];
export default function App() {
  const [providers, setProviders] = useState<ProviderView[]>([]),
    [providerId, setProviderId] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<MessageRecord[]>([]),
    [run, setRun] = useState<RunRecord | null>(null),
    [starting, setStarting] = useState(false);
  const fail = useCallback(
      (value: string) => setError(value.replace(/^Error:\s*/, "")),
      [],
    ),
    { sessions, refresh } = useSessions(query, archived, fail),
    selected = sessions.find((s) => s.id === selectedId),
    { events, error: eventError } = useRunEvents(run?.id ?? null);
  const latestStatus =
      events.flatMap((e) => (e.type === "status" ? [e.status] : [])).at(-1) ??
      run?.status ??
      null,
    busy = starting || (!!latestStatus && active.includes(latestStatus));
  const refreshProviders = useCallback(async () => {
    try {
      const values = await window.desktop.providers.list();
      setProviders(values);
      setProviderId((current) =>
        values.some((p) => p.id === current) ? current : (values[0]?.id ?? ""),
      );
    } catch (e) {
      fail(String(e));
    }
  }, [fail]);
  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);
  useEffect(() => {
    if (!selectedId && sessions.length) setSelectedId(sessions[0].id);
  }, [sessions, selectedId]);
  useEffect(() => {
    let alive = true;
    setMessages([]);
    setRun(null);
    if (selectedId)
      void Promise.all([
        window.desktop.sessions.messages(selectedId),
        window.desktop.runs.list(selectedId),
      ])
        .then(([m, r]) => {
          if (alive) {
            setMessages(m);
            setRun(r.at(-1) ?? null);
          }
        })
        .catch((e) => {
          if (alive) fail(String(e));
        });
    return () => {
      alive = false;
    };
  }, [selectedId, fail]);
  useEffect(() => {
    if (!selectedId || !latestStatus || active.includes(latestStatus)) return;
    let alive = true;
    void window.desktop.sessions
      .messages(selectedId)
      .then((m) => {
        if (alive) setMessages(m);
      })
      .catch((e) => fail(String(e)));
    void refresh();
    return () => {
      alive = false;
    };
  }, [latestStatus, selectedId, fail, refresh]);
  const newSession = async () => {
    if (!providerId) {
      setSettings(true);
      return;
    }
    try {
      setError("");
      setArchived(false);
      setQuery("");
      const s = await window.desktop.sessions.create({
        title: "新会话",
        providerId,
      });
      setSelectedId(s.id);
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  const update = async (
    id: string,
    patch: { title?: string; pinned?: boolean; archived?: boolean },
  ) => {
    try {
      await window.desktop.sessions.update(id, patch);
      if (patch.archived !== undefined && id === selectedId)
        setSelectedId(null);
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  const remove = async (s: SessionRecord) => {
    if (
      !window.confirm(
        `删除会话“${s.title}”及其消息和运行记录？正在执行的任务会先停止。此操作无法撤销。`,
      )
    )
      return;
    try {
      await window.desktop.sessions.remove(s.id);
      if (s.id === selectedId) {
        setSelectedId(null);
        setRun(null);
        setMessages([]);
      }
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  const send = async (text: string) => {
    if (!selectedId || busy) return false;
    setStarting(true);
    setError("");
    try {
      const next = await window.desktop.runs.start(selectedId, text);
      setRun(next);
      setMessages(await window.desktop.sessions.messages(selectedId));
      if (selected?.title === "新会话")
        await update(selectedId, { title: text.slice(0, 30) });
      await refresh();
      return true;
    } catch (e) {
      fail(String(e));
      return false;
    } finally {
      setStarting(false);
    }
  };
  const runtimeError = events
      .flatMap((e) => (e.type === "error" ? [`${e.code}: ${e.message}`] : []))
      .at(-1),
    selectedProvider = providers.find(
      (p) => p.id === (selected?.providerId ?? providerId),
    );
  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        selectedId={selectedId}
        query={query}
        archived={archived}
        onQuery={setQuery}
        onArchived={setArchived}
        onSelect={(id) => {
          setSelectedId(id);
          setError("");
        }}
        onNew={() => void newSession()}
        onSettings={() => setSettings(true)}
        onUpdate={update}
        onDelete={(s) => void remove(s)}
      />
      <main className="chat-main">
        <header className="chat-header">
          <div>
            <h2>{selected?.title ?? "Agent 工作台"}</h2>
            <span className="workspace-label">
              本地空间 <span>／</span> 对话
            </span>
          </div>
          <div className="model-selector">
            <span className="model-dot" />
            <select
              aria-label="当前模型"
              value={selected?.providerId ?? providerId}
              disabled={!!selectedId}
              onChange={(e) => setProviderId(e.target.value)}
            >
              {!providers.length && <option value="">尚未配置模型</option>}
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="local-badge">LOCAL</span>
          </div>
        </header>
        {(error || eventError || runtimeError) && (
          <div role="alert" className="error-banner">
            <span>{error || eventError || runtimeError}</span>
            <button aria-label="关闭错误" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {selectedProvider?.credentialState === "missing" && (
          <div className="credential-banner">
            此模型需要重新填写密钥。
            <button onClick={() => setSettings(true)}>打开模型设置</button>
          </div>
        )}
        <ChatView
          messages={messages}
          events={events}
          hasSession={!!selectedId}
          hasModels={!!providers.length}
          onSettings={() => setSettings(true)}
        />
        <div className="chat-bottom">
          <RunDetails status={latestStatus} events={events} />
          <Composer
            busy={busy}
            stopping={latestStatus === "cancelling"}
            disabled={
              !selectedId ||
              archived ||
              selectedProvider?.credentialState === "missing"
            }
            onSend={send}
            onStop={() => {
              if (run)
                void window.desktop.runs
                  .cancel(run.id)
                  .catch((e) => fail(String(e)));
            }}
          />
          <div className="bottom-note">
            FastGPT Desktop <span>·</span> Agent 基础版 <span>·</span> 本地会话
          </div>
        </div>
      </main>
      {settings && (
        <ProviderSettings
          providers={providers}
          onRefresh={refreshProviders}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  );
}

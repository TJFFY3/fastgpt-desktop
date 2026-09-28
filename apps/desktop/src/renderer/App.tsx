import { useCallback, useEffect, useRef, useState } from "react";
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
import { ModelPicker } from "./components/ModelPicker";
import { useSessionRuns } from "./hooks/useSessionRuns";
import { useDrafts } from "./hooks/useDrafts";
import { SandboxStatus } from "./components/SandboxStatus";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { SpeechSettings } from "./components/SpeechSettings";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { VoiceInput } from "./components/VoiceInput";
const active = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "cancelling",
];
export default function App() {
  const initiallySelected = useRef(false);
  const selection = useRef({ id: null as string | null, generation: 0 });
  const [providers, setProviders] = useState<ProviderView[]>([]),
    [providerId, setProviderId] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [selectedSnapshot, setSelectedSnapshot] = useState<SessionRecord | null>(
      null,
    ),
    [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [messages, setMessages] = useState<MessageRecord[]>([]),
    [run, setRun] = useState<RunRecord | null>(null),
    [pendingStarts, setPendingStarts] = useState<Set<string>>(new Set());
  const [modelSwitching,setModelSwitching]=useState(false);
  const [workspaceOpen,setWorkspaceOpen]=useState(false);
  const [speechSettings,setSpeechSettings]=useState(false);
  const sessionRuns=useSessionRuns(selectedId);
  const selectSession = useCallback((record: SessionRecord | null) => {
    initiallySelected.current = true;
    selection.current = {
      id: record?.id ?? null,
      generation: selection.current.generation + 1,
    };
    setSelectedSnapshot(record);
    setSelectedId(record?.id ?? null);
    setRun(null);
    setMessages([]);
    setError("");
  }, []);
  const fail = useCallback(
      (value: string) => setError(value.replace(/^Error:\s*/, "")),
      [],
    ),
    { sessions, refresh } = useSessions(query, archived, fail),
    selected =
      sessions.find((s) => s.id === selectedId) ??
      (selectedSnapshot?.id === selectedId ? selectedSnapshot : undefined),
    { events, error: eventError } = useRunEvents(run?.id ?? null);
  const latestStatus =
      events.flatMap((e) => (e.type === "status" ? [e.status] : [])).at(-1) ??
      run?.status ??
      null,
    busy =
      modelSwitching ||
      pendingStarts.has(selectedId ?? "") ||
      (!!latestStatus && active.includes(latestStatus));
  const drafts=useDrafts(selectedId,refresh),readyFiles=drafts.draft.files.filter(a=>a.state==="ready");
  const voice=useVoiceInput(selectedId,{draftText:drafts.draft.text,appendDraft:drafts.appendText,disabled:busy||!!selected?.archived,ensureSession:async()=>{if(selection.current.id)return selection.current.id;if(!providerId)throw new Error("请先配置并选择聊天模型，再创建语音会话");const g=selection.current.generation,s=await window.desktop.sessions.create({title:"新会话",providerId});if(selection.current.generation!==g)throw new Error("会话已切换，请重新开始录音");selectSession(s);await refresh();return s.id;}});
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
          if (alive && selection.current.generation === generation)
            fail(String(e));
        });
    return () => {
      alive = false;
    };
  }, [selectedId, fail]);
  useEffect(() => {
    if (!selectedId || !latestStatus || active.includes(latestStatus)) return;
    let alive = true;
    const generation = selection.current.generation;
    void window.desktop.sessions
      .messages(selectedId)
      .then((m) => {
        if (alive && selection.current.generation === generation)
          setMessages(m);
      })
      .catch((e) => {
        if (alive && selection.current.generation === generation)
          fail(String(e));
      });
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
      const generation = selection.current.generation;
      setError("");
      setArchived(false);
      setQuery("");
      const s = await window.desktop.sessions.create({
        title: "新会话",
        providerId,
      });
      if (selection.current.generation === generation) selectSession(s);
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
      const updated = await window.desktop.sessions.update(id, patch);
      if (id === selection.current.id) setSelectedSnapshot(updated);
      if (patch.archived !== undefined && id === selection.current.id)
        selectSession(null);
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
      if (s.id === selection.current.id) selectSession(null);
      await refresh();
    } catch (e) {
      fail(String(e));
    }
  };
  const changeModel=async(id:string)=>{
    if(busy||voice.active) return;
    if(!selectedId) {setProviderId(id);return;}
    const sid=selectedId,generation=selection.current.generation;setModelSwitching(true);
    try {
      const value=await window.desktop.sessions.update(sid,{providerId:id});
      if(selection.current.id===sid && selection.current.generation===generation) setSelectedSnapshot(value);
      await refresh();
    } catch(e) {if(selection.current.id===sid) fail(String(e));}
    finally {setModelSwitching(false);}
  };
  const send = async (text: string) => {
    if (!selectedId || busy || voice.active || drafts.draft.pending || drafts.draft.error) return false;
    const id = selectedId,
      generation = ++selection.current.generation;
    const stillSelected = () =>
      selection.current.id === id &&
      selection.current.generation === generation;
    setPendingStarts((previous) => new Set(previous).add(id));
    setError("");
    let accepted = false;
    try {
      const next = await window.desktop.runs.start(id, text,{attachmentIds:readyFiles.map(a=>a.id),expectedSessionRevision:selected?.revision});
      accepted = true;
      if (stillSelected()) setRun(next);
      await drafts.sent(id,text,readyFiles.map(a=>a.id));
      const history = await window.desktop.sessions.messages(id);
      if (stillSelected()) setMessages(history);
      if (selected?.title === "新会话")
        await update(id, { title: (text||readyFiles[0]?.name||"文件会话").slice(0, 30) });
      await refresh();
      await sessionRuns.refresh();
      return true;
    } catch (e) {
      if (stillSelected()) fail(accepted ? `消息已发送，页面刷新失败：${String(e)}。请勿重复发送。` : String(e));
      return accepted;
    } finally {
      setPendingStarts((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
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
          selectSession(sessions.find((s) => s.id === id) ?? null);
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
          <ModelPicker providers={providers} value={selected?.providerId ?? providerId} disabled={busy || voice.active || !!selected?.archived} onChange={id=>void changeModel(id)} />
          <SandboxStatus/>
          <button onClick={()=>setWorkspaceOpen(true)}>工作区</button>
          <button onClick={()=>setSpeechSettings(true)}>语音设置</button>
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
          attachments={drafts.draft.files}
          runs={sessionRuns.runs}
          eventsByRun={sessionRuns.eventsByRun}
          onLoadRun={id=>void sessionRuns.loadEvents(id).catch(e=>fail(String(e)))}
          onDecide={(id,decision)=>window.desktop.approvals.decide(id,decision)}
        />
        <div className="chat-bottom">
          <Composer
            key={selectedId ?? "none"}
            busy={busy}
            voiceBusy={voice.active} voice={<VoiceInput voice={voice} disabled={busy||!!selected?.archived||!providers.length} onSettings={()=>setSpeechSettings(true)}/>}
            text={drafts.draft.text} onText={drafts.setText} files={readyFiles} pending={drafts.draft.pending} error={drafts.draft.error}
            onPick={()=>void drafts.pick()} onDrop={files=>void drafts.drop(files)} onRemove={id=>void drafts.remove(id)} onClearError={drafts.clearError}
            destination={selectedProvider?`${selectedProvider.name}（${selectedProvider.baseUrl}）`:"未配置服务"}
            stopping={latestStatus === "cancelling"}
            disabled={
              !selected ||
              selected.archived ||
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
      {workspaceOpen&&<WorkspacePanel key={selectedId??"none"} sessionId={selectedId} busy={busy||voice.active} onClose={()=>setWorkspaceOpen(false)} onChanged={refresh}/>}
      {speechSettings&&<SpeechSettings onClose={()=>{setSpeechSettings(false);void voice.refresh().catch(e=>fail(String(e)));}}/>}
    </div>
  );
}

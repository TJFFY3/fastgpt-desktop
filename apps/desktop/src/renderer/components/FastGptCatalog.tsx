/** Displays permission-scoped FastGPT catalogs and secure connection settings. */
/* 中文：展示云端授权应用、知识库目录及分页，连接凭据只提交给主进程安全存储。 */
import { useEffect, useRef, useState } from 'react';
import type { FastGptConnection, FastGptResource } from '../../../../../packages/shared/src/index';
import { WorkspaceIcon } from './WorkspaceIcon';
import { useDialogFocus } from '../hooks/useDialogFocus';

/* 中文：连接表单不预填或回读密钥，提交后立即清空内存中的表单值。 */
function ConnectionDialog({
  connection,
  onClose,
  onChanged,
}: {
  connection: FastGptConnection;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [baseUrl, setBaseUrl] = useState(connection.baseUrl);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useDialogFocus(dialog, true, onClose, busy);
  /* 中文：保存或断开连接后刷新目录状态，不把失败伪装成空列表。 */
  const submit = async (disconnect = false) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (disconnect) await window.desktop.fastgpt.disconnect();
      else await window.desktop.fastgpt.save(baseUrl, key);
      setKey('');
      await onChanged();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <section
        className="workspace-help"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="FastGPT 连接设置"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>FastGPT 连接设置</h2>
          <button disabled={busy} aria-label="关闭 FastGPT 设置" onClick={onClose}>
            <WorkspaceIcon name="close" />
          </button>
        </header>
        <p>使用 API Key 所属账号及团队的资源权限，不等同于桌面用户登录或 SSO。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="fastgpt-field">
            FastGPT API 地址
            <input
              aria-label="FastGPT API 地址"
              type="url"
              required
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="fastgpt-field">
            FastGPT API Key
            <input
              aria-label="FastGPT API Key"
              type="password"
              autoComplete="off"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="muted">凭据通过系统安全存储加密；不可用时仅保存于当前进程内存。</p>
          {connection.credentialState === 'session_only' && (
            <p>当前凭据仅本次运行有效，重启后需重新填写。</p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="fastgpt-actions">
            <button className="primary" disabled={busy}>
              {busy ? '处理中…' : '保存连接'}
            </button>
            <button type="button" disabled={busy} onClick={() => void submit(true)}>
              断开连接
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

/* 中文：按目录与页码查询远端资源，异步结果只更新发起查询时的页面。 */
export function FastGptCatalog({
  kind,
  onStart,
  onConnectionChanged,
}: {
  kind: 'agents' | 'knowledge';
  onStart(appId: string): Promise<void>;
  onConnectionChanged(): Promise<void>;
}) {
  const openingRef = useRef(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [connection, setConnection] = useState<FastGptConnection | null>(null);
  const [settings, setSettings] = useState(false);
  const [revision, setRevision] = useState(0);
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<FastGptResource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const parentId = path.at(-1)?.id ?? null;
  /* 中文：防止重复创建远程会话，权限检查失败时在当前页面显示错误。 */
  const start = async (appId: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(appId);
    setError('');
    try {
      await onStart(appId);
    } catch (e) {
      setError(String(e));
    } finally {
      openingRef.current = false;
      setOpening(null);
    }
  };
  /* 中文：刷新连接元数据并使旧目录结果失效。 */
  const refreshConnection = async () => {
    await onConnectionChanged();
    const value = await window.desktop.fastgpt.connection();
    setConnection(value);
    setPath([]);
    setOffset(0);
    setItems([]);
    setSelected(null);
    setRevision((r) => r + 1);
  };
  useEffect(() => {
    let alive = true;
    void window.desktop.fastgpt
      .connection()
      .then((value) => {
        if (alive) setConnection(value);
      })
      .catch((e) => {
        if (alive) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!connection) return;
    let alive = true;
    setItems([]);
    setTotal(0);
    setSelected(null);
    setError('');
    if (connection.credentialState === 'missing') {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.desktop.fastgpt
      .list({ kind, parentId, searchKey: query, offset })
      .then((data) => {
        if (alive) {
          setItems(data.list);
          setTotal(data.total);
        }
      })
      .catch((e) => {
        if (alive) setError(String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [connection, kind, parentId, query, offset, revision]);
  const connected = connection && connection.credentialState !== 'missing';
  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <h1>{kind === 'agents' ? 'Agent 广场' : '知识库'}</h1>
          <p>FastGPT 返回的当前 API Key 所属账号及团队可读资源。</p>
        </div>
        <button className="outline-action" onClick={() => setSettings(true)}>
          {connected ? 'FastGPT 连接设置' : '连接 FastGPT'}
        </button>
      </div>
      <div className="fastgpt-actions">
        <button
          onClick={() => {
            setPath([]);
            setOffset(0);
          }}
        >
          根目录
        </button>
        {path.map((folder, index) => (
          <button
            key={folder.id}
            onClick={() => {
              setPath(path.slice(0, index + 1));
              setOffset(0);
            }}
          >
            {folder.name}
          </button>
        ))}
        <button disabled={loading || !connected} onClick={() => setRevision((r) => r + 1)}>
          刷新列表
        </button>
      </div>
      <form
        className="workspace-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search.trim());
          setOffset(0);
        }}
      >
        <WorkspaceIcon name="search" />
        <input
          aria-label={kind === 'agents' ? '搜索 Agent' : '搜索知识库'}
          placeholder="按名称或简介搜索当前目录"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!connected}
        />
        <button disabled={!connected}>搜索</button>
      </form>
      {loading && <p role="status">正在读取 FastGPT 列表…</p>}
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button onClick={() => setRevision((r) => r + 1)}>重试</button>
        </div>
      )}
      {!loading && !error && !connected && (
        <div className="workspace-empty">
          <WorkspaceIcon name="book" size={30} />
          <h3>尚未连接 FastGPT</h3>
          <p>
            连接后展示账号有权限访问的{kind === 'agents' ? '应用' : '知识库'}
            ，不会使用本地模型替代。
          </p>
        </div>
      )}
      {!loading && !error && connected && !items.length && (
        <div className="workspace-empty">
          <h3>当前目录没有可访问的资源</h3>
          <p>请调整搜索或返回上级目录；资源访问权限由 FastGPT 判定。</p>
        </div>
      )}
      <div className="agent-grid">
        {items.map((item, index) => (
          <article className="agent-card" key={item.id}>
            <div className="agent-card-heading">
              <span className={`feature-icon tone-${index % 4}`}>
                <WorkspaceIcon name={kind === 'agents' ? 'grid' : 'book'} size={24} />
              </span>
              <div>
                <h3>{item.name}</h3>
                <small>
                  {item.folder ? '文件夹' : kind === 'agents' ? 'FastGPT 应用' : 'FastGPT 知识库'}
                </small>
              </div>
            </div>
            <p>{item.intro || '暂无简介'}</p>
            <div className="agent-card-status">
              <span className="available">
                <i /> 有权读取
              </span>
              <small>{item.type}</small>
            </div>
            <button
              className="outline-action"
              onClick={() => {
                if (item.folder) {
                  setPath([...path, { id: item.id, name: item.name }]);
                  setOffset(0);
                  setSearch('');
                  setQuery('');
                } else setSelected(selected === item.id ? null : item.id);
              }}
            >
              {item.folder ? '打开文件夹' : selected === item.id ? '收起详情' : '查看详情'}
            </button>
            {!item.folder && kind === 'agents' && (
              <button
                className="primary"
                disabled={opening !== null}
                onClick={() => void start(item.id)}
              >
                {opening === item.id ? '正在打开…' : '开始对话'}
              </button>
            )}
            {selected === item.id && (
              <div className="fastgpt-resource-detail">
                <p>资源 ID：{item.id}</p>
                <p>
                  {kind === 'agents'
                    ? '对话由此 FastGPT 应用的云端模型和工作流执行；当前支持文本消息。'
                    : '本次已接入知识库列表；文档浏览与内容检索尚未接入。'}
                </p>
              </div>
            )}
          </article>
        ))}
      </div>
      {!loading && !error && connected && (
        <div className="fastgpt-actions">
          <span>
            共 {total} 条 · 第 {Math.floor(offset / 30) + 1} 页
          </span>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 30))}>
            上一页
          </button>
          <button disabled={offset + 30 >= total} onClick={() => setOffset(offset + 30)}>
            下一页
          </button>
        </div>
      )}
      {settings && (
        <ConnectionDialog
          connection={
            connection ?? { baseUrl: 'https://cloud.fastgpt.cn/api', credentialState: 'missing' }
          }
          onClose={() => setSettings(false)}
          onChanged={refreshConnection}
        />
      )}
    </div>
  );
}

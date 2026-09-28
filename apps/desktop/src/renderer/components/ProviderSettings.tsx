import { useState } from "react";
import type {
  ProviderDraft,
  ProviderView,
} from "../../../../../packages/shared/src/index";
const initial: ProviderDraft = {
  name: "",
  baseUrl: "https://api.openai.com/v1",
  modelId: "",
  contextWindow: 32768,
  maxOutputTokens: 4096,
  timeoutMs: 120000,
  allowInsecureHttp: false,
  capabilities: {
    tools: false,
    temperature: false,
    outputTokenField: "max_tokens",
  },
};
export function ProviderSettings({
  providers,
  onRefresh,
  onClose,
}: {
  providers: ProviderView[];
  onRefresh(): Promise<void>;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<ProviderDraft>(initial),
    [id, setId] = useState<string | undefined>(),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const field = <K extends keyof ProviderDraft>(
    name: K,
    value: ProviderDraft[K],
  ) => setDraft((d) => ({ ...d, [name]: value }));
  const edit = (p?: ProviderView) => {
    setId(p?.id);
    setKey("");
    setError("");
    setNotice("");
    if (p) {
      const { id: _id, credentialState: _state, ...value } = p;
      setDraft(value);
    } else setDraft(initial);
  };
  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="模型设置"
      >
        <header>
          <div>
            <div className="eyebrow">MODEL CONNECTIONS</div>
            <h2>模型设置</h2>
            <p>接入支持 OpenAI Chat Completions 协议的模型。</p>
          </div>
          <button
            className="icon-button"
            aria-label="关闭设置"
            disabled={busy}
            onClick={() => {
              setKey("");
              onClose();
            }}
          >
            ×
          </button>
        </header>
        <div className="settings-layout">
          <aside>
            <button
              className="new-provider"
              disabled={busy}
              onClick={() => edit()}
            >
              ＋ 添加模型
            </button>
            {providers.map((p) => (
              <div
                key={p.id}
                className={`provider-card ${id === p.id ? "selected" : ""}`}
              >
                <button disabled={busy} onClick={() => edit(p)}>
                  <strong>{p.name}</strong>
                  <small>{p.modelId}</small>
                  <span>
                    {p.credentialState === "persistent"
                      ? "密钥安全保存"
                      : p.credentialState === "session_only"
                        ? "密钥仅本次运行可用"
                        : "需要重新填写密钥"}
                  </span>
                </button>
                <button
                  disabled={busy}
                  className="provider-remove"
                  aria-label={`删除模型 ${p.name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除模型“${p.name}”？已被会话使用的模型不能删除。`,
                      )
                    )
                      void action(async () => {
                        await window.desktop.providers.remove(p.id);
                        if (id === p.id) edit();
                        await onRefresh();
                      });
                  }}
                >
                  删除
                </button>
              </div>
            ))}
            <p className="settings-hint">
              API Key
              不回显、不进入浏览器存储。安全密钥库不可用时仅在本次应用运行中保存。
            </p>
          </aside>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const p = await window.desktop.providers.save(
                  draft,
                  key || undefined,
                  id,
                );
                setKey("");
                setId(p.id);
                await onRefresh();
                setNotice(
                  p.credentialState === "session_only"
                    ? "密钥仅本次运行可用"
                    : "配置已保存",
                );
              });
            }}
          >
            <div className="form-grid">
              <label>
                模型名称
                <input
                  aria-label="模型名称"
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(e) => field("name", e.target.value)}
                />
              </label>
              <label>
                模型 ID
                <input
                  aria-label="模型 ID"
                  required
                  value={draft.modelId}
                  placeholder="服务端的模型名称"
                  onChange={(e) => field("modelId", e.target.value)}
                />
              </label>
              <label className="full">
                Base URL
                <input
                  aria-label="Base URL"
                  type="url"
                  required
                  value={draft.baseUrl}
                  onChange={(e) => field("baseUrl", e.target.value)}
                />
                <small>
                  填写 API 根地址（如 /v1）；也可填写完整 /chat/completions
                  地址。
                </small>
              </label>
              <label className="full">
                API Key
                <input
                  aria-label="API Key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  required={!id}
                  placeholder={id ? "留空保留原密钥，输入替换" : "填写 API Key"}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <label>
                上下文窗口
                <input
                  type="number"
                  min={2048}
                  max={2000000}
                  required
                  value={draft.contextWindow}
                  onChange={(e) =>
                    field("contextWindow", Number(e.target.value))
                  }
                />
              </label>
              <label>
                输出 token 上限
                <input
                  type="number"
                  min={1}
                  required
                  max={draft.contextWindow - 1}
                  value={draft.maxOutputTokens}
                  onChange={(e) =>
                    field("maxOutputTokens", Number(e.target.value))
                  }
                />
              </label>
              <label>
                超时（秒）
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={draft.timeoutMs / 1000}
                  onChange={(e) =>
                    field("timeoutMs", Number(e.target.value) * 1000)
                  }
                />
              </label>
              <label>
                输出参数
                <select
                  value={draft.capabilities.outputTokenField}
                  onChange={(e) =>
                    field("capabilities", {
                      ...draft.capabilities,
                      outputTokenField: e.target.value as
                        | "max_tokens"
                        | "max_completion_tokens",
                    })
                  }
                >
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">
                    max_completion_tokens
                  </option>
                </select>
              </label>
            </div>
            <div className="capability-box">
              <label>
                <input
                  type="checkbox"
                  checked={draft.capabilities.tools}
                  onChange={(e) =>
                    field("capabilities", {
                      ...draft.capabilities,
                      tools: e.target.checked,
                    })
                  }
                />
                支持工具调用
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.capabilities.temperature}
                  onChange={(e) =>
                    field("capabilities", {
                      ...draft.capabilities,
                      temperature: e.target.checked,
                    })
                  }
                />
                支持 temperature 参数
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.allowInsecureHttp}
                  onChange={(e) => field("allowInsecureHttp", e.target.checked)}
                />
                允许明文 HTTP（仅可信服务）
              </label>
              <small>
                不确定模型能力时先关闭可选参数。明文 HTTP 会暴露请求和密钥。
              </small>
            </div>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="notice success" role="status">
                {notice}
              </p>
            )}
            <footer>
              <button
                type="button"
                disabled={!id || busy}
                onClick={() =>
                  void action(async () => {
                    const result = await window.desktop.providers.test(id!);
                    setNotice(
                      `连接成功 · 工具能力：${result.tools === true ? "已验证" : result.tools === false ? "不支持" : "尚未确认"}`,
                    );
                  })
                }
              >
                测试连接
              </button>
              <button className="primary" type="submit" disabled={busy}>
                {busy ? "处理中…" : "保存配置"}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  );
}

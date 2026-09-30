/** Exposes the renderer’s deliberately restricted bridge to approved desktop IPC operations. */
/* 中文：向渲染进程提供受限桥接接口，仅允许调用已批准的桌面 IPC 操作。 */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, IpcResult, RunEvent } from '../../../../packages/shared/src/index';
/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
async function invoke<T>(channel: string, input: unknown): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, input);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
/** Captures domain configuration or protocol data whose fields are consumed together by this module. */
const api: DesktopApi = {
  fastgpt: {
    createSession: (appId) => invoke('fastgpt:create-session', { appId }),
    connection: () => invoke('fastgpt:connection', {}),
    save: (baseUrl, apiKey) => invoke('fastgpt:save', { baseUrl, apiKey }),
    disconnect: () => invoke('fastgpt:disconnect', {}),
    list: (query) => invoke('fastgpt:list', query),
  },
  providers: {
    list: () => invoke('providers:list', {}),
    save: (draft, apiKey, id) =>
      invoke('providers:save', {
        draft,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(id ? { id } : {}),
      }),
    test: (id) => invoke('providers:test', { id }),
    remove: (id) => invoke('providers:remove', { id }),
  },
  sessions: {
    list: (filter = {}) => invoke('sessions:list', filter),
    create: (draft) => invoke('sessions:create', draft),
    update: (id, patch) => invoke('sessions:update', { id, patch }),
    remove: (id) => invoke('sessions:remove', { id }),
    messages: (id) => invoke('sessions:messages', { id }),
  },
  runs: {
    timing: (runId) => invoke('runs:timing', { runId }),
    list: (sessionId) => invoke('runs:list', { sessionId }),
    start: (sessionId, text, options) => invoke('runs:start', { sessionId, text, ...options }),
    cancel: (runId) => invoke('runs:cancel', { runId }),
    events: (runId, afterSeq = 0) => invoke('runs:events', { runId, afterSeq }),
  },
  onRunEvent: (listener) => {
    /** Implements one focused part of this module’s public responsibility. */
    const handler = (_event: unknown, event: RunEvent) => listener(event);
    ipcRenderer.on('run:event', handler);
    return () => {
      ipcRenderer.removeListener('run:event', handler);
    };
  },
};
contextBridge.exposeInMainWorld('desktop', api);

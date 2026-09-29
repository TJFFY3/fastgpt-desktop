/** Provides the index module for the desktop application. */
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, IpcResult, RunEvent } from '../../../../packages/shared/src/index';
/** Performs invoke for this module. */
async function invoke<T>(channel: string, input: unknown): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, input);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
/** Configures api, the module data used by this workflow. */
const api: DesktopApi = {
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
    /** Performs handler for this module. */
    const handler = (_event: unknown, event: RunEvent) => listener(event);
    ipcRenderer.on('run:event', handler);
    return () => {
      ipcRenderer.removeListener('run:event', handler);
    };
  },
};
contextBridge.exposeInMainWorld('desktop', api);

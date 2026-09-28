import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  DesktopApi,
  IpcResult,
  RunEvent,
} from "../../../../packages/shared/src/index";
async function invoke<T>(channel: string, input: unknown): Promise<T> {
  const result: IpcResult<T> = await ipcRenderer.invoke(channel, input);
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
const api: DesktopApi = {
  workspaces:{ensure:sessionId=>invoke("workspaces:ensure",{sessionId}),previewSelection:sessionId=>invoke("workspaces:preview",{sessionId}),importSelection:(sessionId,grantId)=>invoke("workspaces:import",{sessionId,grantId}),list:(sessionId,cursor)=>invoke("workspaces:list",{sessionId,...(cursor?{cursor}:{})}),read:(sessionId,path,offset,maxBytes)=>invoke("workspaces:read",{sessionId,path,offset,maxBytes}),diff:sessionId=>invoke("workspaces:diff",{sessionId})},
  attachments:{
    pick:sessionId=>invoke("attachments:pick",{sessionId}),
    importDropped:(sessionId,files)=>{
      if(!Array.isArray(files)||files.length<1||files.length>16)return Promise.reject(new Error("INVALID_INPUT: 文件数量无效"));
      const paths=files.map(file=>webUtils.getPathForFile(file));if(paths.some(p=>!p))return Promise.reject(new Error("INVALID_INPUT: 请拖入电脑上的真实文件"));
      return invoke("attachments:import",{sessionId,paths});
    },
    list:sessionId=>invoke("attachments:list",{sessionId}),removeDraft:id=>invoke("attachments:remove",{id}),
  },
  providers: {
    list: () => invoke("providers:list", {}),
    save: (draft, apiKey, id) =>
      invoke("providers:save", {
        draft,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(id ? { id } : {}),
      }),
    test: (id) => invoke("providers:test", { id }),
    remove: (id) => invoke("providers:remove", { id }),
  },
  sessions: {
    list: (filter = {}) => invoke("sessions:list", filter),
    create: (draft) => invoke("sessions:create", draft),
    update: (id, patch) => invoke("sessions:update", { id, patch }),
    remove: (id) => invoke("sessions:remove", { id }),
    messages: (id) => invoke("sessions:messages", { id }),
  },
  runs: {
    timing:(runId)=>invoke("runs:timing",{runId}),
    list: (sessionId) => invoke("runs:list", { sessionId }),
    start: (sessionId, text, options) => invoke("runs:start", { sessionId, text,...options }),
    cancel: (runId) => invoke("runs:cancel", { runId }),
    events: (runId, afterSeq = 0) => invoke("runs:events", { runId, afterSeq }),
  },
  onRunEvent: (listener) => {
    const handler = (_event: unknown, event: RunEvent) => listener(event);
    ipcRenderer.on("run:event", handler);
    return () => {
      ipcRenderer.removeListener("run:event", handler);
    };
  },
};
contextBridge.exposeInMainWorld("desktop", api);

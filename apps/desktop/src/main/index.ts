import {
  app,
  ipcMain,
  protocol,
  safeStorage,
  utilityProcess,
  session,
  dialog,
} from "electron";
import { join, isAbsolute, resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { openStore } from "../../../../packages/storage/src/index";
import { SecretStore } from "./credentials";
import { ProviderService } from "./provider-service";
import { PrincipalService } from "./principal";
import { AgentService } from "./agent-service";
import { WorkerSupervisor } from "./worker-supervisor";
import { createBuiltinTools } from "./tool-gateway";
import { createWindow } from "./window";
import { installProtocol } from "./protocol";
import { registerIpc } from "./ipc";
import { createFeatureServices } from "./feature-services";
import { registerAttachmentHandlers } from "./ipc/attachment-handlers";
import { registerWorkspaceHandlers } from "./ipc/workspace-handlers";
import { registerApprovalHandlers } from "./ipc/approval-handlers";
import { registerWorkspaceTools } from "./tools/workspace-tools";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
if (__TEST_BUILD__ && process.env.FASTGPT_DESKTOP_TEST_DATA_DIR) {
  const path = process.env.FASTGPT_DESKTOP_TEST_DATA_DIR;
  if (!isAbsolute(path))
    throw new Error("Test data directory must be absolute.");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  app.setPath("userData", path);
}
app.setName("FastGPT Desktop");
// Only the owner may recover runs or write this user-data store.
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const store = openStore(join(app.getPath("userData"), "fastgpt.sqlite"));
      store.runs.recoverInterrupted();
      const secrets = new SecretStore(store.credentials, {
        isAvailable: () =>
          __TEST_BUILD__
            ? Promise.resolve(false)
            : safeStorage.isAsyncEncryptionAvailable(),
        // macOS Keychain and Windows OS encryption; Linux remains memory-only until
        // the selected backend's asynchronous security can be verified independently.
        isSecure: async () => ["darwin", "win32"].includes(process.platform),
        encrypt: (text) => safeStorage.encryptStringAsync(text),
        decrypt: async (data) =>
          (await safeStorage.decryptStringAsync(Buffer.from(data))).result,
      });
      const providers = new ProviderService(store.providers, secrets);
      const supervisor = new WorkerSupervisor(() =>
        utilityProcess.fork(join(__dirname, "agent-worker.js"), [], {
          serviceName: "FastGPT Agent",
          stdio: "pipe",
          env: {
            ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
            ...(process.env.SystemRoot
              ? { SystemRoot: process.env.SystemRoot }
              : {}),
          },
        }),
      );
      let agents: AgentService;
      const principal = new PrincipalService((n) => agents.cancelNamespace(n));
      const window = await createWindow(join(__dirname, "../preload/index.js"));
      const features=createFeatureServices({store,dataDirectory:app.getPath("userData"),helperPath:app.isPackaged?join(process.resourcesPath,"safe-files/safe-files"):join(app.getAppPath(),"native-build/safe-files"),principal:()=>principal.current(),window:()=>window.webContents.id,
        dockerExecutable:process.platform==="darwin"?[join(homedir(),".docker/bin/docker"),"/usr/local/bin/docker"].find(p=>existsSync(p))??"/usr/local/bin/docker":process.platform==="win32"?"C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe":"/usr/bin/docker",
        imageDirectory:app.isPackaged?join(process.resourcesPath,"sandbox-image"):resolve(app.getAppPath(),"../../packages/sandbox/image"),persistEvent:(context,event)=>agents.emit(context,event),
        pickWorkspace:async()=>{const result=await dialog.showOpenDialog(window,{title:"选择工作目录（先预览，不会上传）",properties:["openDirectory"]});return result.canceled?null:result.filePaths[0]??null;},
        confirmExport:async(kind,paths)=>(await dialog.showMessageBox(window,{type:"warning",title:kind==="remove_backups"?"永久删除备份":"确认本地文件操作",message:kind==="delete"?"确认删除以下源文件？":kind==="restore"?"确认从备份恢复以下文件？":kind==="remove_backups"?"确认永久删除以下备份？删除后无法通过应用恢复。":"确认逐文件写入以下目标？",detail:paths.join("\n")+"\n覆盖和删除前会保留独立备份。操作不是整目录事务，请暂停其他程序对此目录的写入。",buttons:["确认","取消"],defaultId:1,cancelId:1})).response===0,
      });
      app.on("second-instance", () => {
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });
      const tools=createBuiltinTools();registerWorkspaceTools(tools,{workspace:features.workspaces,sandbox:features.sandbox,approvals:features.approvals,store,persistEvent:(context,event)=>agents.emit(context,event)});
      agents = new AgentService(
        store,
        providers,
        supervisor,
        tools,
        () => principal.current(),
        (e) => {
          if (!window.isDestroyed()) window.webContents.send("run:event", e);
        },
        (n,request,profile,tools)=>features.context.assembleContext(n,request.sessionId,request.text,request.attachmentIds,profile,tools),
        features.approvals,
      );
      const devUrl = __DEV_BUILD__
        ? process.env.ELECTRON_RENDERER_URL
        : undefined;
      const devOrigin = devUrl ? new URL(devUrl).origin : undefined;
      // A bounded test-only delay reproduces asynchronous keyring/start races.
      const testStartDelay = __TEST_BUILD__
        ? Math.min(
            2000,
            Math.max(
              0,
              Number(process.env.FASTGPT_DESKTOP_TEST_START_DELAY_MS) || 0,
            ),
          )
        : 0;
      registerIpc(ipcMain, {
        store,
        providers,
        agents,
        principal: () => principal.current(),
        window: () => window.webContents,
        devOrigin,
        beforeRunStart: testStartDelay
          ? () => new Promise((resolve) => setTimeout(resolve, testStartDelay))
          : undefined,
      });
      registerAttachmentHandlers(ipcMain,{attachments:features.attachments,grants:features.grants,principal:()=>principal.current(),window:()=>window.webContents,devOrigin,
        pick:async()=>{const result=await dialog.showOpenDialog(window,{title:"添加附件（只创建本地副本）",properties:["openFile","multiSelections"]});return result.canceled?[]:result.filePaths;},
        confirmDrop:async paths=>(await dialog.showMessageBox(window,{type:"question",title:"确认导入文件",message:"将以下文件复制到本会话的隔离工作区？",detail:paths.join("\n")+"\n这里只创建本地副本，发送消息时才会传给模型。",buttons:["取消","导入副本"],defaultId:0,cancelId:0})).response===1,
      });
      registerWorkspaceHandlers(ipcMain,{workspaces:features.workspaces,exports:features.exports,principal:()=>principal.current(),window:()=>window.webContents,devOrigin});
      registerApprovalHandlers(ipcMain,{approvals:features.approvals,sandbox:features.sandbox,store,principal:()=>principal.current(),window:()=>window.webContents,devOrigin,dataDirectory:app.getPath("userData"),imagePreparation:features.imagePreparation});
      if (devUrl) await window.loadURL(devUrl);
      else {
        await installProtocol(join(__dirname, "../renderer"));
        await window.loadURL("app://desktop/index.html");
      }
      let quitting = false;
      app.on("before-quit", (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        features.imagePreparation.controller?.abort();
        void supervisor.shutdown().then(async()=>{await Promise.allSettled([features.sandbox.shutdown(),features.imagePreparation.promise??Promise.resolve()]);}).finally(() => {
          agents.dispose();
          features.exports.dispose();
          secrets.clearSessionOnly();
          store.close();
          app.quit();
        });
      });
      app.on("window-all-closed", () => app.quit());
    })
    .catch(() => {
      console.error("FastGPT Desktop failed to initialize.");
      app.exit(1);
    });

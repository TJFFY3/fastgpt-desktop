/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
import { app, ipcMain, protocol, safeStorage, utilityProcess, session } from 'electron';
import { join, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openStore, activeStatuses } from '../../../../packages/storage/src/index';
import { SecretStore } from './credentials';
import { ProviderService } from './provider-service';
import { FastGptService } from './fastgpt-service';
import { PrincipalService } from './principal';
import { AgentService } from './agent-service';
import { WorkerSupervisor } from './worker-supervisor';
import { createBuiltinTools } from './tool-gateway';
import { createWindow } from './window';
import { installProtocol } from './protocol';
import { registerIpc } from './ipc';
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
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
  if (!isAbsolute(path)) throw new Error('Test data directory must be absolute.');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  app.setPath('userData', path);
}
app.setName('FastGPT Desktop');
// Only the owner may recover runs or write this user-data store.
// 只有持有数据存储所有权的进程才能恢复任务或写入用户数据。
if (!app.requestSingleInstanceLock()) app.quit();
else
  void app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      const store = openStore(join(app.getPath('userData'), 'fastgpt.sqlite'));
      store.runs.recoverInterrupted();
      const secrets = new SecretStore(store.credentials, {
        isAvailable: () =>
          __TEST_BUILD__ ? Promise.resolve(false) : safeStorage.isAsyncEncryptionAvailable(),
        // macOS Keychain and Windows OS encryption; Linux remains memory-only until
        // macOS 使用钥匙串，Windows 使用系统加密；Linux 暂时仅使用内存存储，
        // the selected backend's asynchronous security can be verified independently.
        // 直到能够独立验证所选后端的异步安全能力。
        isSecure: async () => ['darwin', 'win32'].includes(process.platform),
        encrypt: (text) => safeStorage.encryptStringAsync(text),
        decrypt: async (data) => (await safeStorage.decryptStringAsync(Buffer.from(data))).result,
      });
      const providers = new ProviderService(store.providers, secrets);
      const fastgpt = new FastGptService(store.fastgpt, secrets, fetch, store, async (n) => {
        // 中文：切换或断开云端凭据前先取消旧目标的活动请求，禁止旧应用继续提交成功结果。
        const targets = new Set(
          store.providers
            .list(n)
            .filter((p) => p.fastgpt)
            .map((p) => p.id),
        );
        await Promise.all(
          store.sessions
            .list(n)
            .filter((s) => targets.has(s.providerId))
            .flatMap((s) =>
              store.runs
                .list(n, s.id)
                .filter((r) => activeStatuses.includes(r.status))
                .map((r) => agents.cancel(n, r.id)),
            ),
        );
      });
      const supervisor = new WorkerSupervisor(() =>
        utilityProcess.fork(join(__dirname, 'agent-worker.js'), [], {
          serviceName: 'FastGPT Agent',
          stdio: 'pipe',
          env: {
            ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
            ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          },
        }),
      );
      let agents: AgentService;
      const principal = new PrincipalService((n) => agents.cancelNamespace(n));
      const window = await createWindow(join(__dirname, '../preload/index.js'));
      app.on('second-instance', () => {
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      });
      agents = new AgentService(
        store,
        providers,
        supervisor,
        createBuiltinTools(),
        () => principal.current(),
        (e) => {
          if (!window.isDestroyed()) window.webContents.send('run:event', e);
        },
      );
      const devUrl = __DEV_BUILD__ ? process.env.ELECTRON_RENDERER_URL : undefined;
      const devOrigin = devUrl ? new URL(devUrl).origin : undefined;
      // A bounded test-only delay reproduces asynchronous keyring/start races.
      // 仅在测试构建中使用有限延迟，复现异步密钥存储与任务启动之间的竞态。
      const testStartDelay = __TEST_BUILD__
        ? Math.min(2000, Math.max(0, Number(process.env.FASTGPT_DESKTOP_TEST_START_DELAY_MS) || 0))
        : 0;
      registerIpc(ipcMain, {
        store,
        providers,
        fastgpt,
        agents,
        principal: () => principal.current(),
        window: () => window.webContents,
        devOrigin,
        beforeRunStart: testStartDelay
          ? () => new Promise((resolve) => setTimeout(resolve, testStartDelay))
          : undefined,
      });
      if (devUrl) await window.loadURL(devUrl);
      else {
        await installProtocol(join(__dirname, '../renderer'));
        await window.loadURL('app://desktop/index.html');
      }
      let quitting = false;
      app.on('before-quit', (event) => {
        if (quitting) return;
        event.preventDefault();
        quitting = true;
        void supervisor.shutdown().finally(() => {
          secrets.clearSessionOnly();
          store.close();
          app.quit();
        });
      });
      app.on('window-all-closed', () => app.quit());
    })
    .catch(() => {
      console.error('FastGPT Desktop failed to initialize.');
      app.exit(1);
    });

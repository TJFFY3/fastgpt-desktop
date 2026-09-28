import { app, ipcMain, protocol, safeStorage, utilityProcess, session } from 'electron';
import { join, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openStore } from '../../../../packages/storage/src/index';
import { SecretStore } from './credentials';
import { ProviderService } from './provider-service';
import { PrincipalService } from './principal';
import { AgentService } from './agent-service';
import { WorkerSupervisor } from './worker-supervisor';
import { createBuiltinTools } from './tool-gateway';
import { createWindow } from './window';
import { installProtocol } from './protocol';
import { registerIpc } from './ipc';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
if (__TEST_BUILD__ && process.env.FASTGPT_DESKTOP_TEST_DATA_DIR) {
  const path = process.env.FASTGPT_DESKTOP_TEST_DATA_DIR;
  if (!isAbsolute(path)) throw new Error('Test data directory must be absolute.');
  mkdirSync(path, { recursive: true, mode: 0o700 }); app.setPath('userData', path);
}
app.setName('FastGPT Desktop');
void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const store = openStore(join(app.getPath('userData'), 'fastgpt.sqlite')); store.runs.recoverInterrupted();
  const secrets = new SecretStore(store.credentials, {
    isAvailable: () => __TEST_BUILD__ ? Promise.resolve(false) : safeStorage.isAsyncEncryptionAvailable(),
    // macOS Keychain and Windows OS encryption; Linux remains memory-only until
    // the selected backend's asynchronous security can be verified independently.
    isSecure: async () => ['darwin', 'win32'].includes(process.platform),
    encrypt: text => safeStorage.encryptStringAsync(text), decrypt: async data => (await safeStorage.decryptStringAsync(Buffer.from(data))).result
  });
  const providers = new ProviderService(store.providers, secrets);
  const supervisor = new WorkerSupervisor(() => utilityProcess.fork(join(__dirname, 'agent-worker.js'), [], { serviceName: 'FastGPT Agent', stdio: 'pipe', env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } }));
  let agents: AgentService;
  const principal = new PrincipalService(n => agents.cancelNamespace(n));
  const window = await createWindow(join(__dirname, '../preload/index.js'));
  agents = new AgentService(store, providers, supervisor, createBuiltinTools(), () => principal.current(), e => { if (!window.isDestroyed()) window.webContents.send('run:event', e); });
  const devUrl = __DEV_BUILD__ ? process.env.ELECTRON_RENDERER_URL : undefined;
  const devOrigin = devUrl ? new URL(devUrl).origin : undefined;
  registerIpc(ipcMain, { store, providers, agents, principal: () => principal.current(), window: () => window.webContents, devOrigin });
  if (devUrl) await window.loadURL(devUrl); else { await installProtocol(join(__dirname, '../renderer')); await window.loadURL('app://desktop/index.html'); }
  let quitting = false;
  app.on('before-quit', event => { if (quitting) return; event.preventDefault(); quitting = true; void supervisor.shutdown().finally(() => { secrets.clearSessionOnly(); store.close(); app.quit(); }); });
  app.on('window-all-closed', () => app.quit());
}).catch(() => { console.error('FastGPT Desktop failed to initialize.'); app.exit(1); });

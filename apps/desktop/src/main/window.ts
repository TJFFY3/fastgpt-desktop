/** Implements one focused part of this module’s public responsibility. */
/* 中文：实现本模块职责中的一项具体操作。 */
/** Implements an Electron main-process service or integration boundary. */
/* 中文：实现 Electron 主进程服务及其与其他模块的集成接口。 */
export function windowOptions(preload: string) {
  return {
    width: 1280,
    height: 840,
    minWidth: 920,
    minHeight: 640,
    title: 'FastGPT Desktop',
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}
/** Validates or normalizes untrusted input before it crosses this module boundary. */
/* 中文：在不可信输入进入模块前执行校验或规范化处理。 */
export function safeExternalUrl(value: string) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
/** Persists or updates state while maintaining this module’s data invariants. */
/* 中文：保存或更新状态，同时维持本模块的数据一致性约束。 */
export async function createWindow(preload: string) {
  const { BrowserWindow, shell } = await import('electron');
  const window = new BrowserWindow(windowOptions(preload));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (safeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  return window;
}

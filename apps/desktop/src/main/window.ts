/** Performs window Options for this module. */
/** Provides the window module for the desktop application. */
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
/** Performs safe External Url for this module. */
export function safeExternalUrl(value: string) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
/** Performs create Window for this module. */
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

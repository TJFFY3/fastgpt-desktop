import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ command, mode }) => ({
  main: { define: { __TEST_BUILD__: JSON.stringify(mode === 'test'), __DEV_BUILD__: JSON.stringify(command === 'serve') }, build: { externalizeDeps: false, rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), 'agent-worker': resolve(__dirname, 'src/worker/index.ts') } } } },
  preload: { build: { externalizeDeps: false, rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } } },
  renderer: { root: resolve(__dirname, 'src/renderer'), plugins: [react()], build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } } }
}));

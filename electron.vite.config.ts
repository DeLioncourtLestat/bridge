import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    // mcp.js: the agent's tasks-and-notes server, started by Claude Code as a child process
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), mcp: resolve(__dirname, 'src/main/mcp.ts') } } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
})

import { defineConfig } from 'vitest/config'

// Runs under Electron's Node (see test:unit) so native modules match the app's ABI.
export default defineConfig({
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', pool: 'forks', testTimeout: 30_000 },
})

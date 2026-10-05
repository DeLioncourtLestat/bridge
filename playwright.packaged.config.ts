import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: 'tests/packaged', timeout: 90_000, expect: { timeout: 10_000 }, workers: 1, reporter: [['list']] })

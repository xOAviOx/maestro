import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for pure main-process logic (the DAG scheduler). Deliberately node
 * environment + no native modules: scheduler tests run against an in-memory fake
 * store, so `better-sqlite3` (and its ABI dance) never enters the picture. The
 * SQLite path is covered by the tsx smoke (`npm run smoke:m9`) instead.
 */
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'shared') }
  },
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts']
  }
})

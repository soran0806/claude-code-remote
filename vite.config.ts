/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  // bridge/test は node:test で書いてあるので vitest には拾わせない（npm run test:bridge で回す）
  test: { include: ['tests/**/*.test.ts'] },
})

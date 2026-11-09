/// <reference types="vitest/config" />
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Stamps the built commit into both HTML entries so a deployment can be traced back to its commit.
// The deploy workflows set APP_VERSION to the commit they deploy.
const appVersion = (): Plugin => ({
  name: 'app-version',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { name: 'app-version', content: process.env.APP_VERSION ?? 'local' },
      injectTo: 'head',
    },
  ],
})

// The Cloudflare plugin runs the Worker (API, TripDO) inside `vite dev` and builds it next to the
// client; it is left out of Vitest, which tests the Worker's logic directly.
export default defineConfig({
  plugins: [react(), appVersion(), ...(process.env.VITEST ? [] : [cloudflare()])],
  // Port 5176: TKU-BridgeTable uses 5173, BridgeHall 5174, TKU Arcade 5175
  server: { port: 5176, strictPort: true },
  // scripts/check-budget.mjs reads the manifest to know which chunks each entry loads
  build: { manifest: true },
  environments: {
    // Only the browser build has HTML entries; a top-level input would also reach the Worker build
    client: {
      build: {
        rolldownOptions: {
          // Two entries (ARCHITECTURE.md §1): the app, and the read-only share page as its own
          // small bundle that never loads the editor
          input: { app: 'index.html', share: 'share.html' },
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
})

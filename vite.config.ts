/// <reference types="vitest/config" />
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
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

// The Service Worker (sw/sw.ts, e10-t05) is a third client entry emitted as /sw.js. After bundling,
// its placeholders get the list of every client file to precache and a version that changes with
// them (a new build = a new SW = the app's 「有新版本」 prompt).
const serviceWorker = (): Plugin => ({
  name: 'service-worker-precache',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const sw = bundle['sw.js']
    if (!sw || sw.type !== 'chunk') return
    const files = Object.keys(bundle)
      .filter((file) => file !== 'sw.js' && !file.endsWith('.map') && !file.startsWith('.'))
      .filter((file) => !file.endsWith('.html'))
      .map((file) => `/${file}`)
      .sort()
    // '/' only: the assets binding redirects /index.html to /, and a redirected response cannot
    // answer a navigation
    const precache = ['/', ...files]
    const hash = createHash('sha256').update(precache.join(' ')).digest('hex').slice(0, 10)
    const version = `${process.env.APP_VERSION ?? 'local'}-${hash}`
    sw.code = sw.code
      .replaceAll('__SW_PRECACHE__', JSON.stringify(precache))
      .replaceAll('__SW_VERSION__', JSON.stringify(version))
  },
})

// The Cloudflare plugin runs the Worker (API, TripDO) inside `vite dev` and builds it next to the
// client; it is left out of Vitest, which tests the Worker's logic directly.
export default defineConfig({
  plugins: [react(), appVersion(), serviceWorker(), ...(process.env.VITEST ? [] : [cloudflare()])],
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
          // The Service Worker is the third: a fixed name at the root (its scope is the whole site)
          input: { app: 'index.html', share: 'share.html', sw: 'sw/sw.ts' },
          // MapLibre in its own lazy chunk named `maplibre` (budget ≤ 250 kB gzip, §6); only the
          // map component imports it (rolldown's successor to manualChunks)
          output: {
            entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
            codeSplitting: { groups: [{ name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ }] },
          },
        },
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Registers the page catalogs (shared/i18n/pages/) for tests that render a page's parts directly
    setupFiles: ['tests/setup.ts'],
  },
})

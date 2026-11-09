// JS budgets (docs/ARCHITECTURE.md §6, e11-t01/e11-t02), gzip:
//   app first screen   ≤ 180 kB  (index.html and its static imports; lazy pages and MapLibre excluded)
//   share first screen ≤ 120 kB  (share.html and its static imports)
//   MapLibre chunk     ≤ 300 kB  (shared by both entries; passes while it does not exist yet)
//
// An entry's JS is what it loads before it can render: the entry chunk and its static imports.
// Dynamic imports load later, so they do not count. Reads Vite's manifest, so run it after
// `npm run build`; paths are relative to the current directory.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const CLIENT_DIR = 'dist/client'
const MANIFEST = join(CLIENT_DIR, '.vite/manifest.json')
const KB = 1000
const APP_ENTRY = 'index.html'
const SHARE_ENTRY = 'share.html'
const APP_LIMIT = 180 * KB
const SHARE_LIMIT = 120 * KB
const MAPLIBRE_LIMIT = 300 * KB // raised from 250 on 2026-11-09: maplibre-gl 6.x (fixes GHSA-jrc7-96c5-q579) measures 287.7 kB gzip
const MAPLIBRE = /maplibre/i

if (!existsSync(MANIFEST)) {
  console.error(`No ${MANIFEST}: run \`npm run build\` first`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

// Adds a manifest key and its static imports
function collect(key, seen) {
  if (seen.has(key)) return
  const chunk = manifest[key]
  if (!chunk) throw new Error(`Manifest has no chunk for ${key}`)
  seen.add(key)
  for (const imported of chunk.imports ?? []) collect(imported, seen)
}

const collectAll = (keys) => {
  const seen = new Set()
  for (const key of keys) collect(key, seen)
  return seen
}

const gzipSize = (keys) =>
  [...keys]
    .map((key) => manifest[key].file)
    .filter((file) => file.endsWith('.js'))
    .reduce((sum, file) => sum + gzipSync(readFileSync(join(CLIENT_DIR, file))).length, 0)

let failed = false
const budgets = []
for (const [name, entry, limit] of [
  ['app first screen', APP_ENTRY, APP_LIMIT],
  ['share first screen', SHARE_ENTRY, SHARE_LIMIT],
]) {
  if (!manifest[entry]?.isEntry) {
    console.log(`FAIL ${name}: ${MANIFEST} has no entry ${entry}`)
    failed = true
    continue
  }
  budgets.push({ name, keys: collectAll([entry]), limit })
}

// The MapLibre chunk: any chunk named after maplibre (the lazy map module or the library itself),
// with its static imports, minus what an entry already loads (that is the entry's budget)
const mapKeys = Object.keys(manifest).filter(
  (key) =>
    !manifest[key].isEntry &&
    (MAPLIBRE.test(key) || MAPLIBRE.test(manifest[key].file) || MAPLIBRE.test(manifest[key].name ?? '')),
)
if (mapKeys.length > 0) {
  const keys = collectAll(mapKeys)
  for (const entry of [APP_ENTRY, SHARE_ENTRY]) {
    if (!manifest[entry]) continue
    for (const key of collectAll([entry])) keys.delete(key)
  }
  budgets.push({ name: 'MapLibre chunk', keys, limit: MAPLIBRE_LIMIT })
} else {
  console.log('ok   MapLibre chunk: not built yet (no chunk named maplibre)')
}

for (const { name, keys, limit } of budgets) {
  const size = gzipSize(keys)
  const ok = size <= limit
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${(size / KB).toFixed(1)} kB / ${limit / KB} kB gzip`)
}
process.exit(failed ? 1 : 0)

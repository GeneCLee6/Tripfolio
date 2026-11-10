import { registerCatalog } from './core.ts'
import { en } from './en.ts'
import { zhTW } from './zh-TW.ts'

// The app's i18n entry: the core (core.ts) with the full catalog registered. Everything in src/
// imports t() from here, so importing it is enough to have every key except the page catalogs
// (shared/i18n/pages/), which each lazy page registers itself. The share page must not
// import this file (it would ship the whole catalog): it uses core.ts and share/catalog.ts, and
// `npm run check-i18n` fails if anything the share page loads imports this file (RULES.md §2).

registerCatalog('zh-TW', zhTW)
registerCatalog('en', en)

export * from './core.ts'

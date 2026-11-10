import { registerCatalog, type MessageKey } from '../core.ts'

// Page catalogs (RULES.md §2): keys only one lazily loaded page uses live in
// shared/i18n/pages/<page>.zh-TW.ts + .en.ts instead of the app catalog, so they ship in that page's
// chunk. The page's entry module imports ./<page>.ts, which calls this at module evaluation; lazy()
// loads the chunk before the page renders, so t() has the keys by then. Registering is additive.
type PageMessages = Partial<Record<MessageKey, string>>

export function registerPageCatalog(zhTW: PageMessages, en: PageMessages): void {
  registerCatalog('zh-TW', zhTW)
  registerCatalog('en', en)
}

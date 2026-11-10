import { picksEn } from './picks.en.ts'
import { picksZhTW } from './picks.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/picks/PicksPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(picksZhTW, picksEn)

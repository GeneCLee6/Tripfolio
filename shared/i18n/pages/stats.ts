import { statsEn } from './stats.en.ts'
import { statsZhTW } from './stats.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/stats/StatsPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(statsZhTW, statsEn)

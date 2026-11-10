import { historyEn } from './history.en.ts'
import { historyZhTW } from './history.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/expenses/history/HistoryPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(historyZhTW, historyEn)

import { recapEn } from './recap.en.ts'
import { recapZhTW } from './recap.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/recap/RecapPage.tsx (the page's lazy entry): registers the
// page's keys when its chunk loads, before the page renders.
registerPageCatalog(recapZhTW, recapEn)

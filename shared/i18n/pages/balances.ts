import { balancesEn } from './balances.en.ts'
import { balancesZhTW } from './balances.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/balances/BalancesPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(balancesZhTW, balancesEn)

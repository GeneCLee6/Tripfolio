import { expensesEn } from './expenses.en.ts'
import { expensesZhTW } from './expenses.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/expenses/ExpensesPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(expensesZhTW, expensesEn)

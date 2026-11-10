import { expenseFormEn } from './expense-form.en.ts'
import { expenseFormZhTW } from './expense-form.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/expenses/ExpenseFormSheet.tsx, which TripLayout loads lazily
// and the Expenses page imports: registers the sheet's keys when that module evaluates, before the
// sheet renders. The files only the sheet loads may use them (RULES.md §2).
registerPageCatalog(expenseFormZhTW, expenseFormEn)

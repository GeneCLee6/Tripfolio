import type { ExpensesMessageKey } from './expenses.zh-TW.ts'

// English for ./expenses.zh-TW.ts (the source): the same keys and {placeholders}.
export const expensesEn: Record<ExpensesMessageKey, string> = {
  'stats.link': 'Statistics',
  'history.sheet.open': 'See change log',
  'expenses.title': 'Expenses',
  'expenses.balancesLink': 'Balances and settling up',
  'expenses.deleteTitle': 'Delete this expense?',
  'expenses.deleteBody': 'It stays in the history and can be restored later.',
  'expenses.deleted': 'Expense deleted',
  'expenses.empty.title': 'No expenses yet',
  'expenses.empty.body': 'Tap “Log expense” to start: log in any currency, settle in one, and everyone sees who owes what.',
  'expenses.noMatch.title': 'No matching expenses',
  'expenses.noMatch.body': 'Try other filters.',
  'expenses.filter.categories': 'Category filter',
  'expenses.filter.member': 'Member',
  'expenses.filter.everyone': 'Everyone',
  'expenses.filter.search': 'Search notes',
  'expenses.dayTotal': 'Total {amount}',
  'expenses.hasReceipt': 'Has a receipt',
  'expenses.linkedStop': 'Stop: {name}',
}

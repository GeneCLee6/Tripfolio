// Keys only the Expenses page uses (RULES.md §2): they ship in its lazy chunk, not in the first
// screen. ./expenses.ts registers them and src/pages/expenses/ExpensesPage.tsx imports it.
// A file that can load without that page must not use them; `npm run check-i18n` names the key to
// move back to ../zh-TW.ts and ../en.ts.
export const expensesZhTW = {
  'stats.link': '統計',
  'history.sheet.open': '查看修改紀錄',
  'expenses.title': '花費',
  'expenses.balancesLink': '餘額與結算',
  'expenses.deleteTitle': '刪除這筆花費？',
  'expenses.deleteBody': '刪除後會留在修改歷史，之後也能復原。',
  'expenses.deleted': '已刪除一筆花費',
  'expenses.empty.title': '還沒有花費',
  'expenses.empty.body': '按「記一筆」開始記帳：原幣記、主幣算，大家分得清清楚楚。',
  'expenses.noMatch.title': '沒有符合的花費',
  'expenses.noMatch.body': '換個篩選條件試試。',
  'expenses.filter.categories': '類別篩選',
  'expenses.filter.member': '成員',
  'expenses.filter.everyone': '所有成員',
  'expenses.filter.search': '搜尋說明',
  'expenses.dayTotal': '小計 {amount}',
  'expenses.hasReceipt': '有收據',
  'expenses.linkedStop': '行程點：{name}',
} as const

export type ExpensesMessageKey = keyof typeof expensesZhTW

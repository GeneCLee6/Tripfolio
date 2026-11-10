// Keys only the Expense history page uses (RULES.md §2): they ship in its lazy chunk, not in the first
// screen. ./history.ts registers them and src/pages/expenses/history/HistoryPage.tsx imports it.
// A file that can load without that page must not use them; `npm run check-i18n` names the key to
// move back to ../zh-TW.ts and ../en.ts.
export const historyZhTW = {
  'history.title': '修改紀錄',
  'history.lead': '花費、公基金與結算的每一次改動，新的在上面。',
  'history.filter.label': '紀錄種類',
  'history.filter.all': '全部',
  'history.empty.title': '還沒有修改紀錄',
  'history.empty.body': '記帳、修改或刪除花費後，這裡會留下紀錄。',
  'history.versions': '看版本',
  'history.versionsLabel': '看「{name}」的版本',
  'history.deleted.title': '已刪除的花費',
  'history.deleted.empty': '沒有刪除的花費。',
  'history.deleted.at': '{time} 刪除',
  'history.undelete': '取消刪除',
  'history.undeleteLabel': '取消刪除「{name}」',
  'history.undeleted': '已取消刪除',
} as const

export type HistoryMessageKey = keyof typeof historyZhTW

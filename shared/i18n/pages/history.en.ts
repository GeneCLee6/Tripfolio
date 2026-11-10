import type { HistoryMessageKey } from './history.zh-TW.ts'

// English for ./history.zh-TW.ts (the source): the same keys and {placeholders}.
export const historyEn: Record<HistoryMessageKey, string> = {
  'history.title': 'Change log',
  'history.lead': 'Every change to expenses, the shared fund and settlements, newest first.',
  'history.filter.label': 'Kind of change',
  'history.filter.all': 'All',
  'history.empty.title': 'No changes yet',
  'history.empty.body': 'Once expenses are logged, edited or deleted, the changes show up here.',
  'history.versions': 'Versions',
  'history.versionsLabel': 'Versions of “{name}”',
  'history.deleted.title': 'Deleted expenses',
  'history.deleted.empty': 'Nothing has been deleted.',
  'history.deleted.at': 'Deleted {time}',
  'history.undelete': 'Undelete',
  'history.undeleteLabel': 'Undelete “{name}”',
  'history.undeleted': 'Restored',
}

import { prepEn } from './prep.en.ts'
import { prepZhTW } from './prep.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by each prep page's lazy entry (src/pages/checklists/ChecklistsPage.tsx,
// budget/BudgetPage.tsx, documents/DocumentsPage.tsx, notes/NotesPage.tsx): registers the keys the
// four pages and their shared prep-ui.tsx use when any of their chunks loads, before it renders.
registerPageCatalog(prepZhTW, prepEn)

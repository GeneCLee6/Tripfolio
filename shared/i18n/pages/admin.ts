import { adminEn } from './admin.en.ts'
import { adminZhTW } from './admin.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/admin/UsagePage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(adminZhTW, adminEn)

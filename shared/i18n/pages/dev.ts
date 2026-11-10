import { devEn } from './dev.en.ts'
import { devZhTW } from './dev.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/dev/UiShowcase.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(devZhTW, devEn)

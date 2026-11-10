import { settingsEn } from './settings.en.ts'
import { settingsZhTW } from './settings.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/TripSettingsPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(settingsZhTW, settingsEn)

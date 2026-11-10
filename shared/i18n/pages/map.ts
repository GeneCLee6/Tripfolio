import { mapEn } from './map.en.ts'
import { mapZhTW } from './map.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/map/MapPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(mapZhTW, mapEn)

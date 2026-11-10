import { placesEn } from './places.en.ts'
import { placesZhTW } from './places.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/places/PlacesPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(placesZhTW, placesEn)

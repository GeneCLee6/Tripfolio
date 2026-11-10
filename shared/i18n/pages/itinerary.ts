import { itineraryEn } from './itinerary.en.ts'
import { itineraryZhTW } from './itinerary.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/itinerary/ItineraryPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(itineraryZhTW, itineraryEn)

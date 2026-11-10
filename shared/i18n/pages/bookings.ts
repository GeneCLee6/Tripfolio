import { bookingsEn } from './bookings.en.ts'
import { bookingsZhTW } from './bookings.zh-TW.ts'
import { registerPageCatalog } from './register.ts'

// Imported for its effect by src/pages/bookings/BookingsPage.tsx (the page's lazy entry): registers the page's
// keys when its chunk loads, before the page renders.
registerPageCatalog(bookingsZhTW, bookingsEn)

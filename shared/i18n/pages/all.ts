import './admin.ts'
import './balances.ts'
import './bookings.ts'
import './dev.ts'
import './expense-form.ts'
import './expenses.ts'
import './history.ts'
import './itinerary.ts'
import './map.ts'
import './photos.ts'
import './picks.ts'
import './places.ts'
import './prep.ts'
import './settings.ts'
import './stats.ts'

// Registers every page catalog at once. For tests that render a page's parts without its entry
// module (vitest setup); the app never imports this, each page registers its own.

import './bookings.ts'
import './dev.ts'
import './itinerary.ts'

// Registers every page catalog at once. For tests that render a page's parts without its entry
// module (vitest setup); the app never imports this, each page registers its own.

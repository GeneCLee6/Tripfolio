import type { BookingsMessageKey } from './bookings.zh-TW.ts'
import type { DevMessageKey } from './dev.zh-TW.ts'
import type { ItineraryMessageKey } from './itinerary.zh-TW.ts'

// The keys of every page catalog, for MessageKey in ../core.ts. Types only: nothing here is bundled.
export type PageMessageKey = BookingsMessageKey | DevMessageKey | ItineraryMessageKey

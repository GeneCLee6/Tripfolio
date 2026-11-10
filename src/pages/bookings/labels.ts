import type { BookingStopSlot } from '../../../shared/api/bookings.ts'
import type { Trip } from '../../../shared/api/types.ts'
import { formatDate } from '../../../shared/i18n/format.ts'
import type { CurrencyCode } from '../../../shared/money/currencies.ts'
import type { Translate } from '../../lib/i18n.ts'

// Labels shared by the bookings page and its sheets (kept out of the sheets so the page does not
// load them, and with them zod, before a sheet opens).

/** An auto-created stop's slot: 出發／抵達／取車／還車, or the date of a driver's day */
export function slotLabelText(slot: BookingStopSlot | null, t: Translate): string {
  if (!slot) return t('bookings.slot.main')
  if (slot.startsWith('day:')) return formatDate(slot.slice(4), t.locale)
  return t(`bookings.slot.${slot as 'depart' | 'arrive' | 'pickup' | 'dropoff' | 'main'}`)
}

/** The currencies a trip's bookings are offered in: the local ones, then the base */
export const tripCurrencies = (trip: Trip): CurrencyCode[] =>
  [...new Set([...trip.localCurrencies, trip.baseCurrency])] as CurrencyCode[]

/** A short list joined the locale's way (「出發和抵達」, "Departure and Arrival") */
export const listText = (items: readonly string[], locale: string): string =>
  new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)

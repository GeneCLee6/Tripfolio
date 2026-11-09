import type { Day, Stop } from '../../../shared/api/types.ts'
import type { Warning } from '../../../shared/itinerary/checks.ts'
import type { LegMode } from '../../../shared/itinerary/types.ts'
import { DEFAULT_DAY_END } from '../../lib/itinerary/checks.ts'
import type { MessageKey } from '../../../shared/i18n/t.ts'
import { formatDuration } from '../../../shared/i18n/format.ts'
import type { BookingState, StopType } from '../../../shared/schema/index.ts'
import { colorIndexOf } from '../../lib/colors.ts'
import type { Translate } from '../../lib/i18n.ts'
import { localTime } from '../../lib/itinerary/time.ts'
import { placeName } from '../../lib/itinerary/places.ts'
import { dayColor, dayColors } from '../../styles/tokens.ts'
import type { Place, Trip } from '../../../shared/api/types.ts'
import { isCurrencyCode, type CurrencyCode } from '../../../shared/money/currencies.ts'

// Message keys and display helpers the itinerary page shares

export const STOP_TYPE_LABEL: Record<StopType, MessageKey> = {
  sight: 'itinerary.stopType.sight',
  food: 'itinerary.stopType.food',
  shopping: 'itinerary.stopType.shopping',
  lodging: 'itinerary.stopType.lodging',
  transport: 'itinerary.stopType.transport',
  fuel: 'itinerary.stopType.fuel',
  supplies: 'itinerary.stopType.supplies',
  rest: 'itinerary.stopType.rest',
  other: 'itinerary.stopType.other',
}

export const BOOKING_LABEL: Record<BookingState, MessageKey> = {
  none: 'itinerary.booking.none',
  todo: 'itinerary.booking.todo',
  booked: 'itinerary.booking.booked',
}

export const LEG_MODE_LABEL: Record<LegMode, MessageKey> = {
  drive: 'itinerary.leg.mode.drive',
  campervan: 'itinerary.leg.mode.campervan',
  walk: 'itinerary.leg.mode.walk',
  cycle: 'itinerary.leg.mode.cycle',
  transit: 'itinerary.leg.mode.transit',
  flight: 'itinerary.leg.mode.flight',
  ferry: 'itinerary.leg.mode.ferry',
  other: 'itinerary.leg.mode.other',
}

/** The day's colour: its own when it is one of the ten, else the palette slot of its number */
export function colorOfDay(day: Pick<Day, 'color' | 'idx'>, position: number): string {
  const index = colorIndexOf(day.color)
  return index >= 0 ? dayColors[index] : dayColor((day.idx ?? position + 1) - 1)
}

/** What a stop is called: its own title, else its place's name, else a placeholder */
export function stopName(stop: Stop, place: Place | undefined, t: Translate): string {
  if (stop.title.trim()) return stop.title
  if (place) return placeName(place, t.locale)
  return t('itinerary.stop.untitled')
}

/** 「09:30–10:30」, 「09:30 · 1 小時」, 「1 小時」, or '' */
export function stopTimeText(stop: Stop, tz: string, t: Translate): string {
  const start = localTime(stop.startAt, tz)
  const end = localTime(stop.endAt, tz)
  if (start && end) return t('itinerary.time.range', { start, end })
  if (start && stop.durationMin !== null) {
    return t('itinerary.time.startDuration', {
      start,
      duration: formatDuration(stop.durationMin, t.locale),
    })
  }
  if (start) return start
  if (stop.durationMin !== null) return formatDuration(stop.durationMin, t.locale)
  return ''
}

/** Currencies offered for a cost: the trip's local ones first, then base and secondary */
export function costCurrencies(trip: Trip, current: string | null): CurrencyCode[] {
  const list = [...trip.localCurrencies, trip.baseCurrency, trip.secondaryCurrency, current]
  return [...new Set(list)].filter((code): code is CurrencyCode => !!code && isCurrencyCode(code))
}

/** A warning as one line of text */
export function warningText(
  warning: Warning,
  names: ReadonlyMap<string, string>,
  t: Translate,
): string {
  const name = (index: number) => names.get(warning.stopIds[index] ?? '') ?? ''
  const data = warning.data ?? {}
  switch (warning.kind) {
    case 'closed-on-arrival':
      return t('itinerary.check.closed', { name: name(0), arrival: String(data.arrival ?? '') })
    case 'booking-overlap':
      return t('itinerary.check.overlap', { a: name(0), b: name(1) })
    case 'after-sunset':
      return data.sunset
        ? t('itinerary.check.sunset', {
            name: name(0),
            start: String(data.start ?? ''),
            sunset: String(data.sunset),
          })
        : t('itinerary.check.polarNight', { name: name(0) })
    case 'no-buffer':
      return t('itinerary.check.noBuffer', {
        finish: String(data.finish ?? ''),
        buffer: Number(data.bufferMinutes ?? 0),
        end: DEFAULT_DAY_END,
      })
  }
}

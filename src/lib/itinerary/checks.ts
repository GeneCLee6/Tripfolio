import type { DayWithStops, Place, Stop, Trip } from '../../../shared/api/types.ts'
import {
  checkDay,
  OUTDOOR_CATEGORIES,
  type CheckContext,
  type Warning,
} from '../../../shared/itinerary/checks.ts'
import type { Leg } from '../../../shared/itinerary/legs.ts'
import type { ItineraryStop, OpeningHours, WeekdayKey } from '../../../shared/itinerary/types.ts'
import type { PlaceHours } from '../../../shared/schema/index.ts'
import { localTime } from './time.ts'

// Time checks of a day (e2-t06, AC-2.4): the page's stops and places turned into the shape
// shared/itinerary/checks.ts wants, then checkDay. Warnings only; nothing is blocked.

/** Where the day should be over when nothing says otherwise (local time) */
export const DEFAULT_DAY_END = '21:00'

/** Place categories that count as outdoor for the after-sunset check (search gives `nature`) */
export const OUTDOOR = [...OUTDOOR_CATEGORIES, 'nature'] as const

const WEEKDAYS: readonly WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * A place's stored hours (periods with day 0 = Sunday) as the checks' weekly table. Null when there
 * are no periods: the closed-on-arrival check is then skipped for that stop. A weekday without any
 * period is closed (shared/itinerary/types.ts OpeningHours).
 */
export function openingHoursOf(hours: PlaceHours | null | undefined): OpeningHours | null {
  const periods = hours?.periods ?? []
  if (periods.length === 0) return null
  const out: OpeningHours = {}
  for (const day of WEEKDAYS) out[day] = []
  for (const period of periods) {
    const key = WEEKDAYS[period.day]
    if (key) out[key]!.push([period.open, period.close])
  }
  return out
}

/** The stops of a day as checkDay wants them: local times, booking, place category and hours */
export function checkStops(
  stops: readonly Stop[],
  places: ReadonlyMap<string, Place>,
  tz: string,
): ItineraryStop[] {
  return stops.map((stop) => {
    const place = stop.placeId ? places.get(stop.placeId) : undefined
    return {
      id: stop.id,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      isBackup: stop.isBackup,
      category: place?.category,
      startTime: localTime(stop.startAt, tz) || null,
      endTime: localTime(stop.endAt, tz) || null,
      durationMin: stop.durationMin,
      booking: stop.booking,
      hours: openingHoursOf(place?.hours),
    }
  })
}

/**
 * The context of one day: its date in the trip's zone, the trip centre for stops without a place,
 * the day's legs, and the end of the day ({@link DEFAULT_DAY_END}; there is no per-day setting yet).
 * Null for a day without a date (nothing to check against).
 */
export function dayCheckContext(
  day: Pick<DayWithStops, 'date'>,
  trip: Pick<Trip, 'tz' | 'centerLat' | 'centerLng'>,
  legs: readonly Leg[],
): CheckContext | null {
  if (!day.date) return null
  return {
    date: day.date,
    tz: trip.tz,
    ...(trip.centerLat !== null && trip.centerLng !== null
      ? { lat: trip.centerLat, lng: trip.centerLng }
      : {}),
    dayEnd: DEFAULT_DAY_END,
    legs,
    outdoorCategories: OUTDOOR,
  }
}

/** All warnings of a day (empty for a day without a date or without stops) */
export function checkItineraryDay(
  day: DayWithStops,
  trip: Pick<Trip, 'tz' | 'centerLat' | 'centerLng'>,
  places: ReadonlyMap<string, Place>,
  legs: readonly Leg[],
): Warning[] {
  const context = dayCheckContext(day, trip, legs)
  if (!context || day.stops.length === 0) return []
  return checkDay(checkStops(day.stops, places, trip.tz), context)
}

/** Stop ids with a warning of their own (the whole-day no-buffer warning does not mark cards) */
export function warnedStops(warnings: readonly Warning[]): Set<string> {
  const out = new Set<string>()
  for (const warning of warnings) {
    if (warning.kind === 'no-buffer') continue
    for (const id of warning.stopIds) out.add(id)
  }
  return out
}

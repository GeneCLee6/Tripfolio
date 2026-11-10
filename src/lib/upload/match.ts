import type { Attachment } from '../../../shared/api/media.ts'
import type { DayWithStops, Place } from '../../../shared/api/types.ts'
import { haversineM } from '../../../shared/itinerary/legs.ts'
import { utcToZoned } from '../../../shared/time/tz.ts'

// Auto-matching photos to the itinerary (e6-t03, AC-6.2). Pure: the photos page loads the days,
// stops and places, asks for a plan, and applies it with PATCH /attachments/:aid.
//
// - GPS and a capture time: the nearest stop within 500 m whose day falls on the photo's local date
//   (in the trip's zone) → { stopId, dayId }.
// - No stop close enough, or no GPS, but a capture time: the day of that date → { dayId }.
// - Neither: left unassigned.

/** How far a photo may be from a stop to be hung on it */
export const MATCH_RADIUS_M = 500

export interface MatchDay {
  id: string
  /** `YYYY-MM-DD` in the trip's zone */
  date: string
}

export interface MatchStop {
  id: string
  dayId: string
  lat: number
  lng: number
}

export interface MatchContext {
  /** Days on the trip (assigned ones only) */
  days: MatchDay[]
  /** Stops with coordinates (from their place) */
  stops: MatchStop[]
  /** The trip's IANA zone */
  tz: string
  /** Every day id the trip has (assigned or not): a photo pointing elsewhere is unfiled */
  knownDayIds?: ReadonlySet<string>
}

export type MatchPhoto = Pick<Attachment, 'takenAt' | 'lat' | 'lng'>

export interface MatchResult {
  dayId: string
  stopId: string | null
}

/** The photo's local date in the trip's zone: UTC values converted, wall-clock values as recorded */
export function localDateOf(takenAt: string | null, tz: string): string | null {
  if (!takenAt) return null
  if (takenAt.endsWith('Z')) {
    const ms = Date.parse(takenAt)
    return Number.isNaN(ms) ? null : utcToZoned(ms, tz).date
  }
  return /^\d{4}-\d{2}-\d{2}/.test(takenAt) ? takenAt.slice(0, 10) : null
}

/** Where a photo belongs, or null when nothing says */
export function matchPhoto(photo: MatchPhoto, ctx: MatchContext): MatchResult | null {
  const date = localDateOf(photo.takenAt, ctx.tz)
  if (!date) return null
  const days = ctx.days.filter((day) => day.date === date)
  if (days.length === 0) return null
  if (photo.lat !== null && photo.lng !== null) {
    const dayIds = new Set(days.map((day) => day.id))
    let best: { stop: MatchStop; distance: number } | null = null
    for (const stop of ctx.stops) {
      if (!dayIds.has(stop.dayId)) continue
      const distance = haversineM({ lat: photo.lat, lng: photo.lng }, stop)
      if (distance <= MATCH_RADIUS_M && (!best || distance < best.distance))
        best = { stop, distance }
    }
    if (best) return { dayId: best.stop.dayId, stopId: best.stop.id }
  }
  return { dayId: days[0]!.id, stopId: null }
}

/** The match context from GET /days and GET /places */
export function buildMatchContext(
  days: readonly DayWithStops[],
  places: readonly Place[],
  tz: string,
): MatchContext {
  const byId = new Map(places.map((place) => [place.id, place]))
  const assigned = days.filter((day) => day.idx !== null && day.date !== null)
  return {
    tz,
    knownDayIds: new Set(days.map((day) => day.id)),
    days: assigned.map((day) => ({ id: day.id, date: day.date! })),
    stops: assigned.flatMap((day) =>
      day.stops.flatMap((stop) => {
        const place = stop.placeId ? byId.get(stop.placeId) : undefined
        return place && Number.isFinite(place.lat) && Number.isFinite(place.lng)
          ? [{ id: stop.id, dayId: day.id, lat: place.lat, lng: place.lng }]
          : []
      }),
    ),
  }
}

export interface MatchPlanItem {
  attachmentId: string
  patch: { dayId: string; stopId: string | null }
}

/** Not on any day: no dayId and no stopId, or a dayId of a day that no longer exists */
export function isUnfiled(
  photo: Pick<Attachment, 'dayId' | 'stopId'>,
  knownDayIds?: ReadonlySet<string>,
): boolean {
  if (photo.dayId === null) return photo.stopId === null
  return knownDayIds !== undefined && !knownDayIds.has(photo.dayId)
}

/**
 * What to PATCH: unfiled photos that a rule places. Photos someone already filed (by hand or
 * earlier) are never moved.
 */
export function planMatches(
  photos: readonly (MatchPhoto & Pick<Attachment, 'id' | 'dayId' | 'stopId'>)[],
  ctx: MatchContext,
): MatchPlanItem[] {
  const plan: MatchPlanItem[] = []
  for (const photo of photos) {
    if (!isUnfiled(photo, ctx.knownDayIds)) continue
    const result = matchPhoto(photo, ctx)
    if (result) plan.push({ attachmentId: photo.id, patch: result })
  }
  return plan
}

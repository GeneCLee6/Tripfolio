import type { DayWithStops, LegOverride, Stop } from '../../../shared/api/types.ts'
import type { ItineraryOp } from '../offline/itinerary.ts'
import { applyMove } from './order.ts'

// Itinerary writes still waiting in the offline queue (e2-t08b), laid over data fetched from the
// server: a reload (or a live refetch) while offline must not make them disappear from the page.
// Pure: the same ops on the same data always give the same days.

export interface PendingView {
  days: DayWithStops[]
  legs: LegOverride[]
}

export interface QueuedOp {
  op: ItineraryOp
  /** The provisional id of a created stop */
  tempId?: string
}

const STAMP = '1970-01-01T00:00:00.000Z'

/** A created stop as the page shows it until the server answers (defaults as the API's) */
export function draftStop(
  tripId: string,
  id: string,
  body: Partial<Stop> & { dayId: string },
): Stop {
  return {
    type: 'sight',
    title: '',
    placeId: null,
    startAt: null,
    endAt: null,
    durationMin: null,
    costMinor: null,
    currency: null,
    booking: 'none',
    note: '',
    links: [],
    isBackup: false,
    wishlistItemId: null,
    bookingId: null,
    ...body,
    id,
    tripId,
    order: Number.MAX_SAFE_INTEGER,
    rev: 0,
    updatedAt: STAMP,
  }
}

const sameLeg = (from: string, to: string) => (leg: LegOverride) =>
  leg.fromStopId === from && leg.toStopId === to

/** One waiting op applied to the view */
export function applyOp<T extends PendingView>(
  view: T,
  tripId: string,
  { op, tempId }: QueuedOp,
): T {
  switch (op.kind) {
    case 'stop.create': {
      if (!tempId) return view
      const { afterStopId, ...body } = op.body as typeof op.body & { afterStopId?: string | null }
      const known = view.days.some((day) => day.stops.some((stop) => stop.id === tempId))
      if (known || !view.days.some((day) => day.id === body.dayId)) return view
      const stop = draftStop(tripId, tempId, body as Partial<Stop> & { dayId: string })
      let days = view.days.map((day) => {
        if (day.id !== body.dayId) return day
        const last = day.stops.reduce((max, s) => Math.max(max, s.order), 0)
        return { ...day, stops: [...day.stops, { ...stop, order: last + 1 }] }
      })
      if (afterStopId !== undefined) {
        days = applyMove(days, tempId, { dayId: body.dayId, afterStopId })
      }
      return { ...view, days }
    }
    case 'stop.patch':
      return {
        ...view,
        days: view.days.map((day) => ({
          ...day,
          stops: day.stops.map((s) => (s.id === op.stopId ? ({ ...s, ...op.body } as Stop) : s)),
        })),
      }
    case 'stop.delete':
      return {
        ...view,
        days: view.days.map((day) => ({
          ...day,
          stops: day.stops.filter((s) => s.id !== op.stopId),
        })),
        legs: view.legs.filter((l) => l.fromStopId !== op.stopId && l.toStopId !== op.stopId),
      }
    case 'stop.move':
      return { ...view, days: applyMove(view.days, op.stopId, op.body) }
    case 'leg.put': {
      const draft: LegOverride = {
        tripId,
        fromStopId: op.fromStopId,
        toStopId: op.toStopId,
        mode: op.body.mode,
        minutes: op.body.minutes ?? null,
        rev: 0,
        updatedAt: STAMP,
      }
      const same = sameLeg(op.fromStopId, op.toStopId)
      return { ...view, legs: [...view.legs.filter((l) => !same(l)), draft] }
    }
    case 'leg.delete': {
      const same = sameLeg(op.fromStopId, op.toStopId)
      return { ...view, legs: view.legs.filter((l) => !same(l)) }
    }
    case 'day.patch':
      return {
        ...view,
        days: view.days.map((day) => (day.id === op.dayId ? { ...day, ...op.body } : day)),
      }
  }
}

/** Every waiting op, oldest first, applied to freshly fetched data */
export function applyPending<T extends PendingView>(
  view: T,
  tripId: string,
  ops: readonly QueuedOp[],
): T {
  return ops.reduce((current, queued) => applyOp(current, tripId, queued), view)
}

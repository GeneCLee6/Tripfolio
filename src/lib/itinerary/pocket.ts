import type { DayWithStops, Place, PocketResponse, Stop } from '../../../shared/api/types.ts'
import type { StopType } from '../../../shared/schema/index.ts'
import { ApiError, request, type StopCreateBody } from '../api.ts'
import { getToken } from '../tokens.ts'
import { stopTypeForCategory } from './places.ts'
import type { SectionTarget } from './dnd.ts'

// The pocket list on the itinerary page (e2-t07, E2 需求「口袋名單」): wishlist items still wished
// for and places no stop uses, from GET /pocket. An entry dropped into a day (or sent there with
// 「排進 Day N」) becomes a stop: an item through POST /wishlist/:wid/schedule, which keeps the link
// both ways; a place through POST /stops. Deleting a stop that came from an item puts the item back
// on the server, so the panel just loads again after itinerary changes.

/** Draggable ids of pocket entries (the itinerary's DndContext tells them from stops by prefix) */
export const POCKET_ITEM_PREFIX = 'pocket:item:'
export const POCKET_PLACE_PREFIX = 'pocket:place:'

export type PocketKind = 'item' | 'place'

export interface PocketSource {
  kind: PocketKind
  id: string
}

export const pocketDragId = ({ kind, id }: PocketSource) =>
  `${kind === 'item' ? POCKET_ITEM_PREFIX : POCKET_PLACE_PREFIX}${id}`

/** The entry a draggable id stands for, or null for a stop */
export function parsePocketDragId(id: string): PocketSource | null {
  if (id.startsWith(POCKET_ITEM_PREFIX))
    return { kind: 'item', id: id.slice(POCKET_ITEM_PREFIX.length) }
  if (id.startsWith(POCKET_PLACE_PREFIX))
    return { kind: 'place', id: id.slice(POCKET_PLACE_PREFIX.length) }
  return null
}

/** The stop type a place gets when it is dropped into a day (from its search category) */
export const stopTypeForPlace = (place: Pick<Place, 'category'>): StopType =>
  stopTypeForCategory(place.category)

/** What a drop asks of the API */
export type PocketRequest =
  | {
      kind: 'schedule'
      itemId: string
      body: { dayId: string; afterStopId: string | null }
      /** Dropped into the backup group: the new stop is flagged afterwards (PATCH) */
      isBackup: boolean
    }
  | { kind: 'createStop'; body: StopCreateBody }

/** The request for dropping `source` at `target` (a place's stop takes its type from the place) */
export function pocketRequest(
  source: PocketSource,
  target: SectionTarget,
  place?: Pick<Place, 'id' | 'category'>,
): PocketRequest {
  if (source.kind === 'item') {
    return {
      kind: 'schedule',
      itemId: source.id,
      body: { dayId: target.dayId, afterStopId: target.afterStopId },
      isBackup: target.backup,
    }
  }
  return {
    kind: 'createStop',
    body: {
      dayId: target.dayId,
      afterStopId: target.afterStopId,
      placeId: source.id,
      type: place ? stopTypeForPlace(place) : 'other',
      isBackup: target.backup,
    },
  }
}

/** The end of a day's main rail (「排進 Day N」 without dragging) */
export function endOfDay(day: Pick<DayWithStops, 'id' | 'stops'>): SectionTarget {
  const main = day.stops.filter((stop) => !stop.isBackup)
  const last = main[main.length - 1] ?? day.stops[day.stops.length - 1]
  return { dayId: day.id, afterStopId: last?.id ?? null, backup: false }
}

const byOrder = (a: Stop, b: Stop) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The days with a stop the server just created (its day re-sorted, renumbered orders applied) */
export function withNewStop<T extends { id: string; stops: Stop[] }>(
  days: readonly T[],
  stop: Stop,
  renumbered: readonly { id: string; order: number }[] = [],
): T[] {
  const orders = new Map(renumbered.map((item) => [item.id, item.order]))
  return days.map((day) => {
    if (day.id !== stop.dayId) return day
    const stops = [...day.stops.filter((s) => s.id !== stop.id), stop]
      .map((s) => {
        const order = orders.get(s.id)
        return order === undefined ? s : { ...s, order }
      })
      .sort(byOrder)
    return { ...day, stops }
  })
}

function tokenFor(tripId: string): string {
  const token = getToken(tripId)
  if (!token) throw new ApiError(401, 'unauthorized', 'no member token on this device')
  return token
}

const tripPath = (tripId: string) => `/api/trips/${encodeURIComponent(tripId)}`

export const pocketApi = {
  /** GET /pocket: items with status wish (by order) and places nothing points at */
  get(tripId: string, signal?: AbortSignal): Promise<PocketResponse> {
    return request('GET', `${tripPath(tripId)}/pocket`, { token: tokenFor(tripId), signal })
  },
}

import type { Stop } from '../../../shared/api/types.ts'

// Where /move should put a stop for the overflow menu's move up / move down / move to another day
// and for drag and drop (e2-t04, dnd.ts). `afterStopId: null` means first in the day.

export interface MoveTarget {
  dayId: string
  afterStopId: string | null
}

export function moveUpTarget(stops: readonly Stop[], stopId: string): MoveTarget | null {
  const index = stops.findIndex((stop) => stop.id === stopId)
  if (index <= 0) return null
  return { dayId: stops[index].dayId, afterStopId: index >= 2 ? stops[index - 2].id : null }
}

export function moveDownTarget(stops: readonly Stop[], stopId: string): MoveTarget | null {
  const index = stops.findIndex((stop) => stop.id === stopId)
  if (index < 0 || index >= stops.length - 1) return null
  return { dayId: stops[index].dayId, afterStopId: stops[index + 1].id }
}

/** The end of another day */
export function moveToDayTarget(dayId: string, dayStops: readonly Stop[]): MoveTarget {
  return { dayId, afterStopId: dayStops.length ? dayStops[dayStops.length - 1].id : null }
}

/** A sort key between two neighbours (as the Worker's planPlacement does without renumbering) */
export function orderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1
  if (prev === null) return (next as number) - 1
  if (next === null) return prev + 1
  return (prev + next) / 2
}

/**
 * The days after a move, for the optimistic update: the stop takes a fractional order between its
 * new neighbours (the server's answer then replaces it, see {@link applyMoveResult}).
 */
export function applyMove<T extends { id: string; stops: Stop[] }>(
  days: readonly T[],
  stopId: string,
  target: MoveTarget,
): T[] {
  let moving: Stop | undefined
  const without = days.map((day) => {
    const found = day.stops.find((stop) => stop.id === stopId)
    if (!found) return day
    moving = found
    return { ...day, stops: day.stops.filter((stop) => stop.id !== stopId) }
  })
  if (!moving) return [...days]
  const source: Stop = moving
  return without.map((day) => {
    if (day.id !== target.dayId) return day
    const stops = [...day.stops]
    const at =
      target.afterStopId === null ? 0 : stops.findIndex((s) => s.id === target.afterStopId) + 1
    const prev = at > 0 ? stops[at - 1].order : null
    const next = at < stops.length ? stops[at].order : null
    stops.splice(at, 0, { ...source, dayId: target.dayId, order: orderBetween(prev, next) })
    return { ...day, stops }
  })
}

const byOrder = (a: Stop, b: Stop) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The days once POST /move has answered: the moved stop as the server has it, the renumbered
 * orders of its new day (when the gap got too small), and every touched day sorted by order.
 */
export function applyMoveResult<T extends { id: string; stops: Stop[] }>(
  days: readonly T[],
  stop: Stop,
  renumbered: readonly { id: string; order: number }[],
): T[] {
  const orders = new Map(renumbered.map((item) => [item.id, item.order]))
  return days.map((day) => {
    const touched = day.id === stop.dayId || day.stops.some((s) => s.id === stop.id)
    if (!touched) return day
    const stops = day.stops.filter((s) => s.id !== stop.id)
    if (day.id === stop.dayId) stops.push(stop)
    const sorted = stops
      .map((s) => {
        const order = orders.get(s.id)
        return order === undefined ? s : { ...s, order }
      })
      .sort(byOrder)
    return { ...day, stops: sorted }
  })
}

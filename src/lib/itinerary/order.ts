import type { Stop } from '../../../shared/api/types.ts'

// Where /move should put a stop for the overflow menu's move up / move down / move to another day
// (the drag and drop of e2-t04 will use the same call). `afterStopId: null` means first in the day.

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

/** The days after a move, for the optimistic update (the server's order comes with the reload) */
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
  const moved: Stop = { ...moving, dayId: target.dayId }
  return without.map((day) => {
    if (day.id !== target.dayId) return day
    const stops = [...day.stops]
    const at =
      target.afterStopId === null ? 0 : stops.findIndex((s) => s.id === target.afterStopId) + 1
    stops.splice(at, 0, moved)
    return { ...day, stops }
  })
}

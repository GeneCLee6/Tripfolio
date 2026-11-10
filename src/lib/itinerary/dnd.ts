import type { Stop } from '../../../shared/api/types.ts'
import { dayIdOfBackupDrop } from './backup.ts'
import type { MoveTarget } from './order.ts'

// Drag and drop of stops (e2-t04): where a drop lands, as the `/move` body. dnd-kit hands over ids;
// these helpers stay pure so they can be tested without a DOM.

/** Droppable id of a whole day (an empty day, or the space under its last stop) */
export const DAY_DROP_PREFIX = 'day:'
export const dayDropId = (dayId: string) => `${DAY_DROP_PREFIX}${dayId}`
export const dayIdOfDrop = (id: string): string | null =>
  id.startsWith(DAY_DROP_PREFIX) ? id.slice(DAY_DROP_PREFIX.length) : null

type DayLike = { id: string; stops: readonly Stop[] }

/** The day that holds a stop */
export function dayOfStop<T extends DayLike>(days: readonly T[], stopId: string): T | undefined {
  return days.find((day) => day.stops.some((stop) => stop.id === stopId))
}

/** The day a droppable id stands for: a day's own drop area, or the day of the stop under it */
export function dayOfDrop<T extends DayLike>(days: readonly T[], overId: string): T | undefined {
  const dayId = dayIdOfDrop(overId)
  return dayId !== null ? days.find((day) => day.id === dayId) : dayOfStop(days, overId)
}

/**
 * The `/move` body for putting `stopId` at `index` of `dayStops` (the day's stops in their final
 * order, with or without the moving stop: it is skipped). `afterStopId` is the new neighbour above,
 * or null for the first place.
 */
export function targetAtIndex(
  dayId: string,
  dayStops: readonly Pick<Stop, 'id'>[],
  stopId: string,
  index: number,
): MoveTarget {
  const others = dayStops.filter((stop) => stop.id !== stopId)
  const at = Math.max(0, Math.min(index, others.length))
  return { dayId, afterStopId: at === 0 ? null : others[at - 1].id }
}

/** The `/move` body once a stop sits where it should in `dayStops` (it must be in the list) */
export function targetFromList(
  dayId: string,
  dayStops: readonly Pick<Stop, 'id'>[],
  stopId: string,
): MoveTarget {
  const index = dayStops.findIndex((stop) => stop.id === stopId)
  return targetAtIndex(dayId, dayStops, stopId, index < 0 ? dayStops.length : index)
}

/** True when the target is where the stop already is (nothing to send) */
export function isSamePlace(days: readonly DayLike[], stopId: string, target: MoveTarget): boolean {
  const day = dayOfStop(days, stopId)
  if (!day || day.id !== target.dayId) return false
  const index = day.stops.findIndex((stop) => stop.id === stopId)
  const above = index > 0 ? day.stops[index - 1].id : null
  return above === target.afterStopId
}

/**
 * The days while dragging: the stop taken out of its day and put into `toDayId` at `index`
 * (counted without the moving stop). Used for the live preview of a cross-day drag.
 */
export function previewMove<T extends DayLike>(
  days: readonly T[],
  stopId: string,
  toDayId: string,
  index: number,
): T[] {
  const from = dayOfStop(days, stopId)
  const moving = from?.stops.find((stop) => stop.id === stopId)
  if (!from || !moving) return [...days]
  return days.map((day) => {
    let stops = day.stops.filter((stop) => stop.id !== stopId)
    if (day.id === toDayId) {
      const at = Math.max(0, Math.min(index, stops.length))
      stops = [...stops.slice(0, at), { ...moving, dayId: toDayId }, ...stops.slice(at)]
    }
    return stops === day.stops ? day : { ...day, stops }
  })
}

// ---- the rainy-day group (e2-t07): a day has two lists, the main rail and the backup group ----

/** True for a container's own drop area (a day's or its backup group's), false for a stop */
export const isContainerDrop = (id: string) =>
  dayIdOfDrop(id) !== null || dayIdOfBackupDrop(id) !== null

/** The day and list a droppable id stands for: a container, or the list of the stop under it */
export function sectionOfDrop<T extends DayLike>(
  days: readonly T[],
  overId: string,
): { day: T; backup: boolean } | undefined {
  const dayId = dayIdOfDrop(overId)
  const backupDayId = dayIdOfBackupDrop(overId)
  const containerId = dayId ?? backupDayId
  if (containerId !== null) {
    const day = days.find((item) => item.id === containerId)
    return day ? { day, backup: backupDayId !== null } : undefined
  }
  const day = dayOfStop(days, overId)
  const stop = day?.stops.find((item) => item.id === overId)
  return day && stop ? { day, backup: stop.isBackup } : undefined
}

/**
 * The days while dragging a stop into another list: taken out of where it is, flagged for the
 * target list and put at `index` of that list (counted without the moving stop). An empty list
 * takes it at the end of the day (the two lists are drawn apart, only their own order counts).
 */
export function previewSectionMove<T extends DayLike>(
  days: readonly T[],
  stopId: string,
  toDayId: string,
  backup: boolean,
  index: number,
): T[] {
  const from = dayOfStop(days, stopId)
  const moving = from?.stops.find((stop) => stop.id === stopId)
  if (!from || !moving) return [...days]
  const moved: Stop = { ...moving, dayId: toDayId, isBackup: backup }
  return days.map((day) => {
    let stops = day.stops.filter((stop) => stop.id !== stopId)
    if (day.id === toDayId) {
      const list = stops.filter((stop) => stop.isBackup === backup)
      const at = Math.max(0, Math.min(index, list.length))
      let position = stops.length
      if (at < list.length) position = stops.indexOf(list[at])
      else if (list.length > 0) position = stops.indexOf(list[list.length - 1]) + 1
      stops = [...stops.slice(0, position), moved, ...stops.slice(position)]
    }
    return stops === day.stops ? day : { ...day, stops }
  })
}

/** Where something dropped on `overId` goes: the day, the list and the new neighbour above */
export interface SectionTarget extends MoveTarget {
  backup: boolean
}

/**
 * The target of a drop from outside the days (a pocket-list entry): on a stop, before or after it
 * in its own list (`below`: the pointer is past the stop's middle); on a container, the end of
 * that list.
 */
export function sectionTarget(
  days: readonly DayLike[],
  overId: string,
  below: boolean,
): SectionTarget | null {
  const section = sectionOfDrop(days, overId)
  if (!section) return null
  const { day, backup } = section
  const list = day.stops.filter((stop) => stop.isBackup === backup)
  if (isContainerDrop(overId)) {
    const last = list[list.length - 1] ?? day.stops[day.stops.length - 1]
    return { dayId: day.id, afterStopId: last?.id ?? null, backup }
  }
  const index = list.findIndex((stop) => stop.id === overId)
  if (below) return { dayId: day.id, afterStopId: overId, backup }
  return { dayId: day.id, afterStopId: index > 0 ? list[index - 1].id : null, backup }
}

/** Like {@link isSamePlace}, with the neighbour above counted in the stop's own list */
export function isSameSectionPlace(
  days: readonly DayLike[],
  stopId: string,
  target: MoveTarget,
): boolean {
  const day = dayOfStop(days, stopId)
  const stop = day?.stops.find((item) => item.id === stopId)
  if (!day || !stop || day.id !== target.dayId) return false
  const list = day.stops.filter((item) => item.isBackup === stop.isBackup)
  const index = list.findIndex((item) => item.id === stopId)
  const above = index > 0 ? list[index - 1].id : null
  return above === target.afterStopId
}

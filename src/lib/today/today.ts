import type { Checklist, ChecklistItem } from '../../../shared/api/prep.ts'
import type { DayWithStops, Stop, Trip } from '../../../shared/api/types.ts'
import { todayIn, tripPhase } from '../trip-groups.ts'

// Pure helpers for the trip home's phase card (e9-t06): which card shows (出發前 before the trip,
// 今日卡 while it runs, nothing after), which day is "today" in the trip's own time zone (RULES.md
// §3: a Taipei phone on a New Zealand trip sees the NZ day), which stops, which to-dos, and the
// weather link. No React, no clock: the caller passes `nowMs`.

export type HomePhase = 'before' | 'today' | 'after'

type PhaseInput = Pick<Trip, 'startDate' | 'endDate' | 'tz' | 'archivedAt'>

/** Archived and finished trips are 'after' (the recap is another task) */
export function homePhase(trip: PhaseInput, nowMs: number): HomePhase {
  const phase = tripPhase(trip, nowMs)
  return phase === 'upcoming' ? 'before' : phase === 'ongoing' ? 'today' : 'after'
}

/** Today's date in the trip's zone, YYYY-MM-DD */
export const tripToday = (trip: Pick<Trip, 'tz'>, nowMs: number): string => todayIn(trip.tz, nowMs)

/** The assigned day dated `today` (unassigned days keep an old date and never count) */
export function dayFor<D extends Pick<DayWithStops, 'date' | 'idx'>>(
  days: readonly D[],
  today: string,
): D | null {
  return days.find((day) => day.idx !== null && day.date === today) ?? null
}

/** The day's stops in order, backups left out; the first `limit` and how many more there are */
export function todayStops(
  stops: readonly Stop[],
  limit = 5,
): { shown: Stop[]; more: number; all: Stop[] } {
  const all = stops.filter((stop) => !stop.isBackup).sort((a, b) => a.order - b.order)
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit), all }
}

export interface TodayTodo {
  item: ChecklistItem
  listTitle: string
  /** Due before today and still open */
  overdue: boolean
}

/**
 * The open checklist items for today: due today (or overdue and still open), assigned to me or to
 * nobody. Items without a due date stay on the checklists page. Overdue first, then list order.
 */
export function todayTodos(
  checklists: readonly Checklist[],
  today: string,
  meId: string,
): TodayTodo[] {
  const out: TodayTodo[] = []
  for (const list of [...checklists].sort((a, b) => a.order - b.order))
    for (const item of [...list.items].sort((a, b) => a.order - b.order)) {
      if (item.done || !item.dueAt || item.dueAt > today) continue
      if (item.assigneeMemberId !== null && item.assigneeMemberId !== meId) continue
      out.push({ item, listTitle: list.title, overdue: item.dueAt < today })
    }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue))
}

/** Done / total over the pre-trip lists (packing lists are not counted) */
export function pretripProgress(checklists: readonly Checklist[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const list of checklists) {
    if (list.kind !== 'pretrip') continue
    for (const item of list.items) {
      total += 1
      if (item.done) done += 1
    }
  }
  return { done, total }
}

export interface Point {
  lat: number
  lng: number
}

const valid = (
  p: { lat?: number | null; lng?: number | null } | null | undefined,
): p is Point =>
  !!p &&
  typeof p.lat === 'number' &&
  typeof p.lng === 'number' &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180

/** Where to look up the weather: today's first stop with coordinates, else the trip's centre */
export function weatherPoint(
  trip: Pick<Trip, 'centerLat' | 'centerLng'>,
  firstStop: { lat?: number | null; lng?: number | null } | null,
): Point | null {
  if (valid(firstStop)) return { lat: firstStop.lat, lng: firstStop.lng }
  const centre = { lat: trip.centerLat, lng: trip.centerLng }
  return valid(centre) ? centre : null
}

/** An external weather map centred on the point (no weather API: E9 非目標) */
export const weatherUrl = (point: Point): string =>
  `https://www.windy.com/?${point.lat.toFixed(3)},${point.lng.toFixed(3)},10`

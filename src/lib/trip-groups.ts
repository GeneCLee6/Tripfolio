import type { Trip } from '../../shared/api/types.ts'
import { utcToZoned } from '../../shared/time/tz.ts'

// Which shelf of the trip list a trip sits on (E1 設計方向: 即將出發／進行中／過去), and the
// countdown on its card. "Today" is the date in the trip's own time zone, not the browser's
// (RULES.md §3): a Taipei phone looking at a New Zealand trip counts NZ days.

export type TripPhase = 'upcoming' | 'ongoing' | 'past'
export const TRIP_PHASES: readonly TripPhase[] = ['upcoming', 'ongoing', 'past']

const DAY_MS = 86_400_000

function dateMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Whole calendar days from `from` to `to` (YYYY-MM-DD; positive when `to` is later) */
export const daysBetween = (from: string, to: string): number =>
  Math.round((dateMs(to) - dateMs(from)) / DAY_MS)

/** Number of days a trip covers, both ends included */
export const tripLength = (trip: Pick<Trip, 'startDate' | 'endDate'>): number =>
  daysBetween(trip.startDate, trip.endDate) + 1

/** Today's date (YYYY-MM-DD) in `tz`; falls back to UTC for a zone the platform does not know */
export function todayIn(tz: string, nowMs: number): string {
  try {
    return utcToZoned(nowMs, tz).date
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10)
  }
}

type PhaseInput = Pick<Trip, 'startDate' | 'endDate' | 'tz' | 'archivedAt'>

/** Archived trips are always past (E1 生命週期) */
export function tripPhase(trip: PhaseInput, nowMs: number): TripPhase {
  if (trip.archivedAt) return 'past'
  const today = todayIn(trip.tz, nowMs)
  if (today < trip.startDate) return 'upcoming'
  if (today > trip.endDate) return 'past'
  return 'ongoing'
}

export type Countdown =
  | { kind: 'upcoming'; days: number }
  | { kind: 'ongoing'; day: number; of: number }
  | { kind: 'past' }
  | { kind: 'archived' }

/** The card's countdown: days to go, which day of the trip it is, or over */
export function countdown(trip: PhaseInput, nowMs: number): Countdown {
  if (trip.archivedAt) return { kind: 'archived' }
  const today = todayIn(trip.tz, nowMs)
  const phase = tripPhase(trip, nowMs)
  if (phase === 'upcoming') return { kind: 'upcoming', days: daysBetween(today, trip.startDate) }
  if (phase === 'ongoing')
    return { kind: 'ongoing', day: daysBetween(trip.startDate, today) + 1, of: tripLength(trip) }
  return { kind: 'past' }
}

/**
 * The list's three groups: upcoming soonest first, ongoing by start, past most recent first.
 * Works on anything carrying a trip (the list response's entries).
 */
export function groupTrips<T>(
  items: readonly T[],
  tripOf: (item: T) => PhaseInput & Pick<Trip, 'id'>,
  nowMs: number,
): Record<TripPhase, T[]> {
  const groups: Record<TripPhase, T[]> = { upcoming: [], ongoing: [], past: [] }
  for (const item of items) groups[tripPhase(tripOf(item), nowMs)].push(item)
  const by = (key: 'startDate' | 'endDate', dir: 1 | -1) => (a: T, b: T) => {
    const [x, y] = [tripOf(a), tripOf(b)]
    return x[key] === y[key] ? x.id.localeCompare(y.id) : x[key] < y[key] ? -dir : dir
  }
  groups.upcoming.sort(by('startDate', 1))
  groups.ongoing.sort(by('startDate', 1))
  groups.past.sort(by('endDate', -1))
  return groups
}

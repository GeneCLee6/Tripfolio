import type { PlaceHours } from '../../../shared/schema/index.ts'

// Opening hours as the editor holds them (e3-t05): seven weekday rows of `HH:mm–HH:mm` ranges and a
// free-text note, turned back into the stored PlaceHours (periods with day 0 = Sunday, the shape
// src/lib/itinerary/checks.ts reads for the 「打烊」 warning). A weekday without ranges is closed as
// soon as any weekday has one; with no ranges at all the hours are unknown and nothing is checked.

export interface HoursRange {
  open: string
  close: string
}

export interface HoursDraft {
  /** Index 0 = Sunday … 6 = Saturday, as PlaceHours periods */
  days: HoursRange[][]
  text: string
}

/** The editor's row order: Monday first */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** The API's limit on periods (shared/schema/place.ts) */
export const MAX_PERIODS = 50

/** What a new range starts as */
export const DEFAULT_RANGE: HoursRange = { open: '09:00', close: '17:00' }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function emptyDraft(): HoursDraft {
  return { days: Array.from({ length: 7 }, () => []), text: '' }
}

/** The draft of stored hours (periods in their stored order within each weekday) */
export function draftFromHours(hours: PlaceHours | null | undefined): HoursDraft {
  const draft = emptyDraft()
  draft.text = hours?.text ?? ''
  for (const period of hours?.periods ?? []) {
    draft.days[period.day]?.push({ open: period.open, close: period.close })
  }
  return draft
}

export type HoursProblem = 'format' | 'same' | 'tooMany'

export interface HoursIssue {
  /** Weekday (0 = Sunday); -1 for the whole table */
  day: number
  /** Range within the weekday; -1 for the whole table */
  index: number
  problem: HoursProblem
}

/**
 * The stored hours of a draft, and what is wrong with it (the hours are only valid with no
 * issues). Null when there are neither ranges nor a note. A range that closes earlier than it
 * opens runs past midnight; one that opens and closes at the same minute is an error.
 */
export function hoursFromDraft(draft: HoursDraft): {
  hours: PlaceHours | null
  issues: HoursIssue[]
} {
  const issues: HoursIssue[] = []
  const periods: NonNullable<PlaceHours['periods']> = []
  draft.days.forEach((ranges, day) => {
    ranges.forEach((range, index) => {
      if (!HHMM.test(range.open) || !HHMM.test(range.close)) {
        issues.push({ day, index, problem: 'format' })
      } else if (range.open === range.close) {
        issues.push({ day, index, problem: 'same' })
      }
      periods.push({ day, open: range.open, close: range.close })
    })
  })
  if (periods.length > MAX_PERIODS) issues.push({ day: -1, index: -1, problem: 'tooMany' })
  const text = draft.text.trim()
  if (periods.length === 0 && !text) return { hours: null, issues }
  const hours: PlaceHours = {}
  if (text) hours.text = text
  if (periods.length > 0) hours.periods = periods
  return { hours, issues }
}

/** Whether a weekday is closed (some weekday has ranges and this one has none) */
export function isClosedDay(draft: HoursDraft, day: number): boolean {
  return (draft.days[day]?.length ?? 0) === 0 && draft.days.some((ranges) => ranges.length > 0)
}

/** A copy of the draft with one weekday's ranges replaced */
export function withDay(draft: HoursDraft, day: number, ranges: HoursRange[]): HoursDraft {
  return { ...draft, days: draft.days.map((current, i) => (i === day ? ranges : current)) }
}

/** The weekday's short name in the UI language (2024-01-07 was a Sunday) */
export function weekdayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 7 + day)),
  )
}

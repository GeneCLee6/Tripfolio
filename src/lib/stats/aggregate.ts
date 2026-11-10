import type { SummaryRow } from '../../../shared/api/expenses.ts'
import type { Member } from '../../../shared/api/types.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import { paletteIndex } from '../colors.ts'

// The statistics page as plain data (e7-t06): the server's summary rows (GET /expenses/summary)
// turned into what the charts draw. Pure functions, tested without a DOM. Money stays in integer
// minor units of the trip's base currency; only the percentages are rounded.

/** The longest run of days the day chart fills in (a stray date far away must not draw 10 000 bars) */
export const MAX_DAYS = 400

/** The list page's quick ranges, reused here */
export type Range = 'all' | 'today' | 'trip' | 'custom'

export interface Bounds {
  from: string | null
  to: string | null
}

/** The from / to dates (inclusive) of a quick range; null means open */
export function rangeBounds(
  range: Range,
  custom: { from: string; to: string },
  trip: { startDate: string; endDate: string },
  today: string,
): Bounds {
  if (range === 'today') return { from: today, to: today }
  if (range === 'trip') return { from: trip.startDate, to: trip.endDate }
  if (range === 'custom') return { from: custom.from || null, to: custom.to || null }
  return { from: null, to: null }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

const toUtc = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Whole days from `a` to `b` (YYYY-MM-DD; negative when b is earlier) */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}

/** Every date from `from` to `to` inclusive (empty when to < from; at most MAX_DAYS) */
export function eachDate(from: string, to: string): string[] {
  if (!DATE.test(from) || !DATE.test(to)) return []
  const out: string[] = []
  for (let ms = toUtc(from), end = toUtc(to); ms <= end && out.length < MAX_DAYS; ms += 86_400_000)
    out.push(fromUtc(ms))
  return out
}

export interface DayPoint {
  date: string
  baseMinor: number
  count: number
  /** 0-based day of the trip (for the day colour), or null outside the trip */
  dayIndex: number | null
}

/**
 * The day rows with the gaps filled by zero days. The span is the range's ends; an open end takes
 * the trip's end or the furthest row, whichever reaches further.
 */
export function fillDays(
  rows: readonly SummaryRow[],
  bounds: Bounds,
  trip: { startDate: string; endDate: string },
): DayPoint[] {
  const dates = rows.map((row) => row.key).filter((key) => DATE.test(key)).sort()
  const from = bounds.from ?? [trip.startDate, dates[0]].filter(Boolean).sort()[0]
  const to = bounds.to ?? [trip.endDate, dates[dates.length - 1]].filter(Boolean).sort().pop()!
  const byDate = new Map(rows.map((row) => [row.key, row]))
  const tripDays = daysBetween(trip.startDate, trip.endDate)
  return eachDate(from, to).map((date) => {
    const row = byDate.get(date)
    const index = daysBetween(trip.startDate, date)
    return {
      date,
      baseMinor: row?.baseMinor ?? 0,
      count: row?.count ?? 0,
      dayIndex: index >= 0 && index <= tripDays ? index : null,
    }
  })
}

/**
 * Whole percentages of `values` that add up to exactly 100 (largest remainder); all zeros when the
 * total is not positive. Negative values count as zero.
 */
export function percentages(values: readonly number[]): number[] {
  const clean = values.map((value) => (value > 0 ? value : 0))
  const total = clean.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return clean.map(() => 0)
  const exact = clean.map((value) => (value * 100) / total)
  const out = exact.map(Math.floor)
  let left = 100 - out.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
  for (const { index } of order) {
    if (left <= 0) break
    out[index] += 1
    left -= 1
  }
  return out
}

export interface CategoryBar {
  category: ExpenseCategory
  baseMinor: number
  count: number
  percent: number
}

/** Categories, largest first, with whole percentages adding up to 100 */
export function categoryBars(rows: readonly SummaryRow[]): CategoryBar[] {
  const sorted = [...rows]
    .filter((row) => row.baseMinor !== 0 || row.count > 0)
    .sort((a, b) => b.baseMinor - a.baseMinor || a.key.localeCompare(b.key))
  const percents = percentages(sorted.map((row) => row.baseMinor))
  return sorted.map((row, index) => ({
    category: row.key as ExpenseCategory,
    baseMinor: row.baseMinor,
    count: row.count,
    percent: percents[index],
  }))
}

export interface MemberStat {
  memberId: string
  /** null: no longer a member (show a generic label) */
  name: string | null
  colorIndex: number
  /** Paid personally (base) */
  paidMinor: number
  /** Their shares (base) */
  shareMinor: number
  /** paid − share: positive means the others owe them for expenses (pool and settlements aside) */
  diffMinor: number
  /** Their part of all shares, whole percent (the column adds up to 100) */
  sharePercent: number
}

/** The member rows in member order (removed members after), with paid vs share */
export function memberStats(
  rows: readonly SummaryRow[],
  members: readonly Pick<Member, 'id' | 'name' | 'color'>[],
): MemberStat[] {
  const order = new Map(members.map((member, index) => [member.id, index]))
  const sorted = [...rows].sort(
    (a, b) => (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity),
  )
  const percents = percentages(sorted.map((row) => row.shareMinor ?? 0))
  return sorted.map((row, index) => {
    const member = members.find((m) => m.id === row.key)
    const paidMinor = row.paidMinor ?? 0
    const shareMinor = row.shareMinor ?? 0
    return {
      memberId: row.key,
      name: member?.name ?? null,
      colorIndex: paletteIndex(member?.color, row.key),
      paidMinor,
      shareMinor,
      diffMinor: paidMinor - shareMinor,
      sharePercent: percents[index],
    }
  })
}

/**
 * How many days the 每日平均 divides by: the days of the range up to today; the whole range when
 * all of it is still ahead; never less than one.
 */
export function averageDays(days: readonly Pick<DayPoint, 'date'>[], today: string): number {
  const past = days.filter((day) => day.date <= today).length
  return Math.max(1, past || days.length)
}

export interface Kpis {
  totalMinor: number
  perPersonMinor: number
  perDayMinor: number
}

/** 總花費、每人平均、每日平均 (averages rounded to the nearest minor unit) */
export function kpis(totalMinor: number, people: number, days: number): Kpis {
  return {
    totalMinor,
    perPersonMinor: Math.round(totalMinor / Math.max(1, people)),
    perDayMinor: Math.round(totalMinor / Math.max(1, days)),
  }
}

/** The largest value of a chart, at least 1 so a chart of zeros still has a scale */
export const chartMax = (values: readonly number[]): number => Math.max(1, ...values)

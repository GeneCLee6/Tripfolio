// Day rows follow the trip's dates (E2 需求 日程骨架). Days keep their sequence: when the dates
// change, Day k (by current idx) takes the k-th new date, so shifting a trip moves its plan along.
// If the range shrinks, the extra days become unassigned (idx NULL; date and stops kept); if it
// grows, unassigned days are re-attached first (in their order) before new rows are created.

export interface DaySlot {
  id: string
  date: string | null
  idx: number | null
}

export interface DayPlan {
  /** Existing days that get a (new) date and idx */
  assign: { id: string; date: string; idx: number }[]
  /** Existing days that become unassigned */
  unassign: string[]
  /** New days to create */
  create: { date: string; idx: number }[]
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Number of calendar days from start to end, inclusive */
export function dayCount(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

export function datesInRange(startDate: string, endDate: string): string[] {
  const n = dayCount(startDate, endDate)
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(startDate, i))
}

/** `existing` in any order; unassigned days keep the order they are given in */
export function planDays(existing: DaySlot[], startDate: string, endDate: string): DayPlan {
  const assigned = existing
    .filter((d) => d.idx !== null)
    .sort((a, b) => (a.idx as number) - (b.idx as number))
  const unassigned = existing.filter((d) => d.idx === null)
  const pool = [...assigned, ...unassigned]
  const dates = datesInRange(startDate, endDate)
  const plan: DayPlan = { assign: [], unassign: [], create: [] }
  dates.forEach((date, i) => {
    const day = pool[i]
    if (!day) plan.create.push({ date, idx: i + 1 })
    else if (day.date !== date || day.idx !== i + 1)
      plan.assign.push({ id: day.id, date, idx: i + 1 })
  })
  for (const day of pool.slice(dates.length)) if (day.idx !== null) plan.unassign.push(day.id)
  return plan
}

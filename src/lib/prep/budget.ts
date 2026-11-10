import { useEffect } from 'react'
import type { BudgetProgressResponse, BudgetRow, BurnPoint } from '../../../shared/api/prep.ts'
import type { BudgetCategory } from '../../../shared/schema/prep.ts'
import { BUDGET_CATEGORIES } from './constants.ts'
import { onExpensesChanged } from '../expenses/api.ts'
import { useResource, type Resource } from '../hooks.ts'
import { budgetApi } from './api.ts'

// Budget helpers (e9-t01): the editable table's totals (same rules as worker/trips/budget.ts), the
// burn-down chart's points, and useBudgetProgress for any page that wants planned vs actual
// (the stats page's budget card can adopt it).

/** One editable row per category; null planned = not budgeted */
export interface BudgetDraftRow {
  category: BudgetCategory
  plannedMinor: number | null
  perPerson: boolean
}

export function draftFrom(rows: readonly BudgetRow[]): BudgetDraftRow[] {
  const by = new Map(rows.map((r) => [r.category, r]))
  return BUDGET_CATEGORIES.map((category) => ({
    category,
    plannedMinor: by.get(category)?.plannedMinor ?? null,
    perPerson: by.get(category)?.perPerson ?? false,
  }))
}

/** The rows PUT /budget takes: only categories with an amount */
export const rowsFromDraft = (draft: readonly BudgetDraftRow[]): BudgetRow[] =>
  draft
    .filter((r) => r.plannedMinor !== null)
    .map((r) => ({ category: r.category, plannedMinor: r.plannedMinor ?? 0, perPerson: r.perPerson }))

export const draftGroupMinor = (row: BudgetDraftRow, members: number): number =>
  row.plannedMinor === null ? 0 : row.perPerson ? row.plannedMinor * members : row.plannedMinor

export const draftPersonMinor = (row: BudgetDraftRow, members: number): number =>
  row.plannedMinor === null
    ? 0
    : row.perPerson
      ? row.plannedMinor
      : Math.round(row.plannedMinor / Math.max(1, members))

export function draftTotals(draft: readonly BudgetDraftRow[], members: number) {
  return {
    plannedMinor: draft.reduce((sum, r) => sum + draftGroupMinor(r, members), 0),
    perPersonMinor: draft.reduce((sum, r) => sum + draftPersonMinor(r, members), 0),
  }
}

export const sameRows = (a: readonly BudgetRow[], b: readonly BudgetRow[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * SVG polyline points for the burn-down: x across the days, y from the highest value (top) to the
 * lowest (bottom, at most 0). Days after `today` are left out of the actual line.
 */
export function burnPaths(
  burn: readonly BurnPoint[],
  today: string,
  width: number,
  height: number,
): { actual: string; ideal: string; zeroY: number; max: number; min: number } {
  const past = burn.filter((p) => p.date <= today)
  const values = [
    ...burn.map((p) => p.idealRemainingMinor),
    ...past.map((p) => p.remainingMinor),
    0,
  ]
  const max = Math.max(...values, 1)
  const min = Math.min(...values)
  const span = max - min || 1
  const x = (i: number) => (burn.length <= 1 ? width / 2 : (i / (burn.length - 1)) * width)
  const y = (v: number) => ((max - v) / span) * height
  const line = (points: { i: number; v: number }[]) =>
    points.map(({ i, v }) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return {
    ideal: line(burn.map((p, i) => ({ i, v: p.idealRemainingMinor }))),
    actual: line(past.map((p) => ({ i: burn.indexOf(p), v: p.remainingMinor }))),
    zeroY: y(0),
    max,
    min,
  }
}

/** Planned vs actual for a trip; reloads when an expense changes on this device */
export function useBudgetProgress(
  tripId: string,
): Resource<BudgetProgressResponse> & { reload: () => void } {
  const resource = useResource(`budget-progress:${tripId}`, (signal) =>
    budgetApi.progress(tripId, signal),
  )
  const { reload } = resource
  useEffect(
    () =>
      onExpensesChanged((changed) => {
        if (changed === tripId) reload()
      }),
    [tripId, reload],
  )
  return resource
}

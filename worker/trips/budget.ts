// Budget (e9-t01): the category table (planned amounts in the trip's base currency, each row for
// the group or per person), progress against actual spending (the same sums as
// GET /expenses/summary?by=category and ?by=day) and the burn-down by day. The per-person estimate
// is what the share page's cost estimate should show (getBudgetPerPerson, wired by worker/share.ts).

import type {
  BudgetCategoryProgress,
  BudgetProgressResponse,
  BudgetResponse,
  BudgetRow,
  BudgetTotals,
  BurnPoint,
} from '../../shared/api/prep.ts'
import {
  budgetCategories,
  budgetPutSchema,
  budgetTrackedCategories,
  type BudgetCategory,
} from '../../shared/schema/prep.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, writeWithRev, type Row } from '../db.ts'
import { json, nowIso, readBody } from '../http.ts'
import { notifyTrip } from '../sync.ts'
import type { RouteContext } from '../router.ts'

const order = (c: string) => budgetCategories.indexOf(c as BudgetCategory)

async function loadRows(db: D1Database, tripId: string): Promise<BudgetRow[]> {
  const { results } = await db
    .prepare('SELECT category, plannedMinor, perPerson FROM budgets WHERE tripId = ?')
    .bind(tripId)
    .all<Row>()
  return results
    .map((r) => ({
      category: String(r.category) as BudgetCategory,
      plannedMinor: Number(r.plannedMinor),
      perPerson: Number(r.perPerson) === 1,
    }))
    .sort((a, b) => order(a.category) - order(b.category))
}

async function memberCount(db: D1Database, tripId: string): Promise<number> {
  const n = await db
    .prepare('SELECT COUNT(*) AS n FROM members WHERE tripId = ? AND removedAt IS NULL')
    .bind(tripId)
    .first<number>('n')
  return Math.max(1, Number(n ?? 1))
}

/** A row's amount for the whole group */
export const groupMinor = (row: BudgetRow, members: number): number =>
  row.perPerson ? row.plannedMinor * members : row.plannedMinor

/** A row's amount for one member (group rows divided evenly, rounded to the minor unit) */
export const personMinor = (row: BudgetRow, members: number): number =>
  row.perPerson ? row.plannedMinor : Math.round(row.plannedMinor / Math.max(1, members))

export function budgetTotals(rows: readonly BudgetRow[], members: number): BudgetTotals {
  return {
    plannedMinor: rows.reduce((sum, r) => sum + groupMinor(r, members), 0),
    perPersonMinor: rows.reduce((sum, r) => sum + personMinor(r, members), 0),
  }
}

/**
 * The trip's per-person budget in its base currency, or null when no budget is set. For the share
 * page estimate (e8-t01b: `estimate.perPersonMinor` should prefer this over summed stop costs).
 */
export async function getBudgetPerPerson(
  db: D1Database,
  tripId: string,
): Promise<{ currency: string; perPersonMinor: number; totalMinor: number } | null> {
  const rows = await loadRows(db, tripId)
  if (rows.length === 0) return null
  const trip = await db
    .prepare('SELECT baseCurrency FROM trips WHERE id = ?')
    .bind(tripId)
    .first<string>('baseCurrency')
  const totals = budgetTotals(rows, await memberCount(db, tripId))
  return {
    currency: String(trip),
    perPersonMinor: totals.perPersonMinor,
    totalMinor: totals.plannedMinor,
  }
}

/** Every date from `start` to `end` inclusive (YYYY-MM-DD) */
function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  let ms = Date.parse(`${start}T00:00:00Z`)
  const last = Date.parse(`${end}T00:00:00Z`)
  while (ms <= last && out.length < 400) {
    out.push(new Date(ms).toISOString().slice(0, 10))
    ms += 86_400_000
  }
  return out
}

export interface ProgressInput {
  rows: readonly BudgetRow[]
  members: number
  /** Spent per expense category, base currency */
  actualByCategory: ReadonlyMap<string, number>
  /** Spent per date, base currency */
  actualByDate: ReadonlyMap<string, number>
  startDate: string
  endDate: string
}

/** Planned vs actual per category, the totals, and the burn-down series (pure) */
export function computeProgress(
  input: ProgressInput,
): Pick<BudgetProgressResponse, 'hasBudget' | 'categories' | 'totals' | 'burn'> {
  const { rows, members } = input
  const byCategory = new Map(rows.map((r) => [r.category, r]))
  const tracked = new Set<string>(budgetTrackedCategories)
  const categories: BudgetCategoryProgress[] = budgetCategories
    .filter((category) => byCategory.has(category) || (input.actualByCategory.get(category) ?? 0))
    .map((category) => {
      const row = byCategory.get(category)
      const plannedMinor = row ? groupMinor(row, members) : 0
      const actualMinor = tracked.has(category) ? (input.actualByCategory.get(category) ?? 0) : null
      return {
        category,
        plannedMinor,
        actualMinor,
        remainingMinor: actualMinor === null ? null : plannedMinor - actualMinor,
      }
    })
  const totals = budgetTotals(rows, members)
  const trackedPlannedMinor = rows
    .filter((r) => tracked.has(r.category))
    .reduce((sum, r) => sum + groupMinor(r, members), 0)
  const actualMinor = [...input.actualByCategory.values()].reduce((sum, v) => sum + v, 0)

  const dates = datesBetween(input.startDate, input.endDate)
  let cumulative = 0
  for (const [date, minor] of input.actualByDate) if (date < input.startDate) cumulative += minor
  const burn: BurnPoint[] = dates.map((date, i) => {
    const spentMinor = input.actualByDate.get(date) ?? 0
    cumulative += spentMinor
    if (i === dates.length - 1)
      for (const [later, minor] of input.actualByDate) if (later > date) cumulative += minor
    return {
      date,
      spentMinor,
      cumulativeMinor: cumulative,
      remainingMinor: trackedPlannedMinor - cumulative,
      idealRemainingMinor: Math.round(
        (trackedPlannedMinor * (dates.length - i - 1)) / dates.length,
      ),
    }
  })

  return {
    hasBudget: rows.length > 0,
    categories,
    totals: {
      plannedMinor: totals.plannedMinor,
      trackedPlannedMinor,
      actualMinor,
      remainingMinor: trackedPlannedMinor - actualMinor,
      plannedPerPersonMinor: totals.perPersonMinor,
      actualPerPersonMinor: Math.round(actualMinor / Math.max(1, members)),
    },
    burn,
  }
}

/** GET /api/trips/:id/budget (viewer) */
export async function getBudget(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const [rows, members] = await Promise.all([
    loadRows(c.env.DB, auth.trip.id),
    memberCount(c.env.DB, auth.trip.id),
  ])
  const body: BudgetResponse = {
    currency: auth.trip.baseCurrency,
    memberCount: members,
    rows,
    totals: budgetTotals(rows, members),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** PUT /api/trips/:id/budget { rows } (editor): replaces the whole table */
export async function putBudget(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { rows } = await readBody(c.request, budgetPutSchema)
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('DELETE FROM budgets WHERE tripId = ?').bind(auth.trip.id),
    ...rows.map((row) =>
      insertStatement(db, 'budgets', {
        tripId: auth.trip.id,
        category: row.category,
        plannedMinor: row.plannedMinor,
        currency: auth.trip.baseCurrency,
        perPerson: row.perPerson,
        updatedAt: now,
      }),
    ),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'budget', id: '*', action: 'upsert', by: auth.member.id })
  const [saved, members] = await Promise.all([
    loadRows(db, auth.trip.id),
    memberCount(db, auth.trip.id),
  ])
  const body: BudgetResponse = {
    currency: auth.trip.baseCurrency,
    memberCount: members,
    rows: saved,
    totals: budgetTotals(saved, members),
    rev,
  }
  return json(body)
}

/**
 * GET /api/trips/:id/budget/progress (viewer): planned vs actual per category, per person, and the
 * burn-down by day. Actual sums are those of GET /expenses/summary (base currency, not deleted).
 */
export async function budgetProgress(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const tripId = auth.trip.id
  const [rows, members, byCategory, byDate, shares] = await Promise.all([
    loadRows(db, tripId),
    memberCount(db, tripId),
    db
      .prepare(
        `SELECT category AS k, SUM(baseMinor) AS total FROM expenses
          WHERE tripId = ? AND deletedAt IS NULL GROUP BY category`,
      )
      .bind(tripId)
      .all<Row>(),
    db
      .prepare(
        `SELECT date AS k, SUM(baseMinor) AS total FROM expenses
          WHERE tripId = ? AND deletedAt IS NULL GROUP BY date`,
      )
      .bind(tripId)
      .all<Row>(),
    db
      .prepare(
        `SELECT s.memberId AS k, SUM(s.shareMinor) AS total
           FROM expenseShares s JOIN expenses e ON e.id = s.expenseId
           JOIN members m ON m.id = s.memberId AND m.removedAt IS NULL
          WHERE e.tripId = ? AND e.deletedAt IS NULL GROUP BY s.memberId`,
      )
      .bind(tripId)
      .all<Row>(),
  ])
  const toMap = (list: Row[]) => new Map(list.map((r) => [String(r.k), Number(r.total)]))
  const progress = computeProgress({
    rows,
    members,
    actualByCategory: toMap(byCategory.results),
    actualByDate: toMap(byDate.results),
    startDate: auth.trip.startDate,
    endDate: auth.trip.endDate,
  })
  const body: BudgetProgressResponse = {
    currency: auth.trip.baseCurrency,
    memberCount: members,
    ...progress,
    members: shares.results.map((r) => ({ memberId: String(r.k), shareMinor: Number(r.total) })),
    rev: auth.trip.rev,
  }
  return json(body)
}

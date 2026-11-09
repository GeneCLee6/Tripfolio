// Balances and settlements (e7-t01 / e7-t05). Balances are shared/money `computeBalances` over the
// trip's non-deleted expenses, pool contributions and settlements, in base currency; the suggestion
// is `suggestSettlements` (greedy, fewest transfers). A settlement is a recorded transfer between
// two members (partial amounts allowed); deleting one is a soft delete with a history row.
// Removed members stay in the balances while anything of theirs is non-zero.

import type {
  BalanceRow,
  BalancesResponse,
  Settlement,
  SettlementsResponse,
} from '../../shared/api/expenses.ts'
import { computeBalances, poolBalance, suggestSettlements } from '../../shared/money/index.ts'
import { settlementCreateSchema } from '../../shared/schema/expense.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, writeWithRev, type Row } from '../db.ts'
import { json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import {
  checkMember,
  diffOf,
  historyStatement,
  loadExpenseViews,
  loadMoneyTrip,
  loadTripMembers,
  todayIn,
} from './expenses.ts'
import { loadContributions } from './pool.ts'

function toSettlement(r: Row): Settlement {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    fromMemberId: String(r.fromMemberId),
    toMemberId: String(r.toMemberId),
    amountMinor: Number(r.amountMinor),
    method: String(r.method) as Settlement['method'],
    note: String(r.note ?? ''),
    date: String(r.date),
    createdByMemberId: String(r.createdByMemberId),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    deletedAt: r.deletedAt === null || r.deletedAt === undefined ? null : String(r.deletedAt),
  }
}

async function loadSettlements(db: D1Database, tripId: string): Promise<Settlement[]> {
  const { results } = await db
    .prepare(
      'SELECT * FROM settlements WHERE tripId = ? AND deletedAt IS NULL ORDER BY date, createdAt, id',
    )
    .bind(tripId)
    .all<Row>()
  return results.map(toSettlement)
}

function stateOf(s: Settlement) {
  const { fromMemberId, toMemberId, amountMinor, method, note, date, deletedAt } = s
  return { fromMemberId, toMemberId, amountMinor, method, note, date, deletedAt }
}

/** GET /api/trips/:id/balances (viewer) */
export async function getBalances(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const trip = await loadMoneyTrip(db, auth)
  const [members, expenses, contributions, settlements] = await Promise.all([
    loadTripMembers(db, trip.id),
    loadExpenseViews(db, trip.id),
    loadContributions(db, trip.id),
    loadSettlements(db, trip.id),
  ])
  const input = {
    members: members.map((m) => ({ id: m.id })),
    expenses: expenses.map((e) => ({
      payerId: e.pool ? 'pool' : (e.payerMemberId as string),
      baseMinor: e.baseMinor,
      shares: e.shares.map((s) => ({ memberId: s.memberId, shareMinor: s.shareMinor })),
    })),
    poolContributions: contributions.map((p) => ({ memberId: p.memberId, baseMinor: p.baseMinor })),
    settlements: settlements.map((s) => ({
      from: s.fromMemberId,
      to: s.toMemberId,
      amountMinor: s.amountMinor,
    })),
    poolRefund: trip.poolRefundMode,
  }
  const computed = computeBalances(input)
  const removed = new Set(members.filter((m) => m.removed).map((m) => m.id))
  const balances: BalanceRow[] = computed
    .map((b) => ({ ...b, removed: removed.has(b.memberId) }))
    .filter(
      (b) =>
        !b.removed ||
        [
          b.paidMinor,
          b.owedMinor,
          b.poolInMinor,
          b.settledInMinor,
          b.settledOutMinor,
          b.netMinor,
        ].some((v) => v !== 0),
    )
  const body: BalancesResponse = {
    baseCurrency: trip.baseCurrency,
    balances,
    poolBalanceMinor: poolBalance(input),
    refundMode: trip.poolRefundMode,
    suggested: suggestSettlements(computed),
    rev: trip.rev,
  }
  return json(body)
}

/** GET /api/trips/:id/settlements (viewer) */
export async function listSettlements(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const body: SettlementsResponse = {
    settlements: await loadSettlements(db, auth.trip.id),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** POST /api/trips/:id/settlements (editor): a transfer from → to in base currency */
export async function createSettlement(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, settlementCreateSchema)
  // Removed members may still settle what they owe
  const members = await loadTripMembers(db, auth.trip.id)
  const all = new Set(members.map((m) => m.id))
  checkMember(members, body.fromMemberId, 'fromMemberId', all)
  checkMember(members, body.toMemberId, 'toMemberId', all)
  const state = {
    fromMemberId: body.fromMemberId,
    toMemberId: body.toMemberId,
    amountMinor: body.amountMinor,
    method: body.method,
    note: body.note,
    date: body.date ?? todayIn(auth.trip.tz),
    deletedAt: null,
  }
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'settlements', {
      id,
      tripId: auth.trip.id,
      ...state,
      createdByMemberId: auth.member.id,
      createdAt: now,
      updatedAt: now,
    }),
    historyStatement(db, {
      tripId: auth.trip.id,
      entity: 'settlement',
      entityId: id,
      memberId: auth.member.id,
      at: now,
      action: 'create',
      diff: diffOf(null, state),
      snapshot: state,
    }),
  ])
  const row = await db.prepare('SELECT * FROM settlements WHERE id = ?').bind(id).first<Row>()
  return json({ settlement: toSettlement(row as Row), rev }, 201)
}

/** DELETE /api/trips/:id/settlements/:sid (editor): soft delete; balances go back */
export async function deleteSettlement(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const row = await db
    .prepare('SELECT * FROM settlements WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(c.params.sid, auth.trip.id)
    .first<Row>()
  if (!row) throw notFound('settlement not found')
  const prev = toSettlement(row)
  const now = nowIso()
  const state = { ...stateOf(prev), deletedAt: now }
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE settlements SET deletedAt = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(now, now, prev.id),
    historyStatement(db, {
      tripId: auth.trip.id,
      entity: 'settlement',
      entityId: prev.id,
      memberId: auth.member.id,
      at: now,
      action: 'delete',
      diff: diffOf(stateOf(prev), state),
      snapshot: state,
    }),
  ])
  return json({ ok: true, rev })
}

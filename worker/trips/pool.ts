// The shared pool (公基金, e7-t01 / e7-t04): members put money in; expenses with `pool: true` are
// paid out of it; what is left is refunded in the balances (proportional to contributions, or
// equally, per trips.poolRefundMode). Contributions are converted to base currency with the same
// FX resolution as expenses (worker/trips/expenses.ts). Viewers read, editors write; every write
// bumps the trip rev and writes an expenseHistory row (entity 'pool').

import type { PoolContribution, PoolResponse } from '../../shared/api/expenses.ts'
import {
  poolContributionCreateSchema,
  poolContributionPatchSchema,
  poolSettingsSchema,
} from '../../shared/schema/expense.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, writeWithRev, type Row } from '../db.ts'
import { json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import {
  checkMember,
  diffOf,
  historyStatement,
  loadMoneyTrip,
  loadTripMembers,
  resolveRate,
  strOrNull,
  toBase,
  todayIn,
  type ResolvedRate,
} from './expenses.ts'

function toContribution(r: Row): PoolContribution {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    memberId: String(r.memberId),
    amountMinor: Number(r.amountMinor),
    currency: String(r.currency),
    fxRate: Number(r.fxRate),
    fxSource: String(r.fxSource) as PoolContribution['fxSource'],
    fxDate: strOrNull(r.fxDate),
    baseMinor: Number(r.baseMinor),
    date: String(r.date),
    note: String(r.note ?? ''),
    createdByMemberId: String(r.createdByMemberId),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    deletedAt: strOrNull(r.deletedAt),
  }
}

type ContributionState = Pick<
  PoolContribution,
  | 'memberId'
  | 'amountMinor'
  | 'currency'
  | 'fxRate'
  | 'fxSource'
  | 'fxDate'
  | 'baseMinor'
  | 'date'
  | 'note'
  | 'deletedAt'
>

function stateOf(c: PoolContribution): ContributionState {
  const { memberId, amountMinor, currency, fxRate, fxSource, fxDate, baseMinor, date, note } = c
  return {
    memberId,
    amountMinor,
    currency,
    fxRate,
    fxSource,
    fxDate,
    baseMinor,
    date,
    note,
    deletedAt: c.deletedAt,
  }
}

/** Contributions minus pool-paid expenses (not deleted), base currency */
export async function loadPoolBalance(db: D1Database, tripId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(baseMinor), 0) FROM poolContributions
           WHERE tripId = ? AND deletedAt IS NULL) -
         (SELECT COALESCE(SUM(baseMinor), 0) FROM expenses
           WHERE tripId = ? AND deletedAt IS NULL AND payerIsPool = 1) AS b`,
    )
    .bind(tripId, tripId)
    .first<number>('b')
  return Number(row ?? 0)
}

export async function loadContributions(db: D1Database, tripId: string) {
  const { results } = await db
    .prepare(
      'SELECT * FROM poolContributions WHERE tripId = ? AND deletedAt IS NULL ORDER BY date, createdAt, id',
    )
    .bind(tripId)
    .all<Row>()
  return results.map(toContribution)
}

async function loadContribution(db: D1Database, tripId: string, id: string) {
  const row = await db
    .prepare('SELECT * FROM poolContributions WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(id, tripId)
    .first<Row>()
  if (!row) throw notFound('contribution not found')
  return toContribution(row)
}

/** GET /api/trips/:id/pool/contributions (viewer): contributions, pool balance and refund mode */
export async function listContributions(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const trip = await loadMoneyTrip(db, auth)
  const [contributions, poolBalanceMinor] = await Promise.all([
    loadContributions(db, trip.id),
    loadPoolBalance(db, trip.id),
  ])
  const body: PoolResponse = {
    contributions,
    poolBalanceMinor,
    refundMode: trip.poolRefundMode,
    rev: trip.rev,
  }
  return json(body)
}

/** POST /api/trips/:id/pool/contributions (editor) */
export async function createContribution(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const body = await readBody(c.request, poolContributionCreateSchema)
  checkMember(await loadTripMembers(db, trip.id), body.memberId, 'memberId')
  const date = body.date ?? todayIn(trip.tz)
  const rate = await resolveRate(db, trip, body.currency, date, body.fxRate)
  const state: ContributionState = {
    memberId: body.memberId,
    amountMinor: body.amountMinor,
    currency: body.currency,
    ...rate,
    baseMinor: toBase(body.amountMinor, body.currency, trip.baseCurrency, rate.fxRate),
    date,
    note: body.note,
    deletedAt: null,
  }
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, trip.id, [
    insertStatement(db, 'poolContributions', {
      id,
      tripId: trip.id,
      ...state,
      createdByMemberId: auth.member.id,
      createdAt: now,
      updatedAt: now,
    }),
    historyStatement(db, {
      tripId: trip.id,
      entity: 'pool',
      entityId: id,
      memberId: auth.member.id,
      at: now,
      action: 'create',
      diff: diffOf(null, state),
      snapshot: state,
    }),
  ])
  return json({ contribution: await loadContribution(db, trip.id, id), rev }, 201)
}

async function saveContribution(
  db: D1Database,
  tripId: string,
  memberId: string,
  prev: PoolContribution,
  state: ContributionState,
  action: 'update' | 'delete',
  fallbackRev: number,
): Promise<number> {
  const diff = diffOf(stateOf(prev), state)
  if (Object.keys(diff).length === 0) return fallbackRev
  const now = nowIso()
  return writeWithRev(db, tripId, [
    db
      .prepare(
        `UPDATE poolContributions SET memberId = ?, amountMinor = ?, currency = ?, fxRate = ?,
           fxSource = ?, fxDate = ?, baseMinor = ?, date = ?, note = ?, deletedAt = ?,
           rev = rev + 1, updatedAt = ? WHERE id = ?`,
      )
      .bind(
        state.memberId,
        state.amountMinor,
        state.currency,
        state.fxRate,
        state.fxSource,
        state.fxDate,
        state.baseMinor,
        state.date,
        state.note,
        state.deletedAt,
        now,
        prev.id,
      ),
    historyStatement(db, {
      tripId,
      entity: 'pool',
      entityId: prev.id,
      memberId,
      at: now,
      action,
      diff,
      snapshot: state,
    }),
  ])
}

/** PATCH /api/trips/:id/pool/contributions/:cid (editor): re-converts on amount/currency/date/rate */
export async function patchContribution(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const prev = await loadContribution(db, trip.id, c.params.cid)
  const body = await readBody(c.request, poolContributionPatchSchema)
  if (body.memberId && body.memberId !== prev.memberId)
    checkMember(await loadTripMembers(db, trip.id), body.memberId, 'memberId')
  const currency = body.currency ?? prev.currency
  const date = body.date ?? prev.date
  let rate: ResolvedRate
  if (body.fxRate !== undefined && body.fxRate !== null)
    rate = await resolveRate(db, trip, currency, date, body.fxRate)
  else if (
    body.fxRate === null ||
    currency !== prev.currency ||
    (date !== prev.date && prev.fxSource === 'auto')
  )
    rate = await resolveRate(db, trip, currency, date)
  else rate = { fxRate: prev.fxRate, fxSource: prev.fxSource, fxDate: prev.fxDate }
  const amountMinor = body.amountMinor ?? prev.amountMinor
  const state: ContributionState = {
    memberId: body.memberId ?? prev.memberId,
    amountMinor,
    currency,
    ...rate,
    baseMinor: toBase(amountMinor, currency, trip.baseCurrency, rate.fxRate),
    date,
    note: body.note ?? prev.note,
    deletedAt: null,
  }
  const rev = await saveContribution(db, trip.id, auth.member.id, prev, state, 'update', trip.rev)
  return json({ contribution: await loadContribution(db, trip.id, prev.id), rev })
}

/** DELETE /api/trips/:id/pool/contributions/:cid (editor): soft delete */
export async function deleteContribution(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const prev = await loadContribution(db, auth.trip.id, c.params.cid)
  const state = { ...stateOf(prev), deletedAt: nowIso() }
  const rev = await saveContribution(
    db,
    auth.trip.id,
    auth.member.id,
    prev,
    state,
    'delete',
    auth.trip.rev,
  )
  return json({ ok: true, rev })
}

/** PATCH /api/trips/:id/pool/settings (editor): `{ refundMode: 'proportional' | 'equal' }` */
export async function patchPoolSettings(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { refundMode } = await readBody(c.request, poolSettingsSchema)
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE trips SET poolRefundMode = ?, updatedAt = ? WHERE id = ?')
      .bind(refundMode, nowIso(), auth.trip.id),
  ])
  return json({ refundMode, rev })
}

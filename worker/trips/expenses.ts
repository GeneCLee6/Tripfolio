// Expenses (e7-t01): record, split, edit with history, soft delete and restore, summaries, and the
// FX helpers the pool and settlements share (docs/PRD/e7-expenses-splitting.md, ARCHITECTURE §4.3).
// Viewers read; editors write, and any editor may edit any expense (the history records who).
// Every write bumps the trip rev (and the row rev) and answers with the new trip rev.
//
// Money: `amountMinor` is in the expense's currency, `baseMinor` and every `shareMinor` in the
// trip's base currency; shares always sum to baseMinor. Splitting is shared/money `splitExpense`
// run on the base amount (exact amounts are typed in the expense's currency, validated there, then
// used as weights for the base amount so the sum still holds).
//
// FX resolution order (rate = 1 unit of the currency in base currency, 6 decimals):
//   same currency as the trip → 1 · explicit `fxRate` (manual) · trips.fxOverrides[currency] (trip)
//   · fxRates for that date, else the latest earlier date up to 7 days back (auto)
//   · otherwise 422 `fx_unavailable` with details.needsRate = true (the UI asks for a rate).
// TODO(e7-t03): the daily fetch from open.er-api.com (worker/proxy) fills fxRates; until then rows
// are inserted by hand (tests seed them).
//
// Removed members keep their shares: balances still count them, and an expense that already names
// a removed member may keep naming them on edit; new references must be current members.

import type {
  ApplyRateResponse,
  Expense,
  ExpenseResponse,
  ExpenseShareView,
  ExpensesResponse,
  ExpenseView,
  FxResolved,
  FxResponse,
  FxSource,
  FxUnavailableDetails,
  HistoryAction,
  HistoryEntity,
  HistoryEntry,
  HistoryResponse,
  PoolRefundMode,
  SummaryResponse,
  SummaryRow,
} from '../../shared/api/expenses.ts'
import {
  convertMinor,
  invertRate,
  normalizeRate,
  SplitError,
  splitExpense,
  type PayerId,
  type Share,
} from '../../shared/money/index.ts'
import {
  applyRateSchema,
  expenseCreateSchema,
  expensePatchSchema,
  expenseQuerySchema,
  expenseRestoreSchema,
  fxOverridesSchema,
  fxQuerySchema,
  summaryQuerySchema,
  type ExpenseCategory,
  type ParticipantInput,
} from '../../shared/schema/expense.ts'
import { authTrip, type MemberAuth } from '../auth.ts'
import { insertStatement, writeWithRev, type Row } from '../db.ts'
import { ApiError, invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'

// ---------------------------------------------------------------------------------------------
// Shared helpers (also used by pool.ts and settlements.ts)

/** How far back an fxRates row may be used for a later date */
export const FX_LOOKBACK_DAYS = 7

export interface MoneyTrip {
  id: string
  baseCurrency: string
  tz: string
  rev: number
  localCurrencies: string[]
  poolRefundMode: PoolRefundMode
  /** 1 key currency = value base currency */
  fxOverrides: Record<string, number>
}

export const strOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v)
export const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v)

function parseJsonObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(v)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** The trip's money settings (columns added by migration 0007, not part of the Trip type) */
export async function loadMoneyTrip(db: D1Database, auth: MemberAuth): Promise<MoneyTrip> {
  const row = await db
    .prepare('SELECT poolRefundMode, fxOverrides FROM trips WHERE id = ?')
    .bind(auth.trip.id)
    .first<Row>()
  const overrides: Record<string, number> = {}
  for (const [k, v] of Object.entries(parseJsonObject(row?.fxOverrides))) {
    if (typeof v === 'number' && v > 0) overrides[k] = v
  }
  return {
    id: auth.trip.id,
    baseCurrency: auth.trip.baseCurrency,
    tz: auth.trip.tz,
    rev: auth.trip.rev,
    localCurrencies: auth.trip.localCurrencies,
    poolRefundMode: row?.poolRefundMode === 'equal' ? 'equal' : 'proportional',
    fxOverrides: overrides,
  }
}

/** Today's date in the trip's time zone (YYYY-MM-DD) */
export function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface ResolvedRate {
  fxRate: number
  fxSource: FxSource
  fxDate: string | null
}

/** Trip default or fxRates row (no explicit rate); null when nothing is known */
export async function lookupRate(
  db: D1Database,
  trip: MoneyTrip,
  currency: string,
  date: string,
): Promise<ResolvedRate | null> {
  const base = trip.baseCurrency
  if (currency === base) return { fxRate: 1, fxSource: 'base', fxDate: null }
  const override = trip.fxOverrides[currency]
  if (override) return { fxRate: normalizeRate(override), fxSource: 'trip', fxDate: null }
  // fxRates rows read "1 base = rate quote"; either orientation of the pair is accepted
  const row = await db
    .prepare(
      `SELECT date, base, rate FROM fxRates
        WHERE date <= ? AND date >= ?
          AND ((base = ? AND quote = ?) OR (base = ? AND quote = ?))
        ORDER BY date DESC, base = ? DESC LIMIT 1`,
    )
    .bind(date, addDays(date, -FX_LOOKBACK_DAYS), base, currency, currency, base, base)
    .first<Row>()
  if (!row) return null
  const rate = Number(row.rate)
  return {
    fxRate: String(row.base) === base ? invertRate(rate) : normalizeRate(rate),
    fxSource: 'auto',
    fxDate: String(row.date),
  }
}

/** Explicit rate → trip default → fxRates; 422 fx_unavailable (needsRate) otherwise */
export async function resolveRate(
  db: D1Database,
  trip: MoneyTrip,
  currency: string,
  date: string,
  explicit?: number,
): Promise<ResolvedRate> {
  if (currency === trip.baseCurrency) return { fxRate: 1, fxSource: 'base', fxDate: null }
  if (explicit !== undefined) {
    return { fxRate: normalizeRate(explicit), fxSource: 'manual', fxDate: null }
  }
  const found = await lookupRate(db, trip, currency, date)
  if (found) return found
  const details: FxUnavailableDetails = {
    needsRate: true,
    currency,
    base: trip.baseCurrency,
    date,
  }
  throw new ApiError(
    422,
    'fx_unavailable',
    `no ${currency}→${trip.baseCurrency} rate for ${date}; send fxRate`,
    details,
  )
}

export function toBase(amountMinor: number, currency: string, base: string, rate: number): number {
  return currency === base ? amountMinor : convertMinor(amountMinor, currency, base, rate)
}

interface TripMember {
  id: string
  removed: boolean
}

/** Every member of the trip, removed ones included, in join order */
export async function loadTripMembers(db: D1Database, tripId: string): Promise<TripMember[]> {
  const { results } = await db
    .prepare('SELECT id, removedAt FROM members WHERE tripId = ? ORDER BY createdAt, id')
    .bind(tripId)
    .all<Row>()
  return results.map((r) => ({ id: String(r.id), removed: r.removedAt !== null }))
}

/**
 * 422 unless `id` is a member of the trip; removed members only when `alreadyThere` (the row
 * already referenced them before this edit)
 */
export function checkMember(
  members: TripMember[],
  id: string,
  field: string,
  alreadyThere: ReadonlySet<string> = new Set(),
): void {
  const m = members.find((x) => x.id === id)
  if (!m || (m.removed && !alreadyThere.has(id)))
    throw invalid(`${field}: no such member in this trip`)
}

/** Shallow diff of two JSON-able records: { field: [before, after] } */
export function diffOf(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)])
  for (const k of keys) {
    const b = before ? (before[k] ?? null) : null
    const a = after[k] ?? null
    if (JSON.stringify(b) !== JSON.stringify(a)) out[k] = [b, a]
  }
  return out
}

export function historyStatement(
  db: D1Database,
  entry: {
    tripId: string
    entity: HistoryEntity
    entityId: string
    memberId: string
    at: string
    action: HistoryAction
    diff: Record<string, [unknown, unknown]>
    snapshot: Record<string, unknown>
  },
): D1PreparedStatement {
  return insertStatement(db, 'expenseHistory', { id: crypto.randomUUID(), ...entry })
}

function toHistory(r: Row): HistoryEntry {
  return {
    id: String(r.id),
    entity: String(r.entity) as HistoryEntity,
    entityId: String(r.entityId),
    memberId: String(r.memberId),
    at: String(r.at),
    action: String(r.action) as HistoryAction,
    diff: parseJsonObject(r.diff) as HistoryEntry['diff'],
    snapshot: parseJsonObject(r.snapshot),
  }
}

/** `LIKE` pattern for a substring search (\ escapes) */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}

// ---------------------------------------------------------------------------------------------
// Expense rows

/** The editable state of an expense: what history snapshots and diffs are made of */
type ExpenseState = Omit<
  ExpenseView,
  'id' | 'tripId' | 'createdByMemberId' | 'rev' | 'createdAt' | 'updatedAt'
>

const STATE_KEYS = [
  'payerMemberId',
  'pool',
  'amountMinor',
  'currency',
  'fxRate',
  'fxSource',
  'fxDate',
  'baseMinor',
  'date',
  'category',
  'note',
  'stopId',
  'dayId',
  'receiptAttachmentId',
  'bookingId',
  'wishlistItemId',
  'splitMethod',
  'shares',
  'deletedAt',
] as const satisfies readonly (keyof ExpenseState)[]

function stateOf(e: ExpenseView): ExpenseState {
  const out: Record<string, unknown> = {}
  for (const k of STATE_KEYS) out[k] = e[k]
  return out as ExpenseState
}

function toExpense(r: Row): Expense {
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    payerMemberId: strOrNull(r.payerMemberId),
    pool: Number(r.payerIsPool) === 1,
    amountMinor: Number(r.amountMinor),
    currency: String(r.currency),
    fxRate: Number(r.fxRate),
    fxSource: String(r.fxSource) as FxSource,
    fxDate: strOrNull(r.fxDate),
    baseMinor: Number(r.baseMinor),
    date: String(r.date),
    category: String(r.category) as ExpenseCategory,
    note: String(r.note ?? ''),
    stopId: strOrNull(r.stopId),
    dayId: strOrNull(r.dayId),
    receiptAttachmentId: strOrNull(r.receiptAttachmentId),
    bookingId: strOrNull(r.bookingId),
    wishlistItemId: strOrNull(r.wishlistItemId),
    splitMethod: String(r.splitMethod) as Expense['splitMethod'],
    createdByMemberId: String(r.createdByMemberId),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
    deletedAt: strOrNull(r.deletedAt),
  }
}

function toShareView(r: Row): ExpenseShareView {
  return {
    memberId: String(r.memberId),
    weight: numOrNull(r.weight),
    percent: numOrNull(r.percent),
    amountMinor: numOrNull(r.amountMinor),
    shareMinor: Number(r.shareMinor),
  }
}

interface Filter {
  sql: string
  values: (string | number)[]
}

/** Expenses of the trip matching `filter` (deleted ones only when the filter asks), with shares */
export async function loadExpenseViews(
  db: D1Database,
  tripId: string,
  filter: Filter = { sql: ' AND e.deletedAt IS NULL', values: [] },
): Promise<ExpenseView[]> {
  const where = `e.tripId = ?${filter.sql}`
  const [rows, shares] = await Promise.all([
    db
      .prepare(
        `SELECT e.* FROM expenses e WHERE ${where} ORDER BY e.date DESC, e.createdAt DESC, e.id`,
      )
      .bind(tripId, ...filter.values)
      .all<Row>(),
    db
      .prepare(
        `SELECT s.* FROM expenseShares s JOIN expenses e ON e.id = s.expenseId
          WHERE ${where} ORDER BY s.expenseId, s.idx`,
      )
      .bind(tripId, ...filter.values)
      .all<Row>(),
  ])
  const views = new Map<string, ExpenseView>()
  for (const r of rows.results) {
    const e = toExpense(r)
    views.set(e.id, { ...e, shares: [] })
  }
  for (const s of shares.results) views.get(String(s.expenseId))?.shares.push(toShareView(s))
  return [...views.values()]
}

async function loadExpense(
  db: D1Database,
  tripId: string,
  expenseId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<ExpenseView> {
  const [view] = await loadExpenseViews(db, tripId, {
    sql: ` AND e.id = ?${includeDeleted ? '' : ' AND e.deletedAt IS NULL'}`,
    values: [expenseId],
  })
  if (!view) throw notFound('expense not found')
  return view
}

/** What a split needs: everything but the rate, base amount and computed shares */
interface Draft {
  payerMemberId: string | null
  pool: boolean
  amountMinor: number
  currency: string
  date: string
  category: ExpenseCategory
  note: string
  stopId: string | null
  dayId: string | null
  receiptAttachmentId: string | null
  bookingId: string | null
  wishlistItemId: string | null
  splitMethod: Expense['splitMethod']
  participants: ParticipantInput[]
}

/** Split the base amount; SplitError → 422 with its code */
function computeShares(draft: Draft, baseMinor: number, base: string): ExpenseShareView[] {
  const payerId: PayerId = draft.pool ? 'pool' : (draft.payerMemberId as string)
  const { participants, splitMethod: method } = draft
  try {
    if (method === 'self') {
      const [share] = splitExpense({ amountMinor: baseMinor, payerId, method, participants: [] })
      const { memberId, shareMinor } = share
      return [{ memberId, weight: null, percent: null, amountMinor: null, shareMinor }]
    }
    let shares: Share[]
    if (method === 'exact' && draft.currency !== base) {
      // Validate the typed amounts in the expense's currency, then carry them over as weights
      splitExpense({ amountMinor: draft.amountMinor, payerId, method, participants })
      shares = splitExpense({
        amountMinor: baseMinor,
        payerId,
        method: 'shares',
        participants: participants.map((p) => ({ memberId: p.memberId, weight: p.amountMinor })),
      })
    } else {
      shares = splitExpense({ amountMinor: baseMinor, payerId, method, participants })
    }
    return participants.map((p, i) => ({
      memberId: p.memberId,
      weight: method === 'shares' ? (p.weight ?? 1) : null,
      percent: method === 'percent' ? (p.percent ?? null) : null,
      amountMinor: method === 'exact' ? (p.amountMinor ?? null) : null,
      shareMinor: shares[i].shareMinor,
    }))
  } catch (error) {
    if (error instanceof SplitError)
      throw invalid(`participants: ${error.message}`, { splitError: error.code })
    throw error
  }
}

function buildState(draft: Draft, rate: ResolvedRate, base: string): ExpenseState {
  const baseMinor = toBase(draft.amountMinor, draft.currency, base, rate.fxRate)
  const { participants, ...rest } = draft
  void participants
  return {
    ...rest,
    payerMemberId: draft.pool ? null : draft.payerMemberId,
    ...rate,
    baseMinor,
    shares: computeShares(draft, baseMinor, base),
    deletedAt: null,
  }
}

function participantsOf(view: Pick<ExpenseView, 'shares'>): ParticipantInput[] {
  return view.shares.map((s) => ({
    memberId: s.memberId,
    ...(s.weight !== null ? { weight: s.weight } : {}),
    ...(s.percent !== null ? { percent: s.percent } : {}),
    ...(s.amountMinor !== null ? { amountMinor: s.amountMinor } : {}),
  }))
}

/** DB columns of an expense state (shares go to expenseShares) */
function stateColumns(s: ExpenseState): Record<string, unknown> {
  return {
    payerMemberId: s.payerMemberId,
    payerIsPool: s.pool ? 1 : 0,
    amountMinor: s.amountMinor,
    currency: s.currency,
    fxRate: s.fxRate,
    fxSource: s.fxSource,
    fxDate: s.fxDate,
    baseMinor: s.baseMinor,
    date: s.date,
    category: s.category,
    note: s.note,
    stopId: s.stopId,
    dayId: s.dayId,
    receiptAttachmentId: s.receiptAttachmentId,
    bookingId: s.bookingId,
    wishlistItemId: s.wishlistItemId,
    splitMethod: s.splitMethod,
    deletedAt: s.deletedAt,
  }
}

function shareStatements(db: D1Database, expenseId: string, shares: ExpenseShareView[]) {
  return [
    db.prepare('DELETE FROM expenseShares WHERE expenseId = ?').bind(expenseId),
    ...shares.map((s, idx) => insertStatement(db, 'expenseShares', { expenseId, idx, ...s })),
  ]
}

function updateExpenseStatements(
  db: D1Database,
  expenseId: string,
  state: ExpenseState,
  now: string,
): D1PreparedStatement[] {
  const cols = stateColumns(state)
  const keys = Object.keys(cols)
  const sets = keys.map((k) => `"${k}" = ?`).join(', ')
  const values = keys.map((k) => {
    const v = cols[k]
    return v === undefined ? null : (v as string | number | null)
  })
  return [
    db
      .prepare(`UPDATE expenses SET ${sets}, rev = rev + 1, updatedAt = ? WHERE id = ?`)
      .bind(...values, now, expenseId),
    ...shareStatements(db, expenseId, state.shares),
  ]
}

/** 422 when a linked stop / day / wishlist item is not in this trip */
async function checkLinks(
  db: D1Database,
  tripId: string,
  links: { stopId?: string | null; dayId?: string | null; wishlistItemId?: string | null },
): Promise<void> {
  const checks: [string | null | undefined, string, string][] = [
    [links.stopId, 'SELECT id FROM stops WHERE id = ? AND tripId = ?', 'stopId'],
    [links.dayId, 'SELECT id FROM days WHERE id = ? AND tripId = ?', 'dayId'],
    [
      links.wishlistItemId,
      'SELECT id FROM wishlistItems WHERE id = ? AND tripId = ? AND deletedAt IS NULL',
      'wishlistItemId',
    ],
  ]
  for (const [id, sql, field] of checks) {
    if (!id) continue
    const row = await db.prepare(sql).bind(id, tripId).first<Row>()
    if (!row) throw invalid(`${field}: not found in this trip`)
  }
}

function checkDraftMembers(members: TripMember[], draft: Draft, prev: ExpenseView | null): void {
  const before = new Set<string>(prev ? prev.shares.map((s) => s.memberId) : [])
  if (prev?.payerMemberId) before.add(prev.payerMemberId)
  if (!draft.pool) checkMember(members, draft.payerMemberId as string, 'payerMemberId', before)
  if (draft.splitMethod !== 'self') {
    draft.participants.forEach((p, i) =>
      checkMember(members, p.memberId, `participants.${i}.memberId`, before),
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Handlers

/** GET /api/trips/:id/expenses?from=&to=&category=&memberId=&q=&deleted= (viewer) */
export async function listExpenses(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const p = c.url.searchParams
  const parsed = expenseQuerySchema.safeParse({
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    category: p.get('category') ?? undefined,
    memberId: p.get('memberId') ?? undefined,
    q: p.get('q') ?? undefined,
    deleted: p.get('deleted') ?? undefined,
  })
  if (!parsed.success) throw invalid('invalid query', parsed.error.issues)
  const q = parsed.data
  const parts: string[] = [
    q.deleted === '1' ? ' AND e.deletedAt IS NOT NULL' : ' AND e.deletedAt IS NULL',
  ]
  const values: string[] = []
  if (q.from) {
    parts.push(' AND e.date >= ?')
    values.push(q.from)
  }
  if (q.to) {
    parts.push(' AND e.date <= ?')
    values.push(q.to)
  }
  if (q.category) {
    parts.push(' AND e.category = ?')
    values.push(q.category)
  }
  if (q.memberId) {
    parts.push(
      ' AND (e.payerMemberId = ? OR EXISTS (SELECT 1 FROM expenseShares x WHERE x.expenseId = e.id AND x.memberId = ?))',
    )
    values.push(q.memberId, q.memberId)
  }
  if (q.q) {
    parts.push(" AND e.note LIKE ? ESCAPE '\\'")
    values.push(likePattern(q.q))
  }
  const expenses = await loadExpenseViews(db, auth.trip.id, { sql: parts.join(''), values })
  const body: ExpensesResponse = { expenses, rev: auth.trip.rev }
  return json(body)
}

/** GET /api/trips/:id/expenses/:eid (viewer; deleted ones too) */
export async function getExpense(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const expense = await loadExpense(db, auth.trip.id, c.params.eid, { includeDeleted: true })
  const body: ExpenseResponse = { expense, rev: auth.trip.rev }
  return json(body)
}

/** POST /api/trips/:id/expenses (editor) */
export async function createExpense(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const body = await readBody(c.request, expenseCreateSchema)
  const draft: Draft = {
    payerMemberId: body.pool ? null : (body.payerMemberId ?? null),
    pool: body.pool,
    amountMinor: body.amountMinor,
    currency: body.currency,
    date: body.date ?? todayIn(trip.tz),
    category: body.category,
    note: body.note,
    stopId: body.stopId,
    dayId: body.dayId,
    receiptAttachmentId: body.receiptAttachmentId,
    bookingId: body.bookingId,
    wishlistItemId: body.wishlistItemId,
    splitMethod: body.splitMethod,
    participants: body.participants,
  }
  checkDraftMembers(await loadTripMembers(db, trip.id), draft, null)
  await checkLinks(db, trip.id, draft)
  const rate = await resolveRate(db, trip, draft.currency, draft.date, body.fxRate)
  const state = buildState(draft, rate, trip.baseCurrency)
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, trip.id, [
    insertStatement(db, 'expenses', {
      id,
      tripId: trip.id,
      ...stateColumns(state),
      createdByMemberId: auth.member.id,
      createdAt: now,
      updatedAt: now,
    }),
    ...shareStatements(db, id, state.shares).slice(1),
    historyStatement(db, {
      tripId: trip.id,
      entity: 'expense',
      entityId: id,
      memberId: auth.member.id,
      at: now,
      action: 'create',
      diff: diffOf(null, state),
      snapshot: state,
    }),
  ])
  const response: ExpenseResponse = { expense: await loadExpense(db, trip.id, id), rev }
  return json(response, 201)
}

/** The rate a patch ends up with: explicit / cleared / re-resolved on currency or date change */
async function patchRate(
  db: D1Database,
  trip: MoneyTrip,
  prev: ExpenseView,
  next: { currency: string; date: string },
  fxRate: number | null | undefined,
): Promise<ResolvedRate> {
  if (fxRate !== undefined && fxRate !== null)
    return resolveRate(db, trip, next.currency, next.date, fxRate)
  if (
    fxRate === null ||
    next.currency !== prev.currency ||
    (next.date !== prev.date && prev.fxSource === 'auto')
  )
    return resolveRate(db, trip, next.currency, next.date)
  return { fxRate: prev.fxRate, fxSource: prev.fxSource, fxDate: prev.fxDate }
}

/** Writes `state` over `prev` with a history row; no write (and no history) when nothing changed */
async function saveState(
  db: D1Database,
  auth: MemberAuth,
  prev: ExpenseView,
  state: ExpenseState,
  action: HistoryAction,
): Promise<number> {
  const diff = diffOf(stateOf(prev), state)
  if (Object.keys(diff).length === 0) return auth.trip.rev
  const now = nowIso()
  return writeWithRev(db, auth.trip.id, [
    ...updateExpenseStatements(db, prev.id, state, now),
    historyStatement(db, {
      tripId: auth.trip.id,
      entity: 'expense',
      entityId: prev.id,
      memberId: auth.member.id,
      at: now,
      action,
      diff,
      snapshot: state,
    }),
  ])
}

/** PATCH /api/trips/:id/expenses/:eid (editor): re-splits on every change */
export async function patchExpense(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const prev = await loadExpense(db, trip.id, c.params.eid)
  const body = await readBody(c.request, expensePatchSchema)
  if (body.pool === true && body.payerMemberId) throw invalid('payerMemberId: not with pool: true')
  let pool = prev.pool
  let payerMemberId = prev.payerMemberId
  if (body.pool === true) {
    pool = true
    payerMemberId = null
  } else if (body.payerMemberId) {
    pool = false
    payerMemberId = body.payerMemberId
  } else if (body.pool === false || body.payerMemberId === null) {
    throw invalid('payerMemberId: give the member who paid instead')
  }
  const draft: Draft = {
    payerMemberId,
    pool,
    amountMinor: body.amountMinor ?? prev.amountMinor,
    currency: body.currency ?? prev.currency,
    date: body.date ?? prev.date,
    category: body.category ?? prev.category,
    note: body.note ?? prev.note,
    stopId: body.stopId === undefined ? prev.stopId : body.stopId,
    dayId: body.dayId === undefined ? prev.dayId : body.dayId,
    receiptAttachmentId:
      body.receiptAttachmentId === undefined ? prev.receiptAttachmentId : body.receiptAttachmentId,
    bookingId: body.bookingId === undefined ? prev.bookingId : body.bookingId,
    wishlistItemId: body.wishlistItemId === undefined ? prev.wishlistItemId : body.wishlistItemId,
    splitMethod: body.splitMethod ?? prev.splitMethod,
    participants: body.participants ?? participantsOf(prev),
  }
  checkDraftMembers(await loadTripMembers(db, trip.id), draft, prev)
  await checkLinks(db, trip.id, {
    stopId: body.stopId,
    dayId: body.dayId,
    wishlistItemId: body.wishlistItemId,
  })
  const rate = await patchRate(db, trip, prev, draft, body.fxRate)
  const state = buildState(draft, rate, trip.baseCurrency)
  const rev = await saveState(db, auth, prev, state, 'update')
  const response: ExpenseResponse = { expense: await loadExpense(db, trip.id, prev.id), rev }
  return json(response)
}

/** DELETE /api/trips/:id/expenses/:eid (editor): soft delete, kept in history */
export async function deleteExpense(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const prev = await loadExpense(db, auth.trip.id, c.params.eid)
  const state: ExpenseState = { ...stateOf(prev), deletedAt: nowIso() }
  const rev = await saveState(db, auth, prev, state, 'delete')
  return json({ ok: true, rev })
}

/**
 * POST /api/trips/:id/expenses/:eid/restore (editor): `{}` undeletes; `{ historyId }` brings back
 * the version that history row recorded (its rate as it was, shares split again), undeleted
 */
export async function restoreExpense(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const prev = await loadExpense(db, trip.id, c.params.eid, { includeDeleted: true })
  const { historyId } = await readBody(c.request, expenseRestoreSchema)
  let state: ExpenseState
  if (!historyId) {
    if (!prev.deletedAt) throw invalid('the expense is not deleted')
    state = { ...stateOf(prev), deletedAt: null }
  } else {
    const row = await db
      .prepare(
        `SELECT * FROM expenseHistory WHERE id = ? AND tripId = ? AND entity = 'expense' AND entityId = ?`,
      )
      .bind(historyId, trip.id, prev.id)
      .first<Row>()
    if (!row) throw notFound('history entry not found')
    const snap = toHistory(row).snapshot as Partial<ExpenseState>
    if (typeof snap.amountMinor !== 'number' || !Array.isArray(snap.shares))
      throw invalid('historyId: that entry has no restorable version')
    const draft: Draft = {
      ...(stateOf({ ...prev, ...snap } as ExpenseView) as ExpenseState),
      participants: participantsOf({ shares: snap.shares }),
    }
    checkDraftMembers(await loadTripMembers(db, trip.id), draft, {
      ...prev,
      shares: [...prev.shares, ...snap.shares],
      payerMemberId: snap.payerMemberId ?? prev.payerMemberId,
    })
    const rate: ResolvedRate = {
      fxRate: Number(snap.fxRate),
      fxSource: (snap.fxSource ?? 'manual') as FxSource,
      fxDate: snap.fxDate ?? null,
    }
    state = buildState(draft, rate, trip.baseCurrency)
  }
  const rev = await saveState(db, auth, prev, state, 'restore')
  const response: ExpenseResponse = { expense: await loadExpense(db, trip.id, prev.id), rev }
  return json(response)
}

/** GET /api/trips/:id/expenses/:eid/history (viewer): oldest first */
export async function expenseHistory(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const expense = await loadExpense(db, auth.trip.id, c.params.eid, { includeDeleted: true })
  const { results } = await db
    .prepare(
      `SELECT * FROM expenseHistory WHERE tripId = ? AND entity = 'expense' AND entityId = ?
        ORDER BY at, rowid`,
    )
    .bind(auth.trip.id, expense.id)
    .all<Row>()
  const body: HistoryResponse = { history: results.map(toHistory) }
  return json(body)
}

/** GET /api/trips/:id/expense-history?entity=&limit= (viewer): the trip's money log, newest first */
export async function tripMoneyHistory(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const entity = c.url.searchParams.get('entity')
  if (entity !== null && !['expense', 'pool', 'settlement'].includes(entity))
    throw invalid('entity: expense, pool or settlement')
  const limit = Math.min(Math.max(Number(c.url.searchParams.get('limit') ?? 200) || 200, 1), 1000)
  const { results } = await db
    .prepare(
      `SELECT * FROM expenseHistory WHERE tripId = ?${entity ? ' AND entity = ?' : ''}
        ORDER BY at DESC, rowid DESC LIMIT ?`,
    )
    .bind(auth.trip.id, ...(entity ? [entity] : []), limit)
    .all<Row>()
  const body: HistoryResponse = { history: results.map(toHistory) }
  return json(body)
}

/** GET /api/trips/:id/expenses/summary?by=day|category|member&from=&to= (viewer) */
export async function expenseSummary(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const p = c.url.searchParams
  const parsed = summaryQuerySchema.safeParse({
    by: p.get('by') ?? undefined,
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
  })
  if (!parsed.success) throw invalid('by: day, category or member', parsed.error.issues)
  const { by, from, to } = parsed.data
  const parts = [' AND e.deletedAt IS NULL']
  const values: string[] = []
  if (from) {
    parts.push(' AND e.date >= ?')
    values.push(from)
  }
  if (to) {
    parts.push(' AND e.date <= ?')
    values.push(to)
  }
  const where = `e.tripId = ?${parts.join('')}`
  const bind = [auth.trip.id, ...values]
  let rows: SummaryRow[]
  if (by === 'member') {
    const [paid, owed] = await Promise.all([
      db
        .prepare(
          `SELECT e.payerMemberId AS k, SUM(e.baseMinor) AS paid FROM expenses e
            WHERE ${where} AND e.payerIsPool = 0 GROUP BY e.payerMemberId`,
        )
        .bind(...bind)
        .all<Row>(),
      db
        .prepare(
          `SELECT s.memberId AS k, SUM(s.shareMinor) AS owed, COUNT(*) AS n
             FROM expenseShares s JOIN expenses e ON e.id = s.expenseId
            WHERE ${where} GROUP BY s.memberId`,
        )
        .bind(...bind)
        .all<Row>(),
    ])
    const members = await loadTripMembers(db, auth.trip.id)
    const byId = new Map<string, SummaryRow>()
    for (const m of members)
      byId.set(m.id, { key: m.id, baseMinor: 0, count: 0, paidMinor: 0, shareMinor: 0 })
    for (const r of paid.results) {
      const row = byId.get(String(r.k))
      if (row) row.paidMinor = Number(r.paid)
    }
    for (const r of owed.results) {
      const row = byId.get(String(r.k))
      if (!row) continue
      row.shareMinor = Number(r.owed)
      row.baseMinor = Number(r.owed)
      row.count = Number(r.n)
    }
    rows = [...byId.values()].filter(
      (r) => r.count > 0 || r.paidMinor !== 0 || !members.find((m) => m.id === r.key)?.removed,
    )
  } else {
    const col = by === 'day' ? 'e.date' : 'e.category'
    const { results } = await db
      .prepare(
        `SELECT ${col} AS k, SUM(e.baseMinor) AS total, COUNT(*) AS n FROM expenses e
          WHERE ${where} GROUP BY ${col} ORDER BY ${by === 'day' ? 'k' : 'total DESC, k'}`,
      )
      .bind(...bind)
      .all<Row>()
    rows = results.map((r) => ({
      key: String(r.k),
      baseMinor: Number(r.total),
      count: Number(r.n),
    }))
  }
  const total = await db
    .prepare(`SELECT COALESCE(SUM(e.baseMinor), 0) AS t FROM expenses e WHERE ${where}`)
    .bind(...bind)
    .first<number>('t')
  const body: SummaryResponse = {
    by,
    baseCurrency: auth.trip.baseCurrency,
    rows,
    totalMinor: Number(total ?? 0),
    rev: auth.trip.rev,
  }
  return json(body)
}

/**
 * POST /api/trips/:id/expenses/apply-rate (editor): `{ currency, rate, scope }` sets that manual
 * rate on every (not deleted) expense in `currency` and re-splits; unsettled = recorded after the
 * latest settlement. One history row per changed expense.
 */
export async function applyRate(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = await loadMoneyTrip(db, auth)
  const { currency, rate, scope } = await readBody(c.request, applyRateSchema)
  if (currency === trip.baseCurrency) throw invalid('currency: that is the base currency')
  const parts = [' AND e.deletedAt IS NULL AND e.currency = ?']
  const values: string[] = [currency]
  if (scope === 'unsettled') {
    const last = await db
      .prepare('SELECT MAX(createdAt) AS m FROM settlements WHERE tripId = ? AND deletedAt IS NULL')
      .bind(trip.id)
      .first<string | null>('m')
    if (last) {
      parts.push(' AND e.createdAt > ?')
      values.push(last)
    }
  }
  const targets = await loadExpenseViews(db, trip.id, { sql: parts.join(''), values })
  const fixed: ResolvedRate = { fxRate: normalizeRate(rate), fxSource: 'manual', fxDate: null }
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  let updated = 0
  for (const prev of targets) {
    const state = buildState(
      { ...stateOf(prev), participants: participantsOf(prev) },
      fixed,
      trip.baseCurrency,
    )
    const diff = diffOf(stateOf(prev), state)
    if (Object.keys(diff).length === 0) continue
    updated += 1
    statements.push(
      ...updateExpenseStatements(db, prev.id, state, now),
      historyStatement(db, {
        tripId: trip.id,
        entity: 'expense',
        entityId: prev.id,
        memberId: auth.member.id,
        at: now,
        action: 'update',
        diff,
        snapshot: state,
      }),
    )
  }
  const rev = statements.length ? await writeWithRev(db, trip.id, statements) : trip.rev
  const body: ApplyRateResponse = { updated, rev }
  return json(body)
}

// ---------------------------------------------------------------------------------------------
// FX

/** GET /api/trips/:id/fx?date=&quote= (viewer): resolved rates (trip default → fxRates) */
export async function getFx(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const trip = await loadMoneyTrip(db, auth)
  const parsed = fxQuerySchema.safeParse({
    date: c.url.searchParams.get('date') ?? undefined,
    quote: c.url.searchParams.get('quote') ?? undefined,
  })
  if (!parsed.success) throw invalid('invalid query', parsed.error.issues)
  const date = parsed.data.date ?? todayIn(trip.tz)
  const quotes = parsed.data.quote
    ? [parsed.data.quote]
    : [...new Set([...trip.localCurrencies, ...Object.keys(trip.fxOverrides)])].filter(
        (q) => q !== trip.baseCurrency,
      )
  const rates: FxResolved[] = []
  for (const quote of quotes) {
    const found = await lookupRate(db, trip, quote, date)
    rates.push({
      quote,
      rate: found?.fxRate ?? null,
      source: found?.fxSource ?? null,
      rateDate: found?.fxDate ?? null,
    })
  }
  const body: FxResponse = { base: trip.baseCurrency, date, overrides: trip.fxOverrides, rates }
  return json(body)
}

/** PUT /api/trips/:id/fx/overrides (editor): replaces the trip's default rates `{ NZD: 0.91 }` */
export async function putFxOverrides(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const body = await readBody(c.request, fxOverridesSchema)
  const overrides: Record<string, number> = {}
  for (const [code, rate] of Object.entries(body)) {
    if (code === auth.trip.baseCurrency) throw invalid(`${code}: that is the base currency`)
    overrides[code] = normalizeRate(rate)
  }
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE trips SET fxOverrides = ?, updatedAt = ? WHERE id = ?')
      .bind(JSON.stringify(overrides), nowIso(), auth.trip.id),
  ])
  return json({ overrides, rev })
}

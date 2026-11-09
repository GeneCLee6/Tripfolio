// /api/trips: create, list (by the device's tokens), read, edit, archive, soft delete (e1-t01)

import type {
  CreateTripResponse,
  TripDetailResponse,
  TripListResponse,
} from '../../shared/api/types.ts'
import { MAX_MEMBER_TOKENS, MEMBER_TOKENS_HEADER } from '../../shared/api/types.ts'
import { MAX_TRIP_DAYS, tripCreateSchema, tripPatchSchema } from '../../shared/schema/trip.ts'
import { authTrip, generateToken, hashToken, requireRole, resolveMemberToken } from '../auth.ts'
import {
  insertStatement,
  toDay,
  toMember,
  toTrip,
  updateStatement,
  writeWithRev,
  type Row,
} from '../db.ts'
import { ApiError, invalid, json, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { dayCount, planDays, type DayPlan, type DaySlot } from './day-plan.ts'

const TRIP_COLUMNS = [
  'name',
  'destination',
  'centerLat',
  'centerLng',
  'startDate',
  'endDate',
  'tz',
  'baseCurrency',
  'secondaryCurrency',
  'localCurrencies',
  'coverColor',
  'coverAttachmentId',
  'summary',
  'style',
  'driveLimitMin',
  'archivedAt',
] as const

function checkDates(startDate: string, endDate: string) {
  if (endDate < startDate) throw invalid('endDate: endDate before startDate')
  if (dayCount(startDate, endDate) > MAX_TRIP_DAYS)
    throw invalid(`endDate: a trip is at most ${MAX_TRIP_DAYS} days`)
}

/** Statements that apply a DayPlan */
export function dayPlanStatements(
  db: D1Database,
  tripId: string,
  plan: DayPlan,
  now: string,
): D1PreparedStatement[] {
  return [
    ...plan.assign.map((d) =>
      db
        .prepare('UPDATE days SET date = ?, idx = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
        .bind(d.date, d.idx, now, d.id),
    ),
    ...plan.unassign.map((id) =>
      db
        .prepare('UPDATE days SET idx = NULL, rev = rev + 1, updatedAt = ? WHERE id = ?')
        .bind(now, id),
    ),
    ...plan.create.map((d) =>
      insertStatement(db, 'days', {
        id: crypto.randomUUID(),
        tripId,
        date: d.date,
        idx: d.idx,
        createdAt: now,
        updatedAt: now,
      }),
    ),
  ]
}

async function loadTrip(db: D1Database, tripId: string) {
  const row = await db.prepare('SELECT * FROM trips WHERE id = ?').bind(tripId).first<Row>()
  if (!row) throw new ApiError(404, 'not_found', 'trip not found')
  return toTrip(row)
}

async function loadMembers(db: D1Database, tripId: string) {
  const { results } = await db
    .prepare('SELECT * FROM members WHERE tripId = ? AND removedAt IS NULL ORDER BY createdAt, id')
    .bind(tripId)
    .all<Row>()
  return results.map(toMember)
}

/** POST /api/trips: no auth; the creator becomes the owner and gets the first memberToken */
export async function createTrip(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const { owner, ...fields } = await readBody(c.request, tripCreateSchema)
  checkDates(fields.startDate, fields.endDate)
  const now = nowIso()
  const tripId = crypto.randomUUID()
  const memberId = crypto.randomUUID()
  const memberToken = generateToken()
  const plan = planDays([], fields.startDate, fields.endDate)
  const rev = await writeWithRev(db, tripId, [
    insertStatement(db, 'trips', {
      id: tripId,
      ...fields,
      ownerMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    }),
    insertStatement(db, 'members', {
      id: memberId,
      tripId,
      name: owner.name,
      color: owner.color,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    }),
    insertStatement(db, 'memberTokens', {
      tokenHash: await hashToken(memberToken),
      tripId,
      memberId,
      createdAt: now,
    }),
    ...dayPlanStatements(db, tripId, plan, now),
  ])
  const [trip, members, days] = await Promise.all([
    loadTrip(db, tripId),
    loadMembers(db, tripId),
    db.prepare('SELECT * FROM days WHERE tripId = ? ORDER BY idx').bind(tripId).all<Row>(),
  ])
  const body: CreateTripResponse = {
    trip,
    member: members[0],
    memberToken,
    days: days.results.map(toDay),
    rev,
  }
  return json(body, 201)
}

/** GET /api/trips: the trips behind the device's memberTokens (X-Member-Tokens, comma-separated) */
export async function listTrips(c: RouteContext): Promise<Response> {
  const tokens = (c.request.headers.get(MEMBER_TOKENS_HEADER) ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length > MAX_MEMBER_TOKENS)
    throw invalid(`at most ${MAX_MEMBER_TOKENS} tokens in ${MEMBER_TOKENS_HEADER}`)
  const resolved = await Promise.all(tokens.map((t) => resolveMemberToken(c.env.DB, t)))
  const body: TripListResponse = { trips: [] }
  resolved.forEach((auth, tokenIndex) => {
    if (auth) body.trips.push({ tokenIndex, trip: auth.trip, member: auth.member })
  })
  return json(body)
}

/** GET /api/trips/:id (viewer) */
export async function getTrip(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'viewer')
  const body: TripDetailResponse = {
    trip: auth.trip,
    me: auth.member,
    members: await loadMembers(c.env.DB, auth.trip.id),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** PATCH /api/trips/:id (editor; `archived` owner only). Date changes re-plan the Day rows */
export async function patchTrip(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor', { allowArchived: true })
  const { archived, ...fields } = await readBody(c.request, tripPatchSchema)
  if (archived !== undefined) requireRole(auth, 'owner')
  const trip = auth.trip
  const editsContent = Object.values(fields).some((v) => v !== undefined)
  // An archived trip only accepts being unarchived (in the same request or before)
  if (trip.archivedAt && editsContent && archived !== false)
    throw new ApiError(403, 'trip_archived', 'the trip is archived')

  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const startDate = fields.startDate ?? trip.startDate
  const endDate = fields.endDate ?? trip.endDate
  if (startDate !== trip.startDate || endDate !== trip.endDate) {
    checkDates(startDate, endDate)
    const { results } = await db
      .prepare(
        'SELECT id, date, idx FROM days WHERE tripId = ? ORDER BY idx IS NULL, idx, createdAt, id',
      )
      .bind(trip.id)
      .all<Row>()
    const slots: DaySlot[] = results.map((r) => ({
      id: String(r.id),
      date: r.date === null ? null : String(r.date),
      idx: r.idx === null ? null : Number(r.idx),
    }))
    statements.push(...dayPlanStatements(db, trip.id, planDays(slots, startDate, endDate), now))
  }
  const patch: Record<string, unknown> = { ...fields }
  if (archived !== undefined) patch.archivedAt = archived ? (trip.archivedAt ?? now) : null
  const update = updateStatement(
    db,
    'trips',
    patch,
    TRIP_COLUMNS,
    now,
    {
      sql: 'id = ?',
      values: [trip.id],
    },
    { bumpRowRev: false },
  )
  if (update) statements.unshift(update)
  const rev = statements.length ? await writeWithRev(db, trip.id, statements) : trip.rev
  return json({ trip: await loadTrip(db, trip.id), rev })
}

/** DELETE /api/trips/:id (owner): soft delete; the cleanup cron (E11) purges after 30 days */
export async function deleteTrip(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE trips SET deletedAt = ?, updatedAt = ? WHERE id = ?')
      .bind(now, now, auth.trip.id),
  ])
  return json({ ok: true, rev })
}

export { loadMembers, loadTrip }

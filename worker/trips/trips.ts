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
import { notifyTrip } from '../sync.ts'
import { dayCount, planDays, type DayPlan, type DaySlot } from './day-plan.ts'
import { relinkTripLodgings } from './lodging.ts'

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
  // A new trip has no photos yet, so nothing can be its cover
  if (fields.coverAttachmentId) throw invalid('coverAttachmentId: not a ready photo of this trip')
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
  const db = c.env.DB
  const resolved = await Promise.all(tokens.map((t) => resolveMemberToken(db, t)))
  const tripIds = [...new Set(resolved.flatMap((auth) => (auth ? [auth.trip.id] : [])))]
  const memberCounts = new Map<string, number>()
  const dayCounts = new Map<string, number>()
  if (tripIds.length > 0) {
    const marks = tripIds.map(() => '?').join(', ')
    const [members, days] = await db.batch<{ tripId: string; n: number }>([
      db
        .prepare(
          `SELECT tripId, COUNT(*) AS n FROM members
            WHERE tripId IN (${marks}) AND removedAt IS NULL GROUP BY tripId`,
        )
        .bind(...tripIds),
      db
        .prepare(
          `SELECT tripId, COUNT(*) AS n FROM days
            WHERE tripId IN (${marks}) AND idx IS NOT NULL GROUP BY tripId`,
        )
        .bind(...tripIds),
    ])
    for (const r of members.results) memberCounts.set(String(r.tripId), Number(r.n))
    for (const r of days.results) dayCounts.set(String(r.tripId), Number(r.n))
  }
  const body: TripListResponse = { trips: [] }
  resolved.forEach((auth, tokenIndex) => {
    if (!auth) return
    body.trips.push({
      tokenIndex,
      trip: auth.trip,
      member: auth.member,
      memberCount: memberCounts.get(auth.trip.id) ?? 0,
      dayCount: dayCounts.get(auth.trip.id) ?? 0,
    })
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

/** 422 unless `attachmentId` is a ready, not deleted photo of this trip */
async function assertCoverPhoto(db: D1Database, tripId: string, attachmentId: string) {
  const row = await db
    .prepare(
      `SELECT id FROM attachments WHERE id = ? AND tripId = ? AND kind = 'photo'
          AND status = 'ready' AND deletedAt IS NULL`,
    )
    .bind(attachmentId, tripId)
    .first<Row>()
  if (!row) throw invalid('coverAttachmentId: not a ready photo of this trip')
}

/** PATCH /api/trips/:id (editor; `archived` owner only). Date changes re-plan the Day rows and
 * re-link the days to the lodgings; coverAttachmentId must be a ready photo of the trip */
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

  if (fields.coverAttachmentId) await assertCoverPhoto(db, trip.id, fields.coverAttachmentId)

  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  const startDate = fields.startDate ?? trip.startDate
  const endDate = fields.endDate ?? trip.endDate
  const datesChanged = startDate !== trip.startDate || endDate !== trip.endDate
  if (datesChanged) {
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
  let rev = statements.length ? await writeWithRev(db, trip.id, statements) : trip.rev
  if (datesChanged) {
    // The days have their new dates now; point them at the lodgings that cover them (e4-t01)
    const relink = await relinkTripLodgings(db, trip.id, nowIso())
    if (relink.length) rev = await writeWithRev(db, trip.id, relink)
  }
  if (rev !== trip.rev) notifyTrip(c.env, trip.id, { rev, entity: 'trip', id: trip.id, action: 'upsert', by: auth.member.id })
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
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'trip', id: auth.trip.id, action: 'delete', by: auth.member.id })
  return json({ ok: true, rev })
}

export { loadMembers, loadTrip }

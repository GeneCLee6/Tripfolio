// Transport and activity bookings (e4-t01) and the trip's deadlines. A booking grows its own stops
// (stops.source = 'booking', stops.bookingId, stops.bookingSlot), placed on the trip day of their
// local date in the trip's zone, among the day's stops by time:
//   flight    'depart' on the departure day (+ 'arrive' on the arrival day when that date differs)
//   rental    'pickup' at startAt, 'dropoff' at endAt
//   driver    'day:YYYY-MM-DD' for each day of the range, at details.pickupTime, titled by driver
//   ferry, rail, bus, activity   'main' (activity: type 'other')
// All are booking 'booked'. Updating a booking updates its stops' time, title and place (moving a
// stop only when its date changes), adds stops for new slots and removes stops for slots that no
// longer apply; a stop the user deleted is not brought back. Deleting a booking deletes its stops,
// or detaches them with ?keepStops=1. Deleting one of the stops through the stops API just removes
// that stop (the booking stays). Every write bumps the trip rev.

import type {
  Booking,
  BookingDeleteResponse,
  BookingsResponse,
  BookingStopRef,
  BookingStopSlot,
  BookingWriteResponse,
  Deadline,
  DeadlinesResponse,
} from '../../shared/api/bookings.ts'
import type { StopType } from '../../shared/schema/stop.ts'
import {
  bookingCreateSchema,
  bookingDetailsSchemas,
  bookingPatchSchema,
  type BookingType,
  type DriverDetails,
} from '../../shared/schema/booking.ts'
import { authTrip } from '../auth.ts'
import { insertStatement, updateStatement, writeWithRev, type Row } from '../db.ts'
import { invalid, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { notifyTrip } from '../sync.ts'
import { localDate, localTime, localToUtcIso, resolveInstant } from './booking-time.ts'
import { datesInRange } from './day-plan.ts'
import { assertTripPlace, toLodging } from './lodging.ts'
import { planPlacement, type Ordered } from './order.ts'

const BOOKING_COLUMNS = [
  'title',
  'details',
  'startAt',
  'endAt',
  'startTz',
  'endTz',
  'priceMinor',
  'currency',
  'payStatus',
  'payerMemberId',
  'cancelBy',
  'ref',
  'note',
] as const

/** A driver booking makes at most this many daily stops */
const MAX_DRIVER_DAYS = 60

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** A booking row without its stops, still discriminated by type */
type StoredBooking = Booking extends infer B
  ? B extends Booking
    ? Omit<B, 'stops'>
    : never
  : never

function toBooking(r: Row): StoredBooking {
  let details: unknown = {}
  try {
    details = JSON.parse(String(r.details ?? '{}'))
  } catch {
    details = {}
  }
  return {
    id: String(r.id),
    tripId: String(r.tripId),
    type: String(r.type) as BookingType,
    title: String(r.title),
    details,
    startAt: strOrNull(r.startAt),
    endAt: strOrNull(r.endAt),
    startTz: strOrNull(r.startTz),
    endTz: strOrNull(r.endTz),
    priceMinor: numOrNull(r.priceMinor),
    currency: strOrNull(r.currency),
    payStatus: String(r.payStatus) as Booking['payStatus'],
    payerMemberId: strOrNull(r.payerMemberId),
    cancelBy: strOrNull(r.cancelBy),
    ref: strOrNull(r.ref),
    note: String(r.note ?? ''),
    rev: Number(r.rev),
    createdAt: String(r.createdAt),
    updatedAt: String(r.updatedAt),
  } as StoredBooking
}

async function loadBookingRow(db: D1Database, tripId: string, bookingId: string) {
  const row = await db
    .prepare('SELECT * FROM bookings WHERE id = ? AND tripId = ? AND deletedAt IS NULL')
    .bind(bookingId, tripId)
    .first<Row>()
  if (!row) throw notFound('booking not found')
  return toBooking(row)
}

async function bookingStops(
  db: D1Database,
  tripId: string,
): Promise<Map<string, BookingStopRef[]>> {
  const { results } = await db
    .prepare(
      `SELECT id, dayId, bookingId, bookingSlot FROM stops
        WHERE tripId = ? AND bookingId IS NOT NULL ORDER BY startAt, id`,
    )
    .bind(tripId)
    .all<Row>()
  const out = new Map<string, BookingStopRef[]>()
  for (const r of results) {
    const key = String(r.bookingId)
    const list = out.get(key) ?? []
    list.push({
      id: String(r.id),
      dayId: String(r.dayId),
      slot: strOrNull(r.bookingSlot) as BookingStopSlot | null,
    })
    out.set(key, list)
  }
  return out
}

async function loadBooking(db: D1Database, tripId: string, bookingId: string): Promise<Booking> {
  const booking = await loadBookingRow(db, tripId, bookingId)
  const stops = (await bookingStops(db, tripId)).get(booking.id) ?? []
  return { ...booking, stops } as Booking
}

// ---- auto-stops ----

interface PlannedStop {
  slot: BookingStopSlot
  /** Local date in the trip's zone */
  date: string
  type: StopType
  title: string
  placeId: string | null
  startAt: string
  endAt: string | null
}

/** The stops a booking should have (pure; dates are local to the trip's zone) */
export function planBookingStops(b: StoredBooking, tripTz: string): PlannedStop[] {
  if (!b.startAt) return []
  const startDate = localDate(b.startAt, tripTz)
  const base = { type: 'transport' as StopType, title: b.title, placeId: null }
  switch (b.type) {
    case 'flight': {
      const endDate = b.endAt ? localDate(b.endAt, tripTz) : startDate
      if (!b.endAt || endDate === startDate)
        return [{ ...base, slot: 'depart', date: startDate, startAt: b.startAt, endAt: b.endAt }]
      return [
        { ...base, slot: 'depart', date: startDate, startAt: b.startAt, endAt: null },
        { ...base, slot: 'arrive', date: endDate, startAt: b.endAt, endAt: null },
      ]
    }
    case 'rental': {
      const out: PlannedStop[] = [
        {
          ...base,
          slot: 'pickup',
          date: startDate,
          placeId: b.details.pickupPlaceId ?? null,
          startAt: b.startAt,
          endAt: null,
        },
      ]
      if (b.endAt)
        out.push({
          ...base,
          slot: 'dropoff',
          date: localDate(b.endAt, tripTz),
          placeId: b.details.dropoffPlaceId ?? null,
          startAt: b.endAt,
          endAt: null,
        })
      return out
    }
    case 'driver': {
      const d: DriverDetails = b.details
      const endDate = b.endAt ? localDate(b.endAt, tripTz) : startDate
      const time = d.pickupTime ?? localTime(b.startAt, tripTz)
      const last = endDate < startDate ? startDate : endDate
      return datesInRange(startDate, last)
        .slice(0, MAX_DRIVER_DAYS)
        .map((date) => ({
          ...base,
          slot: `day:${date}` as BookingStopSlot,
          date,
          title: d.driverName,
          startAt: localToUtcIso(`${date}T${time}`, tripTz),
          endAt: null,
        }))
    }
    case 'activity':
      return [
        {
          ...base,
          type: 'other',
          slot: 'main',
          date: startDate,
          placeId: b.details.meetingPlaceId ?? null,
          startAt: b.startAt,
          endAt: b.endAt,
        },
      ]
    default:
      return [{ ...base, slot: 'main', date: startDate, startAt: b.startAt, endAt: b.endAt }]
  }
}

interface ExistingStop {
  id: string
  dayId: string
  slot: string | null
  type: string
  title: string
  placeId: string | null
  startAt: string | null
  endAt: string | null
}

interface Sibling extends Ordered {
  startAt: string | null
}

/**
 * Statements that bring the booking's stops in line with `next` (and `prev`, the booking before
 * this write, or null on create). Returns the dates that have no trip day.
 */
async function syncStops(
  db: D1Database,
  tripId: string,
  tripTz: string,
  prev: StoredBooking | null,
  next: StoredBooking,
  now: string,
): Promise<{ statements: D1PreparedStatement[]; skippedDates: string[] }> {
  const [daysRes, stopsRes] = await Promise.all([
    db
      .prepare('SELECT id, date FROM days WHERE tripId = ? AND idx IS NOT NULL')
      .bind(tripId)
      .all<Row>(),
    db
      .prepare(
        'SELECT id, dayId, "order", startAt, bookingId, bookingSlot, type, title, placeId, endAt FROM stops WHERE tripId = ? ORDER BY "order", id',
      )
      .bind(tripId)
      .all<Row>(),
  ])
  const dayByDate = new Map(daysRes.results.map((r) => [String(r.date), String(r.id)]))
  const siblingsOf = new Map<string, Sibling[]>()
  const existing: ExistingStop[] = []
  for (const r of stopsRes.results) {
    const dayId = String(r.dayId)
    const list = siblingsOf.get(dayId) ?? []
    list.push({ id: String(r.id), order: Number(r.order), startAt: strOrNull(r.startAt) })
    siblingsOf.set(dayId, list)
    if (r.bookingId === next.id)
      existing.push({
        id: String(r.id),
        dayId,
        slot: strOrNull(r.bookingSlot),
        type: String(r.type),
        title: String(r.title),
        placeId: strOrNull(r.placeId),
        startAt: strOrNull(r.startAt),
        endAt: strOrNull(r.endAt),
      })
  }

  const statements: D1PreparedStatement[] = []
  const skippedDates: string[] = []

  /** Position by time among the day's stops; updates the in-memory siblings */
  const place = (dayId: string, stopId: string, startAt: string) => {
    const siblings = (siblingsOf.get(dayId) ?? []).filter((s) => s.id !== stopId)
    const later = siblings.findIndex((s) => s.startAt !== null && s.startAt > startAt)
    const afterId = later < 0 ? 'end' : later === 0 ? null : siblings[later - 1].id
    const placement = planPlacement(siblings, afterId)
    if (!placement) throw new Error('unreachable: placement after a known sibling')
    for (const r of placement.renumbered) {
      statements.push(
        db
          .prepare('UPDATE stops SET "order" = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
          .bind(r.order, now, r.id),
      )
      const s = siblings.find((x) => x.id === r.id)
      if (s) s.order = r.order
    }
    siblings.push({ id: stopId, order: placement.order, startAt })
    siblings.sort((a, b) => a.order - b.order)
    siblingsOf.set(dayId, siblings)
    return placement.order
  }

  const planned = planBookingStops(next, tripTz)
  // Slots the booking already had a day for: if their stop is gone, the user deleted it
  const hadBefore = new Set(
    (prev ? planBookingStops(prev, tripTz) : [])
      .filter((p) => dayByDate.has(p.date))
      .map((p) => p.slot),
  )
  const kept = new Set<string>()
  for (const p of planned) {
    const dayId = dayByDate.get(p.date)
    const stop = existing.find((s) => s.slot === p.slot)
    if (!dayId) {
      skippedDates.push(p.date)
      continue
    }
    if (stop) {
      kept.add(stop.id)
      const moved = stop.dayId !== dayId
      const changed =
        moved ||
        stop.type !== p.type ||
        stop.title !== p.title ||
        stop.placeId !== p.placeId ||
        stop.startAt !== p.startAt ||
        stop.endAt !== p.endAt
      if (!changed) continue
      const order = moved ? place(dayId, stop.id, p.startAt) : null
      statements.push(
        db
          .prepare(
            `UPDATE stops SET type = ?, title = ?, placeId = ?, startAt = ?, endAt = ?,
                    dayId = ?, "order" = COALESCE(?, "order"), rev = rev + 1, updatedAt = ?
              WHERE id = ?`,
          )
          .bind(p.type, p.title, p.placeId, p.startAt, p.endAt, dayId, order, now, stop.id),
      )
      continue
    }
    if (hadBefore.has(p.slot)) continue
    const id = crypto.randomUUID()
    statements.push(
      insertStatement(db, 'stops', {
        id,
        tripId,
        dayId,
        order: place(dayId, id, p.startAt),
        type: p.type,
        title: p.title,
        placeId: p.placeId,
        startAt: p.startAt,
        endAt: p.endAt,
        booking: 'booked',
        bookingId: next.id,
        source: 'booking',
        bookingSlot: p.slot,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  // Slots that no longer apply (e.g. a flight that now lands the same day, a shorter driver range)
  for (const stop of existing) {
    if (kept.has(stop.id)) continue
    if (planned.some((p) => p.slot === stop.slot && !dayByDate.has(p.date))) {
      // Its date left the trip: detach rather than lose it silently
      statements.push(
        db
          .prepare(
            `UPDATE stops SET bookingId = NULL, bookingSlot = NULL, source = 'manual',
                    rev = rev + 1, updatedAt = ? WHERE id = ?`,
          )
          .bind(now, stop.id),
      )
      continue
    }
    statements.push(...deleteStopStatements(db, stop.id))
  }
  return { statements, skippedDates }
}

function deleteStopStatements(db: D1Database, stopId: string): D1PreparedStatement[] {
  return [
    db
      .prepare('DELETE FROM legOverrides WHERE fromStopId = ? OR toStopId = ?')
      .bind(stopId, stopId),
    db.prepare('DELETE FROM stops WHERE id = ?').bind(stopId),
  ]
}

// ---- validation helpers ----

async function assertPayer(db: D1Database, tripId: string, memberId: string | null | undefined) {
  if (!memberId) return
  const row = await db
    .prepare('SELECT id FROM members WHERE id = ? AND tripId = ? AND removedAt IS NULL')
    .bind(memberId, tripId)
    .first<Row>()
  if (!row) throw invalid('payerMemberId: no such member in this trip')
}

async function assertDetailPlaces(db: D1Database, tripId: string, details: object) {
  const d = details as Record<string, unknown>
  for (const key of ['pickupPlaceId', 'dropoffPlaceId', 'meetingPlaceId'])
    if (typeof d[key] === 'string') await assertTripPlace(db, tripId, d[key], `details.${key}`)
}

function checkBooking(b: Pick<StoredBooking, 'startAt' | 'endAt' | 'priceMinor' | 'currency'>) {
  if (b.startAt && b.endAt && b.endAt < b.startAt)
    throw invalid('endAt: must not be before startAt')
  if (b.endAt && !b.startAt) throw invalid('startAt: required with endAt')
  if (b.priceMinor !== null && b.currency === null)
    throw invalid('currency: currency is required with priceMinor')
}

function toTime(local: string | null | undefined, tz: string): string | null | undefined {
  try {
    return resolveInstant(undefined, local, tz)
  } catch {
    throw invalid('invalid local time')
  }
}

// ---- handlers ----

/** GET /api/trips/:id/bookings (viewer): by startAt, undated last */
export async function listBookings(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const [{ results }, stops] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM bookings WHERE tripId = ? AND deletedAt IS NULL
          ORDER BY startAt IS NULL, startAt, createdAt, id`,
      )
      .bind(auth.trip.id)
      .all<Row>(),
    bookingStops(db, auth.trip.id),
  ])
  const body: BookingsResponse = {
    bookings: results.map((r) => {
      const b = toBooking(r)
      return { ...b, stops: stops.get(b.id) ?? [] } as Booking
    }),
    rev: auth.trip.rev,
  }
  return json(body)
}

/** POST /api/trips/:id/bookings (editor): creates its stops */
export async function createBooking(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = auth.trip
  const { startLocal, endLocal, cancelByLocal, ...body } = await readBody(
    c.request,
    bookingCreateSchema,
  )
  const startTz = body.startTz ?? trip.tz
  const record = {
    ...body,
    startAt: toTime(startLocal, startTz) ?? body.startAt,
    endAt: toTime(endLocal, body.endTz ?? startTz) ?? body.endAt,
    cancelBy: toTime(cancelByLocal, trip.tz) ?? body.cancelBy,
  }
  checkBooking(record)
  await assertPayer(db, trip.id, record.payerMemberId)
  await assertDetailPlaces(db, trip.id, record.details)
  const now = nowIso()
  const id = crypto.randomUUID()
  const stored = { ...record, id, tripId: trip.id, rev: 1, createdAt: now, updatedAt: now }
  const sync = await syncStops(db, trip.id, trip.tz, null, stored as StoredBooking, now)
  const rev = await writeWithRev(db, trip.id, [
    insertStatement(db, 'bookings', {
      ...record,
      id,
      tripId: trip.id,
      createdAt: now,
      updatedAt: now,
    }),
    ...sync.statements,
  ])
  const res: BookingWriteResponse = {
    booking: await loadBooking(db, trip.id, id),
    skippedDates: sync.skippedDates,
    rev,
  }
  notifyTrip(c.env, trip.id, { rev, entity: 'booking', id, action: 'upsert', by: auth.member.id })
  return json(res, 201)
}

/** PATCH /api/trips/:id/bookings/:bid (editor): changes flow into its stops */
export async function patchBooking(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const trip = auth.trip
  const prev = await loadBookingRow(db, trip.id, c.params.bid)
  const { startLocal, endLocal, cancelByLocal, type, details, ...body } = await readBody(
    c.request,
    bookingPatchSchema,
  )
  if (type !== undefined && type !== prev.type) throw invalid('type: cannot change')
  const startTz = (body.startTz === undefined ? prev.startTz : body.startTz) ?? trip.tz
  const endTz = (body.endTz === undefined ? prev.endTz : body.endTz) ?? startTz
  const patch: Record<string, unknown> = { ...body }
  const startAt = startLocal === undefined ? undefined : toTime(startLocal, startTz)
  const endAt = endLocal === undefined ? undefined : toTime(endLocal, endTz)
  const cancelBy = cancelByLocal === undefined ? undefined : toTime(cancelByLocal, trip.tz)
  if (startAt !== undefined) patch.startAt = startAt
  if (endAt !== undefined) patch.endAt = endAt
  if (cancelBy !== undefined) patch.cancelBy = cancelBy
  if (details !== undefined) {
    const merged: Record<string, unknown> = { ...(prev.details as object), ...details }
    for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key]
    const parsed = bookingDetailsSchemas[prev.type].safeParse(merged)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      throw invalid(
        `details.${first?.path.join('.') ?? ''}: ${first?.message ?? 'invalid'}`,
        parsed.error.issues,
      )
    }
    patch.details = parsed.data
    await assertDetailPlaces(db, trip.id, parsed.data)
  }
  const next = { ...prev, ...patch } as StoredBooking
  checkBooking(next)
  if (patch.payerMemberId !== undefined)
    await assertPayer(db, trip.id, patch.payerMemberId as string | null)
  const now = nowIso()
  const update = updateStatement(db, 'bookings', patch, BOOKING_COLUMNS, now, {
    sql: 'id = ?',
    values: [prev.id],
  })
  const sync = await syncStops(db, trip.id, trip.tz, prev, next, now)
  const statements = [...(update ? [update] : []), ...sync.statements]
  const rev = statements.length ? await writeWithRev(db, trip.id, statements) : trip.rev
  const res: BookingWriteResponse = {
    booking: await loadBooking(db, trip.id, prev.id),
    skippedDates: sync.skippedDates,
    rev,
  }
  if (statements.length) notifyTrip(c.env, trip.id, { rev, entity: 'booking', id: prev.id, action: 'upsert', by: auth.member.id })
  return json(res)
}

/** DELETE /api/trips/:id/bookings/:bid[?keepStops=1] (editor): soft; stops deleted or detached */
export async function deleteBooking(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const tripId = auth.trip.id
  const booking = await loadBookingRow(db, tripId, c.params.bid)
  const keepStops = ['1', 'true'].includes(c.url.searchParams.get('keepStops') ?? '')
  const { results } = await db
    .prepare('SELECT id FROM stops WHERE tripId = ? AND bookingId = ? ORDER BY id')
    .bind(tripId, booking.id)
    .all<Row>()
  const stopIds = results.map((r) => String(r.id))
  const now = nowIso()
  const stopStatements = keepStops
    ? [
        db
          .prepare(
            `UPDATE stops SET bookingId = NULL, bookingSlot = NULL, source = 'manual',
                    rev = rev + 1, updatedAt = ? WHERE tripId = ? AND bookingId = ?`,
          )
          .bind(now, tripId, booking.id),
      ]
    : stopIds.flatMap((id) => deleteStopStatements(db, id))
  const rev = await writeWithRev(db, tripId, [
    db
      .prepare('UPDATE bookings SET deletedAt = ?, rev = rev + 1, updatedAt = ? WHERE id = ?')
      .bind(now, now, booking.id),
    ...stopStatements,
  ])
  const res: BookingDeleteResponse = { ok: true, stopIds, keptStops: keepStops, rev }
  notifyTrip(c.env, tripId, { rev, entity: 'booking', id: booking.id, action: 'delete', by: auth.member.id })
  return json(res)
}

/**
 * GET /api/trips/:id/deadlines?withinDays=14[&includePast=1] (viewer): due in [now, now +
 * withinDays], soonest first; with includePast=1 also everything already past due (listed first,
 * oldest first: a missed payment or cancellation date). cancel = cancelBy; payment = cancelBy while not paid in full (the free-cancellation date
 * is when the full price becomes due); checkin = a lodging's checkIn + checkInTime (00:00 without
 * one) in the trip's zone, an activity's startAt minus checkInMinutesBefore.
 */
export async function listDeadlines(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const raw = c.url.searchParams.get('withinDays')
  const withinDays = raw === null ? 14 : Number(raw)
  if (!Number.isInteger(withinDays) || withinDays < 0 || withinDays > 366)
    throw invalid('withinDays: an integer from 0 to 366')
  const pastParam = c.url.searchParams.get('includePast')
  if (pastParam !== null && pastParam !== '0' && pastParam !== '1')
    throw invalid('includePast: 0 or 1')
  const includePast = pastParam === '1'
  const [lodgingRows, bookingRows] = await Promise.all([
    db
      .prepare('SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL')
      .bind(auth.trip.id)
      .all<Row>(),
    db
      .prepare('SELECT * FROM bookings WHERE tripId = ? AND deletedAt IS NULL')
      .bind(auth.trip.id)
      .all<Row>(),
  ])
  const all: Deadline[] = []
  for (const l of lodgingRows.results.map(toLodging)) {
    const item = { kind: 'lodging' as const, id: l.id, title: l.name, bookingType: null }
    if (l.cancelBy) {
      all.push({ ...item, type: 'cancel', dueAt: l.cancelBy })
      if (l.payStatus !== 'paid') all.push({ ...item, type: 'payment', dueAt: l.cancelBy })
    }
    all.push({
      ...item,
      type: 'checkin',
      dueAt: localToUtcIso(`${l.checkIn}T${l.checkInTime ?? '00:00'}`, auth.trip.tz),
    })
  }
  for (const b of bookingRows.results.map(toBooking)) {
    const item = { kind: 'booking' as const, id: b.id, title: b.title, bookingType: b.type }
    if (b.cancelBy) {
      all.push({ ...item, type: 'cancel', dueAt: b.cancelBy })
      if (b.payStatus !== 'paid') all.push({ ...item, type: 'payment', dueAt: b.cancelBy })
    }
    if (b.type === 'activity' && b.startAt && b.details.checkInMinutesBefore !== undefined) {
      const at = Date.parse(b.startAt) - b.details.checkInMinutesBefore * 60_000
      all.push({ ...item, type: 'checkin', dueAt: new Date(at).toISOString() })
    }
  }
  const now = Date.now()
  const until = now + withinDays * 86_400_000
  const order: Record<Deadline['type'], number> = { payment: 0, cancel: 1, checkin: 2 }
  const deadlines = all
    .filter((d) => {
      const t = Date.parse(d.dueAt)
      return (includePast || t >= now) && t <= until
    })
    .sort(
      (a, b) =>
        Date.parse(a.dueAt) - Date.parse(b.dueAt) ||
        order[a.type] - order[b.type] ||
        a.id.localeCompare(b.id),
    )
  const body: DeadlinesResponse = { deadlines, withinDays }
  return json(body)
}

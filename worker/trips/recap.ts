// Recap mode (e8-t04): what the trip turned out to be, day by day.
//
//   GET /api/trips/:id/recap                      (viewer) per assigned day: the recap text, the
//                                                 photo wall, planned cost vs actual spending
//   PUT /api/trips/:id/days/:dayId/recap { body } (editor) writes (or, blank, clears) a day's text
//
// Planned cost ("預估") per day = stop costs (not rainy-day backups; a stop made from a priced
// booking or lodging is not counted twice) + each priced lodging's nightly share on the nights it
// covers + bookings starting that day (local date in the booking's own zone). Amounts in other
// currencies are converted with the trip's rate or a stored fxRates row (no provider call); what
// has no rate is listed per currency and left out. Actual ("實際") = expenses by date in the base
// currency, the same sums as GET /expenses/summary?by=day. Money is app-only: the share page's
// recap (worker/share.ts, showRecap) carries text and photos, never these amounts.

import { z } from 'zod'
import type {
  RecapDay,
  RecapPutResponse,
  RecapResponse,
  RecapUnconverted,
} from '../../shared/api/share.ts'
import { RECAP_MAX_CHARS } from '../../shared/api/share.ts'
import { authTrip } from '../auth.ts'
import { writeWithRev, type Row } from '../db.ts'
import { json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { localDate } from './booking-time.ts'
import { loadMoneyTrip, lookupRate, toBase, todayIn, type MoneyTrip } from './expenses.ts'

export const recapPutSchema = z.object({ body: z.string().max(RECAP_MAX_CHARS) })

const MS_PER_DAY = 86_400_000
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)

const positive = (v: unknown): boolean => v !== null && v !== undefined && Number(v) > 0

/** A planned price on a day, before conversion */
export interface PlannedItem {
  dayId: string
  minor: number
  currency: string
}

/**
 * A lodging's price spread over its nights: night k (0-based, the date checkIn + k) gets
 * floor(total / nights), and the first `total % nights` nights one minor unit more, so the nights
 * add up to the price exactly.
 */
export function nightlyShares(
  priceMinor: number,
  checkIn: string,
  checkOut: string,
): { date: string; minor: number }[] {
  const nights = Math.max(1, daysBetween(checkIn, checkOut))
  const each = Math.floor(priceMinor / nights)
  const rest = priceMinor - each * nights
  const out: { date: string; minor: number }[] = []
  for (let k = 0; k < nights; k++) {
    const d = new Date(Date.parse(`${checkIn}T00:00:00Z`) + k * MS_PER_DAY)
    out.push({ date: d.toISOString().slice(0, 10), minor: each + (k < rest ? 1 : 0) })
  }
  return out
}

/** Planned prices per day from the trip's stops, lodgings and bookings (see the header) */
export function plannedItems(
  days: readonly { id: string; date: string | null }[],
  stops: readonly Row[],
  lodgings: readonly Row[],
  bookings: readonly Row[],
  tripTz: string,
): PlannedItem[] {
  const dayIds = new Set(days.map((d) => d.id))
  const dayByDate = new Map<string, string>()
  for (const d of days) if (d.date) dayByDate.set(d.date, d.id)
  const pricedBookings = new Set(
    bookings.filter((b) => positive(b.priceMinor) && b.currency).map((b) => String(b.id)),
  )
  const pricedLodgings = new Set(
    lodgings.filter((l) => positive(l.priceMinor) && l.currency).map((l) => String(l.id)),
  )
  const items: PlannedItem[] = []
  for (const s of stops) {
    const dayId = String(s.dayId)
    if (!dayIds.has(dayId) || Number(s.isBackup) === 1) continue
    if (!positive(s.costMinor) || !s.currency) continue
    if (s.bookingId && pricedBookings.has(String(s.bookingId))) continue
    if (s.lodgingId && pricedLodgings.has(String(s.lodgingId))) continue
    items.push({ dayId, minor: Number(s.costMinor), currency: String(s.currency) })
  }
  for (const l of lodgings) {
    if (!pricedLodgings.has(String(l.id))) continue
    for (const night of nightlyShares(Number(l.priceMinor), String(l.checkIn), String(l.checkOut))) {
      const dayId = dayByDate.get(night.date)
      if (dayId && night.minor > 0)
        items.push({ dayId, minor: night.minor, currency: String(l.currency) })
    }
  }
  for (const b of bookings) {
    if (!pricedBookings.has(String(b.id)) || !b.startAt) continue
    const zone = b.startTz ? String(b.startTz) : tripTz
    const dayId = dayByDate.get(localDate(String(b.startAt), zone))
    if (dayId) items.push({ dayId, minor: Number(b.priceMinor), currency: String(b.currency) })
  }
  return items
}

interface DaySums {
  minor: number
  unconverted: Map<string, number>
}

/** Converts planned items to the base currency per day; unknown rates are listed instead */
async function convertPlanned(
  db: D1Database,
  trip: MoneyTrip,
  items: readonly PlannedItem[],
  dateOf: (dayId: string) => string,
): Promise<Map<string, DaySums>> {
  const rates = new Map<string, number | null>()
  const out = new Map<string, DaySums>()
  for (const item of items) {
    const sums = out.get(item.dayId) ?? { minor: 0, unconverted: new Map<string, number>() }
    out.set(item.dayId, sums)
    if (item.currency === trip.baseCurrency) {
      sums.minor += item.minor
      continue
    }
    const date = dateOf(item.dayId)
    const key = `${item.currency}|${date}`
    if (!rates.has(key)) {
      const found = await lookupRate(db, trip, item.currency, date)
      rates.set(key, found ? found.fxRate : null)
    }
    const rate = rates.get(key)
    if (rate) sums.minor += toBase(item.minor, item.currency, trip.baseCurrency, rate)
    else
      sums.unconverted.set(item.currency, (sums.unconverted.get(item.currency) ?? 0) + item.minor)
  }
  return out
}

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** GET /api/trips/:id/recap (viewer) */
export async function getRecap(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'viewer')
  const tripId = auth.trip.id
  const all = async (sql: string): Promise<Row[]> =>
    (await db.prepare(sql).bind(tripId).all<Row>()).results
  const [dayRows, recapRows, stopRows, lodgingRows, bookingRows, photoRows, spentRows] =
    await Promise.all([
      all(
        `SELECT id, date, idx, title, color FROM days
          WHERE tripId = ? AND idx IS NOT NULL ORDER BY idx, date, id`,
      ),
      all('SELECT dayId, body, updatedAt FROM dayRecaps WHERE tripId = ?'),
      all(
        `SELECT id, dayId, costMinor, currency, isBackup, bookingId, lodgingId
           FROM stops WHERE tripId = ?`,
      ),
      all(
        `SELECT id, checkIn, checkOut, priceMinor, currency FROM lodgings
          WHERE tripId = ? AND deletedAt IS NULL`,
      ),
      all(
        `SELECT id, startAt, startTz, priceMinor, currency FROM bookings
          WHERE tripId = ? AND deletedAt IS NULL`,
      ),
      // Members see every ready photo of the trip (members-only ones too); the share page's recap
      // only ever gets visibility 'trip' (worker/share.ts)
      all(
        `SELECT id, dayId, stopId FROM attachments
          WHERE tripId = ? AND kind = 'photo' AND status = 'ready' AND deletedAt IS NULL
          ORDER BY takenAt IS NULL, takenAt, createdAt, id`,
      ),
      all(
        `SELECT date, SUM(baseMinor) AS total FROM expenses
          WHERE tripId = ? AND deletedAt IS NULL GROUP BY date`,
      ),
    ])

  const days = dayRows.map((r) => ({
    id: String(r.id),
    date: strOrNull(r.date),
    idx: Number(r.idx),
    title: String(r.title ?? ''),
    color: strOrNull(r.color),
  }))
  const recaps = new Map(recapRows.map((r) => [String(r.dayId), r]))
  const dayOfStop = new Map(stopRows.map((s) => [String(s.id), String(s.dayId)]))
  const photos = new Map<string, string[]>()
  for (const p of photoRows) {
    const dayId = p.dayId ? String(p.dayId) : p.stopId ? dayOfStop.get(String(p.stopId)) : undefined
    if (!dayId) continue
    const list = photos.get(dayId) ?? []
    list.push(String(p.id))
    photos.set(dayId, list)
  }

  const money = await loadMoneyTrip(db, auth)
  const dateById = new Map(days.map((d) => [d.id, d.date ?? auth.trip.startDate]))
  const planned = await convertPlanned(
    db,
    money,
    plannedItems(days, stopRows, lodgingRows, bookingRows, auth.trip.tz),
    (dayId) => dateById.get(dayId) ?? auth.trip.startDate,
  )
  const spent = new Map(spentRows.map((r) => [String(r.date), Number(r.total)]))
  const dayDates = new Set(days.map((d) => d.date).filter((d): d is string => !!d))

  const recapDays: RecapDay[] = days.map((d) => {
    const sums = planned.get(d.id)
    const unconverted: RecapUnconverted[] = [...(sums?.unconverted ?? [])]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, minor]) => ({ currency, minor }))
    const out: RecapDay = {
      dayId: d.id,
      index: d.idx,
      date: d.date,
      title: d.title,
      color: d.color,
      photoIds: photos.get(d.id) ?? [],
      estimateMinor: sums?.minor ?? 0,
      unconverted,
      actualMinor: d.date ? (spent.get(d.date) ?? 0) : 0,
    }
    const recap = recaps.get(d.id)
    if (recap && String(recap.body)) {
      out.recapBody = String(recap.body)
      out.recapUpdatedAt = String(recap.updatedAt)
    }
    return out
  })

  let otherActualMinor = 0
  for (const [date, total] of spent) if (!dayDates.has(date)) otherActualMinor += total
  const body: RecapResponse = {
    baseCurrency: auth.trip.baseCurrency,
    ended: todayIn(auth.trip.tz) > auth.trip.endDate,
    days: recapDays,
    totals: {
      estimateMinor: recapDays.reduce((sum, d) => sum + d.estimateMinor, 0),
      actualMinor: recapDays.reduce((sum, d) => sum + d.actualMinor, 0),
      otherActualMinor,
    },
    rev: auth.trip.rev,
  }
  return json(body)
}

/** PUT /api/trips/:id/days/:dayId/recap { body } (editor): a blank body clears the recap */
export async function putRecap(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'editor')
  const { body } = await readBody(c.request, recapPutSchema)
  const dayId = c.params.dayId
  const day = await db
    .prepare('SELECT id FROM days WHERE id = ? AND tripId = ?')
    .bind(dayId, auth.trip.id)
    .first<Row>()
  if (!day) throw notFound('day not found')
  const text = body.trim() ? body.trimEnd() : ''
  const now = nowIso()
  const statement = text
    ? db
        .prepare(
          `INSERT INTO dayRecaps (dayId, tripId, body, updatedByMemberId, updatedAt)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (dayId) DO UPDATE SET body = excluded.body,
             updatedByMemberId = excluded.updatedByMemberId, updatedAt = excluded.updatedAt`,
        )
        .bind(dayId, auth.trip.id, text, auth.member.id, now)
    : db.prepare('DELETE FROM dayRecaps WHERE dayId = ? AND tripId = ?').bind(dayId, auth.trip.id)
  const rev = await writeWithRev(db, auth.trip.id, [statement])
  const response: RecapPutResponse = { dayId, body: text, updatedAt: now, rev }
  return json(response)
}

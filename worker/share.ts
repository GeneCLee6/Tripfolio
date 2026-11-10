// Share links (e1-t01) and the public share payload (e8-t01a, e8-t01b, e8-t04 recap). Hiding happens here, on the
// server: the public endpoint builds its answer field by field from an allow-list, so nothing
// hidden ever leaves the Worker (CLAUDE.md rule 4).

import type { Lodging } from '../shared/api/bookings.ts'
import type { RouteMode } from '../shared/api/geo.ts'
import {
  ESTIMATE_CATEGORIES,
  type EstimateCategory,
  type EstimateCurrency,
  type ShareBooking,
  type ShareDay,
  type ShareEstimate,
  type ShareLeg,
  type ShareOvernight,
  type SharePayload,
  type SharePick,
  type SharePoint,
  type ShareStop,
  type ShareTrip,
  SHARE_RECAP_PHOTOS,
} from '../shared/api/share.ts'
import type { ApiErrorBody, CreateShareResponse, Place, Stop } from '../shared/api/types.ts'
import {
  deriveLegs,
  legKey,
  summarizeDay,
  type LatLng,
  type LegOverride as LegChoice,
  type RouteResult,
} from '../shared/itinerary/legs.ts'
import type { ItineraryStop, LegMode } from '../shared/itinerary/types.ts'
import type { StopType } from '../shared/schema/stop.ts'
import type { BookingType } from '../shared/schema/booking.ts'
import type { PayStatus } from '../shared/schema/lodging.ts'
import type { WishlistCategory } from '../shared/schema/wishlist.ts'
import { shareCreateSchema, type ShareOptions } from '../shared/schema/share.ts'
import { authTrip, generateToken, hashToken, isTokenShaped } from './auth.ts'
import {
  insertStatement,
  toDay,
  toLeg,
  toPlace,
  toShare,
  toStop,
  toTrip,
  writeWithRev,
  type Row,
} from './db.ts'
import { json, notFound, nowIso, readBody } from './http.ts'
import { routeKey } from './proxy/route.ts'
import type { RouteContext } from './router.ts'
import { localDate, localTime } from './trips/booking-time.ts'
import { getBudgetPerPerson } from './trips/budget.ts'
import { todayIn } from './trips/expenses.ts'
import { toLodging } from './trips/lodging.ts'

/** GET /api/trips/:id/shares (owner): active share links, without tokens */
export async function listShares(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'owner', { allowArchived: true })
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM shares WHERE tripId = ? AND revokedAt IS NULL ORDER BY createdAt',
  )
    .bind(auth.trip.id)
    .all<Row>()
  return json({ shares: results.map(toShare) })
}

/** POST /api/trips/:id/shares (owner): `{ options }`; the token is only ever returned here */
export async function createShare(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const { options } = await readBody(c.request, shareCreateSchema)
  const now = nowIso()
  const id = crypto.randomUUID()
  const shareToken = generateToken()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'shares', {
      id,
      tripId: auth.trip.id,
      tokenHash: await hashToken(shareToken),
      options,
      createdByMemberId: auth.member.id,
      createdAt: now,
    }),
  ])
  const body: CreateShareResponse = {
    share: { id, tripId: auth.trip.id, options, createdAt: now, revokedAt: null },
    shareToken,
    rev,
  }
  return json(body, 201)
}

/** DELETE /api/trips/:id/shares/:sid (owner): revoke */
export async function revokeShare(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const row = await db
    .prepare('SELECT id FROM shares WHERE id = ? AND tripId = ? AND revokedAt IS NULL')
    .bind(c.params.sid, auth.trip.id)
    .first<Row>()
  if (!row) throw notFound('share not found')
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('UPDATE shares SET revokedAt = ? WHERE id = ?').bind(nowIso(), c.params.sid),
  ])
  return json({ ok: true, rev })
}

// ---- GET /api/share/:token ----------------------------------------------------------------------

/** The public share payload is never cached by anyone and never indexed */
export const SHARE_HEADERS = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' }

const SHARE_DEFAULTS: ShareOptions = { hideMoney: false, hideAddresses: false, showRecap: false }

/** Leg modes the route cache knows (worker/proxy/route.ts); a campervan is routed as a car */
const ROUTE_MODE: Partial<Record<LegMode, RouteMode>> = {
  drive: 'drive',
  campervan: 'drive',
  walk: 'walk',
  cycle: 'cycle',
}

/** D1 allows 100 bound parameters per statement */
const KEYS_PER_QUERY = 90

function cacheKeyFor(from: LatLng, to: LatLng, mode: LegMode): string | null {
  const routeMode = ROUTE_MODE[mode]
  return routeMode ? routeKey({ from, to, mode: routeMode }) : null
}

/** Cached routes for the given keys; read-only: the share endpoint never calls a provider */
async function readRouteCache(
  db: D1Database,
  keys: Set<string>,
): Promise<Map<string, RouteResult>> {
  const found = new Map<string, RouteResult>()
  const list = [...keys]
  for (let i = 0; i < list.length; i += KEYS_PER_QUERY) {
    const chunk = list.slice(i, i + KEYS_PER_QUERY)
    const marks = chunk.map(() => '?').join(', ')
    const { results } = await db
      .prepare(`SELECT key, distanceM, durationS FROM routeCache WHERE key IN (${marks})`)
      .bind(...chunk)
      .all<Row>()
    for (const r of results) {
      found.set(String(r.key), { distanceM: Number(r.distanceM), durationS: Number(r.durationS) })
    }
  }
  return found
}

/** A stop as the share page sees it: allow-listed fields only, hidden ones left out entirely */
function shareStop(stop: Stop, place: Place | undefined, options: ShareOptions): ShareStop {
  const out: ShareStop = {
    order: stop.order,
    type: stop.type,
    name: stop.title || place?.nameLocal || place?.nameEn || '',
    note: stop.note,
    booking: stop.booking,
    isBackup: stop.isBackup,
  }
  if (!stop.title && place?.nameEn && place.nameEn !== out.name) out.nameEn = place.nameEn
  if (place) {
    out.lat = place.lat
    out.lng = place.lng
    if (!options.hideAddresses && place.address) out.address = place.address
  }
  if (stop.startAt) out.startAt = stop.startAt
  if (stop.endAt) out.endAt = stop.endAt
  if (stop.durationMin !== null) out.durationMin = stop.durationMin
  if (!options.hideMoney && stop.costMinor !== null && stop.currency) {
    out.costMinor = stop.costMinor
    out.currency = stop.currency
  }
  return out
}

/** Photos a day card shows */
const DAY_PHOTOS = 3
/** Picks the share page lists */
const MAX_PICKS = 24
/** Overnight lines shorter than this are not drawn (the same campsite two nights) */
const MIN_OVERNIGHT_M = 50

/** Which estimate row a stop's cost goes to */
const STOP_CATEGORY: Record<StopType, EstimateCategory> = {
  sight: 'activity',
  food: 'food',
  shopping: 'shopping',
  supplies: 'shopping',
  lodging: 'lodging',
  transport: 'transport',
  fuel: 'transport',
  rest: 'other',
  other: 'other',
}

export interface PricedItem {
  category: EstimateCategory
  minor: number
  currency: string
}

/** Sums priced items per currency (no exchange rates): the base currency on top, others listed */
export function buildEstimate(
  items: readonly PricedItem[],
  baseCurrency: string,
  memberCount: number,
): ShareEstimate | undefined {
  const byCurrency = new Map<string, Map<EstimateCategory, number>>()
  for (const item of items) {
    const sums = byCurrency.get(item.currency) ?? new Map<EstimateCategory, number>()
    sums.set(item.category, (sums.get(item.category) ?? 0) + item.minor)
    byCurrency.set(item.currency, sums)
  }
  if (byCurrency.size === 0) return undefined
  const people = Math.max(1, memberCount)
  const sumsOf = (currency: string, sums: Map<EstimateCategory, number>): EstimateCurrency => {
    const breakdown = ESTIMATE_CATEGORIES.filter((c) => (sums.get(c) ?? 0) > 0).map((category) => ({
      category,
      minor: sums.get(category) ?? 0,
    }))
    const totalMinor = breakdown.reduce((sum, line) => sum + line.minor, 0)
    return { currency, totalMinor, perPersonMinor: Math.round(totalMinor / people), breakdown }
  }
  const estimate: ShareEstimate = { currency: baseCurrency, breakdown: [], others: [] }
  const base = byCurrency.get(baseCurrency)
  if (base) {
    const own = sumsOf(baseCurrency, base)
    estimate.totalMinor = own.totalMinor
    estimate.perPersonMinor = own.perPersonMinor
    estimate.breakdown = own.breakdown
  }
  estimate.others = [...byCurrency.entries()]
    .filter(([currency]) => currency !== baseCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sums]) => sumsOf(currency, sums))
  return estimate
}

/**
 * The per-person figure prefers the trip's budget (E9, getBudgetPerPerson) over the priced items
 * split over the members; the item sums by category stay as they are. A budget alone (nothing
 * priced) still makes an estimate.
 */
export function withBudget(
  estimate: ShareEstimate | undefined,
  budget: { currency: string; perPersonMinor: number; totalMinor: number } | null,
  baseCurrency: string,
): ShareEstimate | undefined {
  if (!budget || budget.currency !== baseCurrency) {
    if (estimate) estimate.perPersonSource = 'items'
    return estimate
  }
  const out: ShareEstimate = estimate ?? { currency: baseCurrency, breakdown: [], others: [] }
  out.perPersonMinor = budget.perPersonMinor
  out.budgetTotalMinor = budget.totalMinor
  out.perPersonSource = 'budget'
  return out
}

/** Great-circle metres, enough to drop zero-length lines */
function distanceM(a: SharePoint, b: SharePoint): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

type NamedPoint = SharePoint & { name: string }

export interface DayEnds {
  /** 1-based */
  dayIndex: number
  /** First and last located stops (not rainy-day backups) */
  first?: NamedPoint
  last?: NamedPoint
  /** Tonight's lodging, when it has a place */
  lodging?: NamedPoint
}

/**
 * Day N's line runs from where it starts (where the previous day slept, or Day 1's first stop) to
 * where it sleeps (tonight's lodging, else its last stop). Days without any point are skipped, so
 * the line stays continuous.
 */
export function overnightLines(days: readonly DayEnds[]): ShareOvernight[] {
  const lines: ShareOvernight[] = []
  let previous: SharePoint | undefined
  for (const day of [...days].sort((a, b) => a.dayIndex - b.dayIndex)) {
    const sleep = day.lodging ?? day.last
    if (!sleep) continue
    const start = previous ?? day.first
    if (start && distanceM(start, sleep) >= MIN_OVERNIGHT_M) {
      lines.push({
        dayIndex: day.dayIndex,
        from: { lat: start.lat, lng: start.lng },
        to: { lat: sleep.lat, lng: sleep.lng },
        toName: sleep.name,
        toLodging: !!day.lodging,
      })
    }
    previous = sleep
  }
  return lines
}

/** Images a pick may show from another site: https only */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return new URL(value).protocol === 'https:' ? value : undefined
  } catch {
    return undefined
  }
}

/** A lodging as a row of the bookings summary; dates are the trip's, times HH:mm in its zone */
function lodgingRow(l: Lodging, options: ShareOptions): ShareBooking {
  const out: ShareBooking = {
    kind: 'lodging',
    title: l.name,
    startDate: l.checkIn,
    endDate: l.checkOut,
    payStatus: l.payStatus,
  }
  if (l.checkInTime) out.startTime = l.checkInTime
  if (l.checkOutTime) out.endTime = l.checkOutTime
  if (!options.hideAddresses && l.ref) out.ref = l.ref
  if (!options.hideMoney && l.priceMinor !== null && l.currency) {
    out.priceMinor = l.priceMinor
    out.currency = l.currency
  }
  return out
}

/**
 * A transport or activity booking as a row of the bookings summary: local dates and times in the
 * zone each end was entered in (startTz, else the trip's; endTz, else the start's)
 */
export function bookingRow(r: Row, tripTz: string, options: ShareOptions): ShareBooking {
  const out: ShareBooking = {
    kind: String(r.type) as BookingType,
    title: String(r.title),
    payStatus: String(r.payStatus) as PayStatus,
  }
  const startTz = r.startTz ? String(r.startTz) : tripTz
  const endTz = r.endTz ? String(r.endTz) : startTz
  if (r.startAt) {
    out.startDate = localDate(String(r.startAt), startTz)
    out.startTime = localTime(String(r.startAt), startTz)
  }
  if (r.endAt) {
    out.endDate = localDate(String(r.endAt), endTz)
    out.endTime = localTime(String(r.endAt), endTz)
  }
  if (!options.hideAddresses && r.ref) out.ref = String(r.ref)
  if (!options.hideMoney && r.priceMinor !== null && r.priceMinor !== undefined && r.currency) {
    out.priceMinor = Number(r.priceMinor)
    out.currency = String(r.currency)
  }
  return out
}

/** Rows by local start (date, then time); undated ones keep their order at the end */
function byStart(a: ShareBooking, b: ShareBooking): number {
  if (!a.startDate || !b.startDate) return (a.startDate ? 0 : 1) - (b.startDate ? 0 : 1)
  return (
    a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '')
  )
}

/** GET /api/share/:token: public, read-only, filtered on the server by the share's options */
export async function publicShare(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const token = c.params.token
  const row = isTokenShaped(token)
    ? await db
        .prepare(
          `SELECT s.options AS shareOptions, t.* FROM shares s JOIN trips t ON t.id = s.tripId
            WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND t.deletedAt IS NULL`,
        )
        .bind(await hashToken(token))
        .first<Row>()
    : null
  if (!row) {
    // Same body as every API error, but with the share headers (not cached, not indexed)
    const error: ApiErrorBody = { error: { code: 'not_found', message: 'share not found' } }
    return Response.json(error, { status: 404, headers: SHARE_HEADERS })
  }
  const trip = toTrip(row)
  const options: ShareOptions = {
    ...SHARE_DEFAULTS,
    ...toShare({ options: row.shareOptions }).options,
  }
  // Recap (e8-t04): only when the share asks for it and the trip is over in its own zone
  const showRecap = options.showRecap && todayIn(trip.tz) > trip.endDate

  const [
    dayRows,
    stopRows,
    placeRows,
    legRows,
    memberCount,
    lodgingRows,
    bookingRows,
    itemRows,
    voteRows,
    photoRows,
  ] = await Promise.all([
    db
      .prepare('SELECT * FROM days WHERE tripId = ? AND idx IS NOT NULL ORDER BY idx, date, id')
      .bind(trip.id)
      .all<Row>(),
    db
      .prepare('SELECT * FROM stops WHERE tripId = ? ORDER BY "order", id')
      .bind(trip.id)
      .all<Row>(),
    db.prepare('SELECT * FROM places WHERE tripId = ?').bind(trip.id).all<Row>(),
    db.prepare('SELECT * FROM legOverrides WHERE tripId = ?').bind(trip.id).all<Row>(),
    db
      .prepare('SELECT COUNT(*) AS n FROM members WHERE tripId = ? AND removedAt IS NULL')
      .bind(trip.id)
      .first<number>('n'),
    db
      .prepare('SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL ORDER BY checkIn, id')
      .bind(trip.id)
      .all<Row>(),
    db
      .prepare(
        `SELECT id, type, title, startAt, endAt, startTz, endTz, priceMinor, currency, payStatus, ref
           FROM bookings WHERE tripId = ? AND deletedAt IS NULL ORDER BY startAt IS NULL, startAt, id`,
      )
      .bind(trip.id)
      .all<Row>(),
    db
      .prepare(
        `SELECT * FROM wishlistItems WHERE tripId = ? AND deletedAt IS NULL AND status != 'dropped'
          ORDER BY "order", id`,
      )
      .bind(trip.id)
      .all<Row>(),
    db
      .prepare(
        `SELECT v.itemId AS itemId, COUNT(*) AS n FROM wishlistVotes v
           JOIN wishlistItems i ON i.id = v.itemId
           JOIN members m ON m.id = v.memberId AND m.removedAt IS NULL
          WHERE i.tripId = ? GROUP BY v.itemId`,
      )
      .bind(trip.id)
      .all<Row>(),
    // Only photos meant for share pages (CLAUDE.md rule 5); GET /api/media checks it again
    db
      .prepare(
        `SELECT id, dayId, stopId FROM attachments
          WHERE tripId = ? AND kind = 'photo' AND status = 'ready' AND deletedAt IS NULL
            AND visibility = 'trip'
          ORDER BY takenAt IS NULL, takenAt, createdAt, id`,
      )
      .bind(trip.id)
      .all<Row>(),
  ])
  const recapRows = showRecap
    ? (
        await db
          .prepare("SELECT dayId, body FROM dayRecaps WHERE tripId = ? AND body != ''")
          .bind(trip.id)
          .all<Row>()
      ).results
    : []
  const recapByDay = new Map(recapRows.map((r) => [String(r.dayId), String(r.body)]))

  const places = new Map(placeRows.results.map((r) => [String(r.id), toPlace(r)]))
  const overrides: Record<string, LegChoice> = {}
  for (const leg of legRows.results.map(toLeg)) {
    overrides[legKey(leg.fromStopId, leg.toStopId)] =
      leg.minutes === null ? { mode: leg.mode } : { mode: leg.mode, minutes: leg.minutes }
  }
  const allStops = stopRows.results.map(toStop)
  const stopsByDay = new Map<string, Stop[]>()
  for (const stop of allStops) {
    const list = stopsByDay.get(stop.dayId) ?? []
    list.push(stop)
    stopsByDay.set(stop.dayId, list)
  }
  const days = dayRows.results.map(toDay)
  const dayIndexById = new Map(days.map((d) => [d.id, d.idx ?? 0]))
  const dayOfStop = new Map(allStops.map((s) => [s.id, s.dayId]))
  const lodgings = lodgingRows.results.map(toLodging)
  const lodgingById = new Map(lodgings.map((l) => [l.id, l]))

  // Shareable photos per day (the day's own and its stops'), already in takenAt order
  const photoIds = new Set<string>()
  const photosByDay = new Map<string, string[]>()
  const recapPhotosByDay = new Map<string, string[]>()
  for (const r of photoRows.results) {
    const id = String(r.id)
    photoIds.add(id)
    const dayId = r.dayId ? String(r.dayId) : r.stopId ? dayOfStop.get(String(r.stopId)) : undefined
    if (!dayId) continue
    const list = photosByDay.get(dayId) ?? []
    if (list.length < DAY_PHOTOS) list.push(id)
    photosByDay.set(dayId, list)
    if (showRecap) {
      const wall = recapPhotosByDay.get(dayId) ?? []
      if (wall.length < SHARE_RECAP_PHOTOS) wall.push(id)
      recapPhotosByDay.set(dayId, wall)
    }
  }
  const placeOf = (s: Stop) => (s.placeId ? places.get(s.placeId) : undefined)
  const itineraryStops = (stops: Stop[]): ItineraryStop[] =>
    stops.map((s) => ({
      id: s.id,
      lat: placeOf(s)?.lat,
      lng: placeOf(s)?.lng,
      isBackup: s.isBackup,
    }))

  // Pass 1 collects the route-cache keys the legs would look up; pass 2 uses what the cache has
  const wanted = new Set<string>()
  for (const day of days) {
    deriveLegs(itineraryStops(stopsByDay.get(day.id) ?? []), overrides, {
      style: trip.style,
      routeLookup: (from, to, mode) => {
        const key = cacheKeyFor(from, to, mode)
        if (key) wanted.add(key)
        return null
      },
    })
  }
  const cached = wanted.size > 0 ? await readRouteCache(db, wanted) : new Map<string, RouteResult>()

  const shareDays: ShareDay[] = days.map((day) => {
    const stops = stopsByDay.get(day.id) ?? []
    const plain = itineraryStops(stops)
    const legs = deriveLegs(plain, overrides, {
      style: trip.style,
      routeLookup: (from, to, mode) => {
        const key = cacheKeyFor(from, to, mode)
        return key ? cached.get(key) : null
      },
    })
    const summary = summarizeDay(
      plain,
      legs,
      trip.driveLimitMin === null
        ? { style: trip.style }
        : { style: trip.style, limitMinutes: trip.driveLimitMin },
    )
    const orderOf = new Map(stops.map((s) => [s.id, s.order]))
    const tonight = day.lodgingId ? lodgingById.get(day.lodgingId) : undefined
    const leaving = day.date ? lodgings.find((l) => l.checkOut === day.date) : undefined
    const out: ShareDay = {
      index: day.idx ?? 0,
      date: day.date,
      title: day.title,
      color: day.color,
      note: day.note,
      lodgingName: tonight?.name ?? null,
      photoIds: photosByDay.get(day.id) ?? [],
      stops: stops.map((s) => shareStop(s, placeOf(s), options)),
      legs: legs.map((leg): ShareLeg => ({
        fromOrder: orderOf.get(leg.fromStopId) ?? 0,
        toOrder: orderOf.get(leg.toStopId) ?? 0,
        mode: leg.mode,
        distanceM: leg.distanceM,
        durationS: leg.durationS,
        source: leg.source,
      })),
      driveMinutes: summary.driveMinutes,
      distanceM: summary.distanceM,
    }
    if (leaving?.checkOutTime) out.checkoutTime = leaving.checkOutTime
    if (tonight?.campType) out.campType = tonight.campType
    if (showRecap) {
      const recap = recapByDay.get(day.id)
      if (recap) out.recapBody = recap
      out.recapPhotoIds = recapPhotosByDay.get(day.id) ?? []
    }
    return out
  })

  // Whole-trip route: lodgings where they have a place, else the day's first and last stops
  const located = (s: Stop): NamedPoint | undefined => {
    const place = placeOf(s)
    return place && !s.isBackup
      ? { lat: place.lat, lng: place.lng, name: s.title || place.nameLocal || place.nameEn }
      : undefined
  }
  const overnight = overnightLines(
    days.map((day): DayEnds => {
      const points = (stopsByDay.get(day.id) ?? [])
        .map(located)
        .filter((p): p is NamedPoint => !!p)
      const tonight = day.lodgingId ? lodgingById.get(day.lodgingId) : undefined
      const lodgingPlace = tonight?.placeId ? places.get(tonight.placeId) : undefined
      const ends: DayEnds = { dayIndex: day.idx ?? 0 }
      if (points.length > 0) {
        ends.first = points[0]
        ends.last = points[points.length - 1]
      }
      if (tonight && lodgingPlace) {
        ends.lodging = { lat: lodgingPlace.lat, lng: lodgingPlace.lng, name: tonight.name }
      }
      return ends
    }),
  )

  // Picks: not dropped; with an image first, then the most wanted; photos only if shareable
  const votes = new Map(voteRows.results.map((r) => [String(r.itemId), Number(r.n)]))
  const hasImage = (p: SharePick) => (p.photoAttachmentId || p.sourceImageUrl ? 0 : 1)
  const picks = itemRows.results
    .map((r, position) => {
      const place = r.placeId ? places.get(String(r.placeId)) : undefined
      const pick: SharePick = {
        category: String(r.category) as WishlistCategory,
        name: String(r.name),
        votes: votes.get(String(r.id)) ?? 0,
      }
      // The item's own name wins; the place's English name only stands in for its local name
      if (place?.nameEn && pick.name === place.nameLocal && place.nameEn !== pick.name) {
        pick.nameEn = place.nameEn
      }
      if (!options.hideMoney && r.estMinor !== null && r.estMinor !== undefined && r.currency) {
        pick.estMinor = Number(r.estMinor)
        pick.currency = String(r.currency)
      }
      if (r.photoAttachmentId && photoIds.has(String(r.photoAttachmentId))) {
        pick.photoAttachmentId = String(r.photoAttachmentId)
      }
      const imageUrl = httpsUrl(r.sourceImageUrl)
      if (imageUrl) pick.sourceImageUrl = imageUrl
      if (place) {
        pick.place = {
          lat: place.lat,
          lng: place.lng,
          nameLocal: place.nameLocal,
          nameEn: place.nameEn,
        }
      }
      const dayId = r.stopId ? dayOfStop.get(String(r.stopId)) : undefined
      const dayIndex = dayId ? dayIndexById.get(dayId) : undefined
      if (dayIndex) pick.dayIndex = dayIndex
      return { pick, position }
    })
    .sort(
      (a, b) =>
        hasImage(a.pick) - hasImage(b.pick) ||
        b.pick.votes - a.pick.votes ||
        a.position - b.position,
    )
    .slice(0, MAX_PICKS)
    .map(({ pick }) => pick)

  const shareTrip: ShareTrip = {
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    tz: trip.tz,
    coverColor: trip.coverColor,
    summary: trip.summary,
    style: trip.style,
    memberCount: Number(memberCount ?? 0),
    dayCount: shareDays.length,
  }
  if (trip.coverAttachmentId && photoIds.has(trip.coverAttachmentId)) {
    shareTrip.coverAttachmentId = trip.coverAttachmentId
  }

  const body: SharePayload = {
    trip: shareTrip,
    days: shareDays,
    overnight,
    picks,
    bookings: [
      ...lodgings.map((l) => lodgingRow(l, options)),
      ...bookingRows.results.map((r) => bookingRow(r, trip.tz, options)),
    ].sort(byStart),
    options,
    generatedAt: nowIso(),
  }

  if (!options.hideMoney) {
    shareTrip.baseCurrency = trip.baseCurrency
    // A stop made from a priced booking or lodging would count that price twice
    const priced = bookingRows.results.filter(
      (r) => r.priceMinor !== null && r.priceMinor !== undefined && r.currency,
    )
    const pricedBookings = new Set(priced.map((r) => String(r.id)))
    const pricedLodgings = new Set(
      lodgings.filter((l) => l.priceMinor !== null && l.currency).map((l) => l.id),
    )
    const lodgingOfStop = new Map(
      stopRows.results.map((r) => [String(r.id), r.lodgingId ? String(r.lodgingId) : null]),
    )
    const items: PricedItem[] = []
    for (const stop of allStops) {
      if (!dayIndexById.has(stop.dayId) || stop.isBackup) continue
      if (stop.costMinor === null || !stop.currency || stop.costMinor <= 0) continue
      if (stop.bookingId && pricedBookings.has(stop.bookingId)) continue
      const lodgingId = lodgingOfStop.get(stop.id)
      if (lodgingId && pricedLodgings.has(lodgingId)) continue
      items.push({
        category: STOP_CATEGORY[stop.type],
        minor: stop.costMinor,
        currency: stop.currency,
      })
    }
    for (const l of lodgings) {
      if (l.priceMinor !== null && l.currency && l.priceMinor > 0) {
        items.push({ category: 'lodging', minor: l.priceMinor, currency: l.currency })
      }
    }
    for (const r of priced) {
      const minor = Number(r.priceMinor)
      if (minor <= 0) continue
      items.push({
        category: r.type === 'activity' ? 'activity' : 'transport',
        minor,
        currency: String(r.currency),
      })
    }
    const estimate = withBudget(
      buildEstimate(items, trip.baseCurrency, shareTrip.memberCount),
      await getBudgetPerPerson(db, trip.id),
      trip.baseCurrency,
    )
    if (estimate) {
      body.estimate = estimate
      if (estimate.perPersonMinor !== undefined) {
        shareTrip.estimatedPerPersonMinor = estimate.perPersonMinor
      }
    }
  }
  return Response.json(body, { headers: SHARE_HEADERS })
}

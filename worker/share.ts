// Share links (e1-t01) and the public share payload (e8-t01a). Hiding happens here, on the server:
// the public endpoint builds its answer field by field from an allow-list, so nothing hidden ever
// leaves the Worker (CLAUDE.md rule 4).

import type { RouteMode } from '../shared/api/geo.ts'
import type { ShareDay, ShareLeg, SharePayload, ShareStop, ShareTrip } from '../shared/api/share.ts'
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

  const [dayRows, stopRows, placeRows, legRows, memberCount] = await Promise.all([
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
  ])

  const places = new Map(placeRows.results.map((r) => [String(r.id), toPlace(r)]))
  const overrides: Record<string, LegChoice> = {}
  for (const leg of legRows.results.map(toLeg)) {
    overrides[legKey(leg.fromStopId, leg.toStopId)] =
      leg.minutes === null ? { mode: leg.mode } : { mode: leg.mode, minutes: leg.minutes }
  }
  const stopsByDay = new Map<string, Stop[]>()
  for (const stop of stopRows.results.map(toStop)) {
    const list = stopsByDay.get(stop.dayId) ?? []
    list.push(stop)
    stopsByDay.set(stop.dayId, list)
  }
  const days = dayRows.results.map(toDay)
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
    return {
      index: day.idx ?? 0,
      date: day.date,
      title: day.title,
      color: day.color,
      note: day.note,
      lodgingName: null,
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
  })

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
  if (!options.hideMoney) shareTrip.baseCurrency = trip.baseCurrency

  const body: SharePayload = { trip: shareTrip, days: shareDays, options, generatedAt: nowIso() }
  return Response.json(body, { headers: SHARE_HEADERS })
}

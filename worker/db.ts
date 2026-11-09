// D1 helpers: row mappers (TEXT JSON and 0/1 booleans back to their types), a whitelisted UPDATE
// builder for PATCH bodies, and the trip-level rev bump that every write ends with.

import type {
  Day,
  Invite,
  LegOverride,
  Member,
  Place,
  Share,
  Stop,
  Trip,
} from '../shared/api/types.ts'

export type Row = Record<string, unknown>
type DbValue = string | number | null

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))
const num = (v: unknown): number => Number(v)
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export function toTrip(r: Row): Trip {
  return {
    id: str(r.id),
    name: str(r.name),
    destination: str(r.destination),
    centerLat: numOrNull(r.centerLat),
    centerLng: numOrNull(r.centerLng),
    startDate: str(r.startDate),
    endDate: str(r.endDate),
    tz: str(r.tz),
    baseCurrency: str(r.baseCurrency),
    secondaryCurrency: strOrNull(r.secondaryCurrency),
    localCurrencies: parseJson<string[]>(r.localCurrencies, []),
    coverColor: strOrNull(r.coverColor),
    coverAttachmentId: strOrNull(r.coverAttachmentId),
    summary: str(r.summary),
    style: str(r.style) as Trip['style'],
    driveLimitMin: numOrNull(r.driveLimitMin),
    ownerMemberId: str(r.ownerMemberId),
    rev: num(r.rev),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    archivedAt: strOrNull(r.archivedAt),
    deletedAt: strOrNull(r.deletedAt),
  }
}

export function toMember(r: Row): Member {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    name: str(r.name),
    color: str(r.color),
    email: strOrNull(r.email),
    role: str(r.role) as Member['role'],
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
  }
}

export function toDay(r: Row): Day {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    date: strOrNull(r.date),
    idx: numOrNull(r.idx),
    title: str(r.title),
    color: strOrNull(r.color),
    note: str(r.note),
    lodgingId: strOrNull(r.lodgingId),
    rev: num(r.rev),
    updatedAt: str(r.updatedAt),
  }
}

export function toStop(r: Row): Stop {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    dayId: str(r.dayId),
    order: num(r.order),
    type: str(r.type) as Stop['type'],
    title: str(r.title),
    placeId: strOrNull(r.placeId),
    startAt: strOrNull(r.startAt),
    endAt: strOrNull(r.endAt),
    durationMin: numOrNull(r.durationMin),
    costMinor: numOrNull(r.costMinor),
    currency: strOrNull(r.currency),
    booking: str(r.booking) as Stop['booking'],
    note: str(r.note),
    links: parseJson<Stop['links']>(r.links, []),
    wishlistItemId: strOrNull(r.wishlistItemId),
    bookingId: strOrNull(r.bookingId),
    isBackup: num(r.isBackup) === 1,
    rev: num(r.rev),
    updatedAt: str(r.updatedAt),
  }
}

export function toLeg(r: Row): LegOverride {
  return {
    tripId: str(r.tripId),
    fromStopId: str(r.fromStopId),
    toStopId: str(r.toStopId),
    mode: str(r.mode) as LegOverride['mode'],
    minutes: numOrNull(r.minutes),
    rev: num(r.rev),
    updatedAt: str(r.updatedAt),
  }
}

export function toPlace(r: Row): Place {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    nameLocal: str(r.nameLocal),
    nameEn: str(r.nameEn),
    lat: num(r.lat),
    lng: num(r.lng),
    address: str(r.address),
    category: str(r.category),
    source: str(r.source) as Place['source'],
    hours: parseJson<Place['hours']>(r.hours, null),
    links: parseJson<Place['links']>(r.links, []),
    rev: num(r.rev),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
  }
}

export function toInvite(r: Row): Invite {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    createdAt: str(r.createdAt),
    revokedAt: strOrNull(r.revokedAt),
  }
}

export function toShare(r: Row): Share {
  return {
    id: str(r.id),
    tripId: str(r.tripId),
    options: parseJson<Share['options']>(r.options, {
      hideMoney: false,
      hideAddresses: false,
      showRecap: false,
    }),
    createdAt: str(r.createdAt),
    revokedAt: strOrNull(r.revokedAt),
  }
}

/** JS value → D1 bind value: booleans 0/1, arrays/objects as JSON text, undefined as null */
export function dbValue(v: unknown): DbValue {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  return JSON.stringify(v)
}

/** INSERT INTO <table> (<keys of record>) VALUES (...) */
export function insertStatement(
  db: D1Database,
  table: string,
  record: Record<string, unknown>,
): D1PreparedStatement {
  const keys = Object.keys(record)
  const columns = keys.map((k) => `"${k}"`).join(', ')
  const placeholders = keys.map(() => '?').join(', ')
  return db
    .prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`)
    .bind(...keys.map((k) => dbValue(record[k])))
}

/**
 * UPDATE <table> SET <cols from patch>, rev = rev + 1, updatedAt = ? WHERE <where>.
 * Only keys listed in `columns` are written (the zod schemas already strip unknown keys).
 * Returns null when the patch has nothing to write.
 */
export function updateStatement(
  db: D1Database,
  table: string,
  patch: Record<string, unknown>,
  columns: readonly string[],
  now: string,
  where: { sql: string; values: DbValue[] },
  { bumpRowRev = true }: { bumpRowRev?: boolean } = {},
): D1PreparedStatement | null {
  const keys = Object.keys(patch).filter((k) => columns.includes(k) && patch[k] !== undefined)
  if (keys.length === 0) return null
  const sets = keys.map((k) => `"${k}" = ?`)
  if (bumpRowRev) sets.push('rev = rev + 1')
  sets.push('updatedAt = ?')
  const values = [...keys.map((k) => dbValue(patch[k])), now, ...where.values]
  return db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${where.sql}`).bind(...values)
}

/**
 * Runs the statements in one D1 batch (a transaction) followed by the trip's rev bump, and returns
 * the new trip rev.
 */
export async function writeWithRev(
  db: D1Database,
  tripId: string,
  statements: D1PreparedStatement[],
): Promise<number> {
  const bump = db.prepare('UPDATE trips SET rev = rev + 1 WHERE id = ? RETURNING rev').bind(tripId)
  const results = await db.batch<{ rev: number }>([...statements, bump])
  const last = results[results.length - 1]
  return Number(last.results[0]?.rev ?? 0)
}

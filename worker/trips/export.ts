// Trip export / import (e8-t03), shared with "clone as template" (e1-t07, worker/trips/clone.ts).
//
// GET /api/trips/:id/export?include=expenses,photos (editor) answers a `TripExport` v1
// (shared/api/export.ts): every entity renumbered with file-local sequential ids, no database ids,
// tokens, emails or R2 keys. POST /api/import (no auth, like POST /api/trips) validates a file
// (shared/schema/export.ts), checks every local reference, moves all dates by the same number of
// days when `startDate` differs, and writes a new trip in one D1 batch. The caller becomes the
// owner and gets the first memberToken. Checklists, the budget, notes (E9) and day recaps (e8-t04)
// are an additive v1 extension: always exported, optional on import. Bulk inserts go through
// `json_each(?)` so a whole table is one statement (D1 counts statements per invocation and allows
// 100 bound parameters each).

import type {
  CopyOptions,
  ExportAttachment,
  ExportBooking,
  ExportBudgetRow,
  ExportChecklist,
  ExportDay,
  ExportDayRecap,
  ExportExpense,
  ExportLeg,
  ExportLodging,
  ExportMember,
  ExportNote,
  ExportPlace,
  ExportStop,
  ExportWishlistItem,
  ImportTripResponse,
  LocalId,
  TripExport,
} from '../../shared/api/export.ts'
import {
  MAX_IMPORT_BYTES,
  TRIP_EXPORT_FORMAT,
  TRIP_EXPORT_VERSION,
} from '../../shared/api/export.ts'
import { bookingDetailsSchemas } from '../../shared/schema/booking.ts'
import { tripImportSchema } from '../../shared/schema/export.ts'
import { MAX_TRIP_DAYS } from '../../shared/schema/trip.ts'
import { utcToZoned, zonedTimeToUtc } from '../../shared/time/tz.ts'
import { authTrip, generateToken, hashToken } from '../auth.ts'
import { dbValue, toMember, toTrip, writeWithRev, type Row } from '../db.ts'
import { ApiError, invalid, json, nowIso } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { addDays, dayCount, planDays } from './day-plan.ts'

// ---- small row helpers ---------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : str(v))
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const bool = (v: unknown): boolean => Number(v) === 1

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

async function rows(db: D1Database, sql: string, ...binds: (string | number)[]): Promise<Row[]> {
  return (
    await db
      .prepare(sql)
      .bind(...binds)
      .all<Row>()
  ).results
}

/** Database id → file-local id, numbering in the order ids are first seen */
class LocalIds {
  private readonly map = new Map<string, LocalId>()

  add(id: unknown): LocalId {
    const key = str(id)
    const existing = this.map.get(key)
    if (existing !== undefined) return existing
    const local = this.map.size + 1
    this.map.set(key, local)
    return local
  }

  ref(id: unknown): LocalId | null {
    if (id === null || id === undefined) return null
    return this.map.get(str(id)) ?? null
  }
}

/** The place references inside booking details (shared/schema/booking.ts) */
const DETAIL_PLACE_KEYS = ['pickupPlaceId', 'dropoffPlaceId', 'meetingPlaceId'] as const

// ---- export ------------------------------------------------------------------------------------

/** Server-side extras of an export that never go into the file (clone uses them for photos) */
export interface ExportInternals {
  /** attachments[].id → the source row (r2Key, thumbKey …) */
  attachmentRows: Map<LocalId, Row>
  /** The trip's cover photo, when photos were exported */
  coverAttachment: LocalId | null
  /** wishlist[].id → attachments[].id of its photo */
  wishlistPhotos: Map<LocalId, LocalId>
  /** Database member id → members[].id */
  memberIds: (memberId: string) => LocalId | null
}

export async function buildExport(
  db: D1Database,
  tripId: string,
  include: { expenses: boolean; photos: boolean },
  now = nowIso(),
): Promise<{ file: TripExport; internals: ExportInternals }> {
  const tripRow = await db.prepare('SELECT * FROM trips WHERE id = ?').bind(tripId).first<Row>()
  if (!tripRow) throw new ApiError(404, 'not_found', 'trip not found')

  const [memberRows, placeRows, dayRows, stopRows, legRows, lodgingRows, bookingRows, itemRows] =
    await Promise.all([
      rows(db, 'SELECT * FROM members WHERE tripId = ? ORDER BY createdAt, id', tripId),
      rows(db, 'SELECT * FROM places WHERE tripId = ? ORDER BY createdAt, id', tripId),
      rows(
        db,
        'SELECT * FROM days WHERE tripId = ? ORDER BY idx IS NULL, idx, date, createdAt, id',
        tripId,
      ),
      rows(db, 'SELECT * FROM stops WHERE tripId = ? ORDER BY dayId, "order", id', tripId),
      rows(db, 'SELECT * FROM legOverrides WHERE tripId = ? ORDER BY fromStopId, toStopId', tripId),
      rows(
        db,
        'SELECT * FROM lodgings WHERE tripId = ? AND deletedAt IS NULL ORDER BY checkIn, createdAt, id',
        tripId,
      ),
      rows(
        db,
        'SELECT * FROM bookings WHERE tripId = ? AND deletedAt IS NULL ORDER BY startAt, createdAt, id',
        tripId,
      ),
      rows(
        db,
        'SELECT * FROM wishlistItems WHERE tripId = ? AND deletedAt IS NULL ORDER BY "order", createdAt, id',
        tripId,
      ),
    ])

  // Removed members only matter for the money history
  const members = new LocalIds()
  const exportMembers: ExportMember[] = memberRows
    .filter((r) => include.expenses || r.removedAt === null)
    .map((r) => ({
      id: members.add(r.id),
      name: str(r.name),
      color: str(r.color),
      role: str(r.role) as ExportMember['role'],
      removed: r.removedAt !== null,
    }))

  // Number every kind first so forward references (day → lodging, stop ↔ wishlist) resolve
  const places = new LocalIds()
  const days = new LocalIds()
  const stops = new LocalIds()
  const lodgings = new LocalIds()
  const bookings = new LocalIds()
  const items = new LocalIds()
  placeRows.forEach((r) => places.add(r.id))
  dayRows.forEach((r) => days.add(r.id))
  // Stops by Day number, then position (dayId itself is a random uuid)
  const dayRank = (r: Row) => days.ref(r.dayId) ?? Number.MAX_SAFE_INTEGER
  stopRows.sort(
    (a, b) =>
      dayRank(a) - dayRank(b) ||
      Number(a.order) - Number(b.order) ||
      str(a.createdAt).localeCompare(str(b.createdAt)) ||
      str(a.id).localeCompare(str(b.id)),
  )
  stopRows.forEach((r) => stops.add(r.id))
  lodgingRows.forEach((r) => lodgings.add(r.id))
  bookingRows.forEach((r) => bookings.add(r.id))
  itemRows.forEach((r) => items.add(r.id))

  const exportPlaces: ExportPlace[] = placeRows.map((r) => ({
    id: places.add(r.id),
    nameLocal: str(r.nameLocal),
    nameEn: str(r.nameEn),
    lat: Number(r.lat),
    lng: Number(r.lng),
    address: str(r.address),
    category: str(r.category),
    source: str(r.source) as ExportPlace['source'],
    hours: parseJson<ExportPlace['hours']>(r.hours, null),
    links: parseJson<ExportPlace['links']>(r.links, []),
  }))

  const exportDays: ExportDay[] = dayRows.map((r) => ({
    id: days.add(r.id),
    date: strOrNull(r.date),
    idx: numOrNull(r.idx),
    title: str(r.title),
    color: strOrNull(r.color),
    note: str(r.note),
    lodging: lodgings.ref(r.lodgingId),
  }))

  const exportStops: ExportStop[] = stopRows
    .filter((r) => days.ref(r.dayId) !== null)
    .map((r) => ({
      id: stops.add(r.id),
      day: days.ref(r.dayId) as LocalId,
      order: Number(r.order),
      type: str(r.type) as ExportStop['type'],
      title: str(r.title),
      place: places.ref(r.placeId),
      startAt: strOrNull(r.startAt),
      endAt: strOrNull(r.endAt),
      durationMin: numOrNull(r.durationMin),
      costMinor: numOrNull(r.costMinor),
      currency: strOrNull(r.currency),
      booking: str(r.booking) as ExportStop['booking'],
      note: str(r.note),
      links: parseJson<ExportStop['links']>(r.links, []),
      wishlistItem: items.ref(r.wishlistItemId),
      bookingRef: bookings.ref(r.bookingId),
      source: str(r.source ?? 'manual') || 'manual',
      bookingSlot: strOrNull(r.bookingSlot),
      lodging: lodgings.ref(r.lodgingId),
      isBackup: bool(r.isBackup),
    }))

  const exportLegs: ExportLeg[] = []
  for (const r of legRows) {
    const from = stops.ref(r.fromStopId)
    const to = stops.ref(r.toStopId)
    if (from === null || to === null) continue
    exportLegs.push({
      from,
      to,
      mode: str(r.mode) as ExportLeg['mode'],
      minutes: numOrNull(r.minutes),
    })
  }
  exportLegs.sort((a, b) => a.from - b.from || a.to - b.to)

  const exportLodgings: ExportLodging[] = lodgingRows.map((r) => ({
    id: lodgings.add(r.id),
    place: places.ref(r.placeId),
    name: str(r.name),
    checkIn: str(r.checkIn),
    checkOut: str(r.checkOut),
    checkInTime: strOrNull(r.checkInTime),
    checkOutTime: strOrNull(r.checkOutTime),
    roomType: strOrNull(r.roomType),
    guests: numOrNull(r.guests),
    platform: strOrNull(r.platform),
    ref: strOrNull(r.ref),
    priceMinor: numOrNull(r.priceMinor),
    currency: strOrNull(r.currency),
    payStatus: str(r.payStatus) as ExportLodging['payStatus'],
    cancelBy: strOrNull(r.cancelBy),
    phone: strOrNull(r.phone),
    campType: strOrNull(r.campType) as ExportLodging['campType'],
    campFacilities: parseJson<ExportLodging['campFacilities']>(r.campFacilities, null),
    note: str(r.note),
  }))

  const exportBookings: ExportBooking[] = bookingRows.map((r) => {
    const details = parseJson<Record<string, unknown>>(r.details, {})
    for (const key of DETAIL_PLACE_KEYS) {
      if (details[key] === undefined) continue
      const local = places.ref(details[key])
      if (local === null) delete details[key]
      else details[key] = local
    }
    return {
      id: bookings.add(r.id),
      type: str(r.type) as ExportBooking['type'],
      title: str(r.title),
      details,
      startAt: strOrNull(r.startAt),
      endAt: strOrNull(r.endAt),
      startTz: strOrNull(r.startTz),
      endTz: strOrNull(r.endTz),
      priceMinor: numOrNull(r.priceMinor),
      currency: strOrNull(r.currency),
      payStatus: str(r.payStatus) as ExportBooking['payStatus'],
      payer: members.ref(r.payerMemberId),
      cancelBy: strOrNull(r.cancelBy),
      ref: strOrNull(r.ref),
      note: str(r.note),
    }
  })

  const [voteRows, claimRows] = await Promise.all([
    rows(
      db,
      `SELECT v.itemId, v.memberId FROM wishlistVotes v JOIN wishlistItems w ON w.id = v.itemId
        WHERE w.tripId = ? ORDER BY v.createdAt, v.memberId`,
      tripId,
    ),
    rows(
      db,
      `SELECT c.* FROM wishlistClaims c JOIN wishlistItems w ON w.id = c.itemId
        WHERE w.tripId = ? ORDER BY c.createdAt, c.id`,
      tripId,
    ),
  ])
  const exportItems: ExportWishlistItem[] = itemRows.map((r) => ({
    id: items.add(r.id),
    category: str(r.category) as ExportWishlistItem['category'],
    name: str(r.name),
    place: places.ref(r.placeId),
    estMinor: numOrNull(r.estMinor),
    currency: strOrNull(r.currency),
    sourceUrl: strOrNull(r.sourceUrl),
    sourceTitle: strOrNull(r.sourceTitle),
    sourceImageUrl: strOrNull(r.sourceImageUrl),
    recommender: members.ref(r.recommenderMemberId),
    note: str(r.note),
    status: str(r.status) as ExportWishlistItem['status'],
    stop: stops.ref(r.stopId),
    order: Number(r.order),
    votes: voteRows
      .filter((v) => v.itemId === r.id)
      .map((v) => members.ref(v.memberId))
      .filter((m): m is LocalId => m !== null)
      .sort((a, b) => a - b),
    claims: claimRows
      .filter((c) => c.itemId === r.id)
      .map((c) => ({
        buyer: members.ref(c.buyerMemberId),
        forName: str(c.forName),
        qty: Number(c.qty),
        done: bool(c.done),
      })),
  }))

  // Prep data (E9) and day recaps (e8-t04): always part of the file
  const [checklistRows, checklistItemRows, budgetRows, noteRows, recapRows] = await Promise.all([
    rows(
      db,
      'SELECT * FROM checklists WHERE tripId = ? ORDER BY kind, "order", createdAt, id',
      tripId,
    ),
    rows(
      db,
      'SELECT * FROM checklistItems WHERE tripId = ? ORDER BY checklistId, "order", createdAt, id',
      tripId,
    ),
    rows(db, 'SELECT * FROM budgets WHERE tripId = ? ORDER BY category', tripId),
    rows(db, 'SELECT * FROM notes WHERE tripId = ? ORDER BY "order", createdAt, id', tripId),
    rows(db, "SELECT * FROM dayRecaps WHERE tripId = ? AND body != ''", tripId),
  ])
  const checklistIds = new LocalIds()
  const exportChecklists: ExportChecklist[] = checklistRows.map((r) => ({
    id: checklistIds.add(r.id),
    kind: str(r.kind) as ExportChecklist['kind'],
    title: str(r.title),
    order: Number(r.order),
    templateKey: strOrNull(r.templateKey),
    items: checklistItemRows
      .filter((i) => i.checklistId === r.id)
      .map((i) => ({
        text: str(i.text),
        note: str(i.note),
        done: bool(i.done),
        assignee: members.ref(i.assigneeMemberId),
        dueAt: strOrNull(i.dueAt),
        order: Number(i.order),
        templateKey: strOrNull(i.templateKey),
        linkHint: parseJson<ExportChecklist['items'][number]['linkHint']>(i.linkHint, null),
      })),
  }))
  const exportBudgets: ExportBudgetRow[] = budgetRows.map((r) => ({
    category: str(r.category) as ExportBudgetRow['category'],
    plannedMinor: Number(r.plannedMinor),
    currency: str(r.currency),
    perPerson: bool(r.perPerson),
  }))
  const exportNotes: ExportNote[] = noteRows.map((r) => ({
    section: str(r.section) as ExportNote['section'],
    title: str(r.title),
    body: str(r.body),
    order: Number(r.order),
    templateKey: strOrNull(r.templateKey),
    shareable: bool(r.shareable),
  }))
  const exportRecaps: ExportDayRecap[] = recapRows
    .flatMap((r) => {
      const day = days.ref(r.dayId)
      return day === null ? [] : [{ day, body: str(r.body) }]
    })
    .sort((a, b) => a.day - b.day)

  const trip = toTrip(tripRow)
  const file: TripExport = {
    format: TRIP_EXPORT_FORMAT,
    version: TRIP_EXPORT_VERSION,
    exportedAt: now,
    includes: { ...include },
    trip: {
      name: trip.name,
      destination: trip.destination,
      centerLat: trip.centerLat,
      centerLng: trip.centerLng,
      startDate: trip.startDate,
      endDate: trip.endDate,
      tz: trip.tz,
      baseCurrency: trip.baseCurrency,
      secondaryCurrency: trip.secondaryCurrency,
      localCurrencies: trip.localCurrencies,
      coverColor: trip.coverColor,
      summary: trip.summary,
      style: trip.style,
      driveLimitMin: trip.driveLimitMin,
      poolRefundMode: str(tripRow.poolRefundMode) === 'equal' ? 'equal' : 'proportional',
      fxOverrides: parseJson<Record<string, number>>(tripRow.fxOverrides, {}),
    },
    members: exportMembers,
    days: exportDays,
    places: exportPlaces,
    stops: exportStops,
    legOverrides: exportLegs,
    lodgings: exportLodgings,
    bookings: exportBookings,
    wishlist: exportItems,
    checklists: exportChecklists,
    budgets: exportBudgets,
    notes: exportNotes,
    dayRecaps: exportRecaps,
  }

  if (include.expenses) {
    const [expenseRows, shareRows, poolRows, settlementRows] = await Promise.all([
      rows(
        db,
        'SELECT * FROM expenses WHERE tripId = ? AND deletedAt IS NULL ORDER BY date, createdAt, id',
        tripId,
      ),
      rows(
        db,
        `SELECT s.* FROM expenseShares s JOIN expenses e ON e.id = s.expenseId
          WHERE e.tripId = ? AND e.deletedAt IS NULL ORDER BY s.expenseId, s.idx`,
        tripId,
      ),
      rows(
        db,
        'SELECT * FROM poolContributions WHERE tripId = ? AND deletedAt IS NULL ORDER BY date, createdAt, id',
        tripId,
      ),
      rows(
        db,
        'SELECT * FROM settlements WHERE tripId = ? AND deletedAt IS NULL ORDER BY date, createdAt, id',
        tripId,
      ),
    ])
    const expenseIds = new LocalIds()
    file.expenses = expenseRows.map((r): ExportExpense => ({
      id: expenseIds.add(r.id),
      payer: members.ref(r.payerMemberId),
      payerIsPool: bool(r.payerIsPool),
      amountMinor: Number(r.amountMinor),
      currency: str(r.currency),
      fxRate: Number(r.fxRate),
      fxSource: str(r.fxSource) as ExportExpense['fxSource'],
      fxDate: strOrNull(r.fxDate),
      baseMinor: Number(r.baseMinor),
      date: str(r.date),
      category: str(r.category) as ExportExpense['category'],
      note: str(r.note),
      stop: stops.ref(r.stopId),
      day: days.ref(r.dayId),
      bookingRef: bookings.ref(r.bookingId),
      wishlistItem: items.ref(r.wishlistItemId),
      splitMethod: str(r.splitMethod) as ExportExpense['splitMethod'],
      createdBy: members.ref(r.createdByMemberId),
      shares: shareRows
        .filter((s) => s.expenseId === r.id)
        .flatMap((s) => {
          const member = members.ref(s.memberId)
          if (member === null) return []
          return [
            {
              member,
              idx: Number(s.idx),
              weight: numOrNull(s.weight),
              percent: numOrNull(s.percent),
              amountMinor: numOrNull(s.amountMinor),
              shareMinor: Number(s.shareMinor),
            },
          ]
        }),
    }))
    file.poolContributions = poolRows.flatMap((r) => {
      const member = members.ref(r.memberId)
      if (member === null) return []
      return [
        {
          member,
          amountMinor: Number(r.amountMinor),
          currency: str(r.currency),
          fxRate: Number(r.fxRate),
          fxSource: str(r.fxSource) as ExportExpense['fxSource'],
          fxDate: strOrNull(r.fxDate),
          baseMinor: Number(r.baseMinor),
          date: str(r.date),
          note: str(r.note),
          createdBy: members.ref(r.createdByMemberId),
        },
      ]
    })
    file.settlements = settlementRows.flatMap((r) => {
      const from = members.ref(r.fromMemberId)
      const to = members.ref(r.toMemberId)
      if (from === null || to === null) return []
      return [
        {
          from,
          to,
          amountMinor: Number(r.amountMinor),
          method: str(r.method) as 'cash' | 'transfer' | 'other',
          note: str(r.note),
          date: str(r.date),
          createdBy: members.ref(r.createdByMemberId),
        },
      ]
    })
  }

  const internals: ExportInternals = {
    attachmentRows: new Map(),
    coverAttachment: null,
    wishlistPhotos: new Map(),
    memberIds: (id) => members.ref(id),
  }
  if (include.photos) {
    const photoRows = await rows(
      db,
      `SELECT * FROM attachments WHERE tripId = ? AND kind = 'photo' AND status = 'ready'
          AND deletedAt IS NULL ORDER BY createdAt, id`,
      tripId,
    )
    const photos = new LocalIds()
    file.attachments = photoRows.map((r): ExportAttachment => {
      const id = photos.add(r.id)
      internals.attachmentRows.set(id, r)
      return {
        id,
        kind: 'photo',
        mime: str(r.mime),
        bytes: Number(r.bytes),
        width: numOrNull(r.width),
        height: numOrNull(r.height),
        takenAt: strOrNull(r.takenAt),
        lat: numOrNull(r.lat),
        lng: numOrNull(r.lng),
        place: places.ref(r.placeId),
        stop: stops.ref(r.stopId),
        day: days.ref(r.dayId),
        bookingRef: bookings.ref(r.bookingId),
        lodging: lodgings.ref(r.lodgingId),
        wishlistItem: items.ref(r.wishlistItemId),
        visibility: str(r.visibility) === 'members-only' ? 'members-only' : 'trip',
      }
    })
    internals.coverAttachment = photos.ref(trip.coverAttachmentId)
    for (const r of itemRows) {
      const photo = photos.ref(r.photoAttachmentId)
      if (photo !== null) internals.wishlistPhotos.set(items.ref(r.id) as LocalId, photo)
    }
  }

  return { file, internals }
}

function parseInclude(url: URL): { expenses: boolean; photos: boolean } {
  const parts = (url.searchParams.get('include') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  for (const p of parts)
    if (p !== 'expenses' && p !== 'photos') throw invalid(`include: unknown section "${p}"`)
  return { expenses: parts.includes('expenses'), photos: parts.includes('photos') }
}

/** A file name from the trip name: letters, digits and dashes (any script), else "trip" */
export function fileSlug(name: string): string {
  const slug = name
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'trip'
}

/** RFC 6266: an ASCII fallback plus the UTF-8 name */
export function attachmentDisposition(fileName: string, fallbackExt: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '')
  // A name that was all CJK leaves "-2026-12-20.…" or ".ics": prefix "trip"
  const fallback = /^[A-Za-z0-9]/.test(ascii)
    ? ascii
    : /^[-_]/.test(ascii)
      ? `trip${ascii}`
      : `trip.${fallbackExt}`
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/** GET /api/trips/:id/export?include=expenses,photos (editor; archived trips too) */
export async function exportTrip(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'editor', { allowArchived: true })
  const include = parseInclude(c.url)
  const { file } = await buildExport(c.env.DB, auth.trip.id, include)
  const name = `${fileSlug(auth.trip.name)}-${auth.trip.startDate}.tripfolio.json`
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': attachmentDisposition(name, 'json'),
      'cache-control': 'no-store',
    },
  })
}

// ---- import ------------------------------------------------------------------------------------

export interface ImportOptions {
  /** The caller, who becomes the owner */
  owner: { name: string; color: string }
  /** The file member the caller is (keeps their votes, expenses …); renamed to `owner` */
  asMember?: LocalId
  name?: string
  startDate?: string
  keep: Pick<CopyOptions, 'members' | 'expenses'>
  /** Clone: leave out day recaps and untick every checklist item (a fresh template) */
  asTemplate?: boolean
}

/** New database ids per kind, keyed by the file's local ids (clone uses them for photos) */
export interface ImportIds {
  tripId: string
  ownerMemberId: string
  members: Map<LocalId, string>
  places: Map<LocalId, string>
  days: Map<LocalId, string>
  stops: Map<LocalId, string>
  lodgings: Map<LocalId, string>
  bookings: Map<LocalId, string>
  wishlist: Map<LocalId, string>
  /** Days every date moves by (new startDate − the file's startDate) */
  delta: number
  /** Moves a file date / instant by the import's day offset */
  shiftDate: (date: string) => string
  shiftInstant: (iso: string, tz?: string | null) => string
}

/** Longest JSON text handed to one json_each() statement */
const BULK_CHUNK_CHARS = 500_000
type DbValue = string | number | null

/** INSERT INTO <table> SELECT … FROM json_each(?): any number of rows, one bound parameter each */
export function bulkInsert(
  db: D1Database,
  table: string,
  records: Record<string, unknown>[],
): D1PreparedStatement[] {
  if (records.length === 0) return []
  const columns = Object.keys(records[0])
  const sql = `INSERT INTO ${table} (${columns.map((k) => `"${k}"`).join(', ')}) SELECT ${columns
    .map((k) => `json_extract(value, '$.${k}')`)
    .join(', ')} FROM json_each(?)`
  const statements: D1PreparedStatement[] = []
  let chunk: string[] = []
  let size = 0
  const flush = () => {
    if (chunk.length === 0) return
    statements.push(db.prepare(sql).bind(`[${chunk.join(',')}]`))
    chunk = []
    size = 0
  }
  for (const record of records) {
    const row: Record<string, DbValue> = {}
    for (const k of columns) row[k] = dbValue(record[k])
    const text = JSON.stringify(row)
    if (size + text.length > BULK_CHUNK_CHARS) flush()
    chunk.push(text)
    size += text.length + 1
  }
  flush()
  return statements
}

/** Asserts local ids are unique within a list; returns them as a set */
function idSet(list: { id: LocalId }[], path: string): Set<LocalId> {
  const ids = new Set<LocalId>()
  list.forEach((item, i) => {
    if (ids.has(item.id)) throw invalid(`${path}[${i}].id: duplicate id ${item.id}`)
    ids.add(item.id)
  })
  return ids
}

function checkRef(ids: Set<LocalId>, value: LocalId | null, path: string, kind: string) {
  if (value !== null && !ids.has(value)) throw invalid(`${path}: no ${kind} with id ${value}`)
}

/** Every reference in the file points at an entity in the file (422 otherwise) */
function checkReferences(file: TripExport) {
  const members = idSet(file.members, 'members')
  const places = idSet(file.places, 'places')
  const days = idSet(file.days, 'days')
  const stops = idSet(file.stops, 'stops')
  const lodgings = idSet(file.lodgings, 'lodgings')
  const bookings = idSet(file.bookings, 'bookings')
  const items = idSet(file.wishlist, 'wishlist')
  file.days.forEach((d, i) => checkRef(lodgings, d.lodging, `days[${i}].lodging`, 'lodging'))
  file.stops.forEach((s, i) => {
    checkRef(days, s.day, `stops[${i}].day`, 'day')
    checkRef(places, s.place, `stops[${i}].place`, 'place')
    checkRef(items, s.wishlistItem, `stops[${i}].wishlistItem`, 'wishlist item')
    checkRef(bookings, s.bookingRef, `stops[${i}].bookingRef`, 'booking')
    checkRef(lodgings, s.lodging, `stops[${i}].lodging`, 'lodging')
  })
  file.legOverrides.forEach((l, i) => {
    checkRef(stops, l.from, `legOverrides[${i}].from`, 'stop')
    checkRef(stops, l.to, `legOverrides[${i}].to`, 'stop')
  })
  file.lodgings.forEach((l, i) => checkRef(places, l.place, `lodgings[${i}].place`, 'place'))
  file.bookings.forEach((b, i) => {
    checkRef(members, b.payer, `bookings[${i}].payer`, 'member')
    for (const key of DETAIL_PLACE_KEYS) {
      const v = b.details[key]
      if (v === undefined) continue
      if (typeof v !== 'number') throw invalid(`bookings[${i}].details.${key}: a place id number`)
      checkRef(places, v, `bookings[${i}].details.${key}`, 'place')
    }
  })
  file.wishlist.forEach((w, i) => {
    checkRef(places, w.place, `wishlist[${i}].place`, 'place')
    checkRef(members, w.recommender, `wishlist[${i}].recommender`, 'member')
    checkRef(stops, w.stop, `wishlist[${i}].stop`, 'stop')
    w.votes.forEach((v, j) => checkRef(members, v, `wishlist[${i}].votes[${j}]`, 'member'))
    w.claims.forEach((c, j) =>
      checkRef(members, c.buyer, `wishlist[${i}].claims[${j}].buyer`, 'member'),
    )
  })
  idSet(file.expenses ?? [], 'expenses')
  file.expenses?.forEach((e, i) => {
    const at = `expenses[${i}]`
    if (e.payerIsPool !== (e.payer === null))
      throw invalid(`${at}.payer: exactly one of payer or payerIsPool`)
    checkRef(members, e.payer, `${at}.payer`, 'member')
    checkRef(members, e.createdBy, `${at}.createdBy`, 'member')
    checkRef(stops, e.stop, `${at}.stop`, 'stop')
    checkRef(days, e.day, `${at}.day`, 'day')
    checkRef(bookings, e.bookingRef, `${at}.bookingRef`, 'booking')
    checkRef(items, e.wishlistItem, `${at}.wishlistItem`, 'wishlist item')
    const seen = new Set<LocalId>()
    e.shares.forEach((s, j) => {
      checkRef(members, s.member, `${at}.shares[${j}].member`, 'member')
      if (seen.has(s.member)) throw invalid(`${at}.shares[${j}].member: duplicate`)
      seen.add(s.member)
    })
  })
  file.poolContributions?.forEach((p, i) => {
    checkRef(members, p.member, `poolContributions[${i}].member`, 'member')
    checkRef(members, p.createdBy, `poolContributions[${i}].createdBy`, 'member')
  })
  file.settlements?.forEach((s, i) => {
    checkRef(members, s.from, `settlements[${i}].from`, 'member')
    checkRef(members, s.to, `settlements[${i}].to`, 'member')
    checkRef(members, s.createdBy, `settlements[${i}].createdBy`, 'member')
    if (s.from === s.to) throw invalid(`settlements[${i}].to: same member as from`)
  })
  idSet(file.attachments ?? [], 'attachments')
  idSet(file.checklists ?? [], 'checklists')
  file.checklists?.forEach((l, i) =>
    l.items.forEach((item, j) =>
      checkRef(members, item.assignee, `checklists[${i}].items[${j}].assignee`, 'member'),
    ),
  )
  const categories = new Set<string>()
  file.budgets?.forEach((b, i) => {
    if (categories.has(b.category)) throw invalid(`budgets[${i}].category: duplicate`)
    categories.add(b.category)
  })
  const recapDays = new Set<LocalId>()
  file.dayRecaps?.forEach((r, i) => {
    checkRef(days, r.day, `dayRecaps[${i}].day`, 'day')
    if (recapDays.has(r.day)) throw invalid(`dayRecaps[${i}].day: duplicate`)
    recapDays.add(r.day)
  })
}

const MS_PER_DAY = 86_400_000

/** Whole days from `from` to `to` (YYYY-MM-DD) */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY)
}

/** Moves a UTC instant by `delta` days of wall-clock time in `tz` (keeps the local time of day) */
export function shiftInstant(iso: string, delta: number, tz: string): string {
  if (delta === 0) return iso
  const ms = Date.parse(iso)
  const local = utcToZoned(ms, tz)
  const seconds = ms - Math.floor(ms / 60_000) * 60_000
  const moved = zonedTimeToUtc(`${addDays(local.date, delta)}T${local.time}`, tz) + seconds
  return new Date(moved).toISOString()
}

/** Moves a wall-clock date-time without a zone ('YYYY-MM-DDTHH:mm…') or a UTC instant */
export function shiftTakenAt(value: string, delta: number, tz: string): string {
  if (delta === 0) return value
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) return shiftInstant(value, delta, tz)
  return addDays(value.slice(0, 10), delta) + value.slice(10)
}

/**
 * Writes `file` as a new trip. Returns the owner's memberToken, the new ids and what was skipped.
 * Every row goes into one D1 batch (a transaction), so a failure leaves nothing behind.
 */
export async function writeImport(
  db: D1Database,
  file: TripExport,
  options: ImportOptions,
  extra: (ids: ImportIds) => D1PreparedStatement[] | Promise<D1PreparedStatement[]> = () => [],
): Promise<{ response: ImportTripResponse; ids: ImportIds }> {
  checkReferences(file)
  if (options.asMember !== undefined && !file.members.some((m) => m.id === options.asMember))
    throw invalid(`asMember: no member with id ${options.asMember}`)

  const skipped: string[] = []
  const tz = file.trip.tz
  const startDate = options.startDate ?? file.trip.startDate
  const delta = daysBetween(file.trip.startDate, startDate)
  const span = daysBetween(file.trip.startDate, file.trip.endDate)
  if (span < 0) throw invalid('trip.endDate: endDate before startDate')
  const endDate = addDays(startDate, span)
  if (dayCount(startDate, endDate) > MAX_TRIP_DAYS)
    throw invalid(`trip.endDate: a trip is at most ${MAX_TRIP_DAYS} days`)
  const shiftDate = (d: string) => (delta === 0 ? d : addDays(d, delta))
  const shift = (iso: string, zone?: string | null) => shiftInstant(iso, delta, zone ?? tz)
  const shiftOrNull = (iso: string | null, zone?: string | null) =>
    iso === null ? null : shift(iso, zone)

  const now = nowIso()
  // Rows get increasing createdAt in file order, so a later export numbers them the same way
  const base = Date.parse(now)
  let seq = 0
  const stamp = () => {
    const at = new Date(base + seq++).toISOString()
    return { createdAt: at, updatedAt: at }
  }
  const tripId = crypto.randomUUID()
  const ownerMemberId = crypto.randomUUID()
  const memberToken = generateToken()
  const newIds = <T extends { id: LocalId }>(list: T[]) =>
    new Map(list.map((e) => [e.id, crypto.randomUUID()]))
  const ids: ImportIds = {
    tripId,
    ownerMemberId,
    members: new Map(),
    places: newIds(file.places),
    days: newIds(file.days),
    stops: newIds(file.stops),
    lodgings: newIds(file.lodgings),
    bookings: newIds(file.bookings),
    wishlist: newIds(file.wishlist),
    delta,
    shiftDate,
    shiftInstant: shift,
  }
  const map = (m: Map<LocalId, string>, local: LocalId | null) =>
    local === null ? null : (m.get(local) ?? null)

  // Members: the caller is always the owner; the file's others become placeholders when kept
  const memberRecords: Record<string, unknown>[] = [
    {
      id: ownerMemberId,
      tripId,
      name: options.owner.name,
      color: options.owner.color,
      role: 'owner',
      removedAt: null,
      ...stamp(),
    },
  ]
  if (options.asMember !== undefined) ids.members.set(options.asMember, ownerMemberId)
  if (options.keep.members) {
    for (const m of file.members) {
      if (m.id === options.asMember) continue
      const id = crypto.randomUUID()
      ids.members.set(m.id, id)
      memberRecords.push({
        id,
        tripId,
        name: m.name,
        color: m.color,
        // There is one owner: the caller
        role: m.role === 'owner' ? 'editor' : m.role,
        removedAt: m.removed ? now : null,
        ...stamp(),
      })
    }
  } else if (file.members.length > (options.asMember === undefined ? 0 : 1)) {
    skipped.push('members: not kept; their references were cleared')
  }
  const member = (local: LocalId | null) => map(ids.members, local)

  // Days follow the (shifted) trip dates; gaps are filled the same way POST /api/trips does
  const dayRecords: Record<string, unknown>[] = file.days.map((d) => ({
    id: ids.days.get(d.id),
    tripId,
    date: d.date === null ? null : shiftDate(d.date),
    idx: d.idx,
    title: d.title,
    color: d.color,
    note: d.note,
    lodgingId: map(ids.lodgings, d.lodging),
    ...stamp(),
  }))
  const plan = planDays(
    dayRecords.map((d) => ({
      id: str(d.id),
      date: strOrNull(d.date),
      idx: numOrNull(d.idx),
    })),
    startDate,
    endDate,
  )
  for (const a of plan.assign) {
    const day = dayRecords.find((d) => d.id === a.id)
    if (day) Object.assign(day, { date: a.date, idx: a.idx })
  }
  for (const id of plan.unassign) {
    const day = dayRecords.find((d) => d.id === id)
    if (day) day.idx = null
  }
  for (const c of plan.create)
    dayRecords.push({
      id: crypto.randomUUID(),
      tripId,
      date: c.date,
      idx: c.idx,
      title: '',
      color: null,
      note: '',
      lodgingId: null,
      ...stamp(),
    })

  const placeRecords = file.places.map((p) => ({
    id: ids.places.get(p.id),
    tripId,
    nameLocal: p.nameLocal,
    nameEn: p.nameEn,
    lat: p.lat,
    lng: p.lng,
    address: p.address,
    category: p.category,
    source: p.source,
    hours: p.hours === null ? null : JSON.stringify(p.hours),
    links: JSON.stringify(p.links),
    ...stamp(),
  }))

  const stopRecords = file.stops.map((s) => ({
    id: ids.stops.get(s.id),
    tripId,
    dayId: ids.days.get(s.day),
    order: s.order,
    type: s.type,
    title: s.title,
    placeId: map(ids.places, s.place),
    startAt: shiftOrNull(s.startAt),
    endAt: shiftOrNull(s.endAt),
    durationMin: s.durationMin,
    costMinor: s.costMinor,
    currency: s.currency,
    booking: s.booking,
    note: s.note,
    links: JSON.stringify(s.links),
    wishlistItemId: map(ids.wishlist, s.wishlistItem),
    bookingId: map(ids.bookings, s.bookingRef),
    isBackup: s.isBackup ? 1 : 0,
    source: s.source,
    bookingSlot:
      s.bookingSlot && /^day:\d{4}-\d{2}-\d{2}$/.test(s.bookingSlot)
        ? `day:${shiftDate(s.bookingSlot.slice(4))}`
        : s.bookingSlot,
    lodgingId: map(ids.lodgings, s.lodging),
    ...stamp(),
  }))

  const legRecords = file.legOverrides.map((l) => ({
    tripId,
    fromStopId: ids.stops.get(l.from),
    toStopId: ids.stops.get(l.to),
    mode: l.mode,
    minutes: l.minutes,
    updatedAt: now,
  }))

  const lodgingRecords = file.lodgings.map((l) => ({
    id: ids.lodgings.get(l.id),
    tripId,
    placeId: map(ids.places, l.place),
    name: l.name,
    checkIn: shiftDate(l.checkIn),
    checkOut: shiftDate(l.checkOut),
    checkInTime: l.checkInTime,
    checkOutTime: l.checkOutTime,
    roomType: l.roomType,
    guests: l.guests,
    platform: l.platform,
    ref: l.ref,
    priceMinor: l.priceMinor,
    currency: l.currency,
    payStatus: l.payStatus,
    cancelBy: shiftOrNull(l.cancelBy),
    phone: l.phone,
    campType: l.campType,
    campFacilities: l.campFacilities === null ? null : JSON.stringify(l.campFacilities),
    note: l.note,
    ...stamp(),
  }))

  const bookingRecords = file.bookings.map((b, i) => {
    const details: Record<string, unknown> = { ...b.details }
    for (const key of DETAIL_PLACE_KEYS)
      if (typeof details[key] === 'number') details[key] = ids.places.get(details[key] as LocalId)
    const parsed = bookingDetailsSchemas[b.type].safeParse(details)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw invalid(
        `bookings[${i}].details.${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`,
        parsed.error.issues,
      )
    }
    const startTz = b.startTz ?? tz
    return {
      id: ids.bookings.get(b.id),
      tripId,
      type: b.type,
      title: b.title,
      details: JSON.stringify(parsed.data),
      startAt: shiftOrNull(b.startAt, startTz),
      endAt: shiftOrNull(b.endAt, b.endTz ?? startTz),
      startTz: b.startTz,
      endTz: b.endTz,
      priceMinor: b.priceMinor,
      currency: b.currency,
      payStatus: b.payStatus,
      payerMemberId: member(b.payer),
      cancelBy: shiftOrNull(b.cancelBy),
      ref: b.ref,
      note: b.note,
      ...stamp(),
    }
  })

  const itemRecords = file.wishlist.map((w) => ({
    id: ids.wishlist.get(w.id),
    tripId,
    category: w.category,
    name: w.name,
    placeId: map(ids.places, w.place),
    photoAttachmentId: null,
    estMinor: w.estMinor,
    currency: w.currency,
    sourceUrl: w.sourceUrl,
    sourceTitle: w.sourceTitle,
    sourceImageUrl: w.sourceImageUrl,
    recommenderMemberId: member(w.recommender),
    note: w.note,
    status: w.status,
    stopId: map(ids.stops, w.stop),
    order: w.order,
    ...stamp(),
  }))
  const voteRecords: Record<string, unknown>[] = []
  const claimRecords: Record<string, unknown>[] = []
  for (const w of file.wishlist) {
    const itemId = ids.wishlist.get(w.id)
    const voters = new Set(w.votes.map(member).filter((m): m is string => m !== null))
    for (const memberId of voters) voteRecords.push({ itemId, memberId, createdAt: now })
    for (const c of w.claims)
      claimRecords.push({
        id: crypto.randomUUID(),
        itemId,
        buyerMemberId: member(c.buyer),
        forName: c.forName,
        qty: c.qty,
        done: c.done ? 1 : 0,
        ...stamp(),
      })
  }

  // Money needs the people it belongs to
  const expenseRecords: Record<string, unknown>[] = []
  const shareRecords: Record<string, unknown>[] = []
  const poolRecords: Record<string, unknown>[] = []
  const settlementRecords: Record<string, unknown>[] = []
  const hasMoney =
    (file.expenses?.length ?? 0) +
      (file.poolContributions?.length ?? 0) +
      (file.settlements?.length ?? 0) >
    0
  if (hasMoney && options.keep.expenses && !options.keep.members) {
    skipped.push('expenses: they need the members, which were not kept')
  } else if (hasMoney && !options.keep.expenses) {
    skipped.push('expenses: not kept')
  } else if (hasMoney) {
    const creator = (local: LocalId | null) => member(local) ?? ownerMemberId
    for (const e of file.expenses ?? []) {
      const id = crypto.randomUUID()
      expenseRecords.push({
        id,
        tripId,
        payerMemberId: e.payerIsPool ? null : member(e.payer),
        payerIsPool: e.payerIsPool ? 1 : 0,
        amountMinor: e.amountMinor,
        currency: e.currency,
        fxRate: e.fxRate,
        fxSource: e.fxSource,
        fxDate: e.fxDate,
        baseMinor: e.baseMinor,
        date: shiftDate(e.date),
        category: e.category,
        note: e.note,
        stopId: map(ids.stops, e.stop),
        dayId: map(ids.days, e.day),
        receiptAttachmentId: null,
        bookingId: map(ids.bookings, e.bookingRef),
        wishlistItemId: map(ids.wishlist, e.wishlistItem),
        splitMethod: e.splitMethod,
        createdByMemberId: creator(e.createdBy),
        ...stamp(),
      })
      for (const s of e.shares)
        shareRecords.push({
          expenseId: id,
          memberId: member(s.member),
          idx: s.idx,
          weight: s.weight,
          percent: s.percent,
          amountMinor: s.amountMinor,
          shareMinor: s.shareMinor,
        })
    }
    for (const p of file.poolContributions ?? [])
      poolRecords.push({
        id: crypto.randomUUID(),
        tripId,
        memberId: member(p.member),
        amountMinor: p.amountMinor,
        currency: p.currency,
        fxRate: p.fxRate,
        fxSource: p.fxSource,
        fxDate: p.fxDate,
        baseMinor: p.baseMinor,
        date: shiftDate(p.date),
        note: p.note,
        createdByMemberId: creator(p.createdBy),
        ...stamp(),
      })
    for (const s of file.settlements ?? [])
      settlementRecords.push({
        id: crypto.randomUUID(),
        tripId,
        fromMemberId: member(s.from),
        toMemberId: member(s.to),
        amountMinor: s.amountMinor,
        method: s.method,
        note: s.note,
        date: shiftDate(s.date),
        createdByMemberId: creator(s.createdBy),
        ...stamp(),
      })
  }
  if ((file.attachments?.length ?? 0) > 0)
    skipped.push('attachments: photo files are not part of an export')

  // Prep data (E9): checklists come along unticked in a template copy; the budget in the file's
  // own currency (the trip keeps the file's base currency, so it matches)
  const checklistRecords: Record<string, unknown>[] = []
  const checklistItemRecords: Record<string, unknown>[] = []
  for (const l of file.checklists ?? []) {
    const checklistId = crypto.randomUUID()
    checklistRecords.push({
      id: checklistId,
      tripId,
      kind: l.kind,
      title: l.title,
      order: l.order,
      templateKey: l.templateKey,
      ...stamp(),
    })
    for (const item of l.items)
      checklistItemRecords.push({
        id: crypto.randomUUID(),
        checklistId,
        tripId,
        text: item.text,
        note: item.note,
        done: item.done && !options.asTemplate ? 1 : 0,
        assigneeMemberId: member(item.assignee),
        dueAt: item.dueAt === null ? null : shiftDate(item.dueAt),
        order: item.order,
        templateKey: item.templateKey,
        linkHint: item.linkHint === null ? null : JSON.stringify(item.linkHint),
        ...stamp(),
      })
  }
  const budgetRecords = (file.budgets ?? []).map((b) => ({
    tripId,
    category: b.category,
    plannedMinor: b.plannedMinor,
    currency: b.currency,
    perPerson: b.perPerson ? 1 : 0,
    updatedAt: now,
  }))
  const noteRecords = (file.notes ?? []).map((n) => ({
    id: crypto.randomUUID(),
    tripId,
    section: n.section,
    title: n.title,
    body: n.body,
    order: n.order,
    templateKey: n.templateKey,
    shareable: n.shareable ? 1 : 0,
    ...stamp(),
  }))
  // Day recaps (e8-t04): what happened on that trip, so never part of a template copy
  const recapRecords = options.asTemplate
    ? []
    : (file.dayRecaps ?? []).map((r) => ({
        dayId: ids.days.get(r.day),
        tripId,
        body: r.body,
        updatedByMemberId: null,
        updatedAt: now,
      }))

  const t = file.trip
  const tripRecord = {
    id: tripId,
    name: options.name ?? t.name,
    destination: t.destination,
    centerLat: t.centerLat,
    centerLng: t.centerLng,
    startDate,
    endDate,
    tz,
    baseCurrency: t.baseCurrency,
    secondaryCurrency: t.secondaryCurrency,
    localCurrencies: JSON.stringify(t.localCurrencies),
    coverColor: t.coverColor,
    summary: t.summary,
    style: t.style,
    driveLimitMin: t.driveLimitMin,
    poolRefundMode: t.poolRefundMode,
    fxOverrides: JSON.stringify(t.fxOverrides),
    ownerMemberId,
    ...stamp(),
  }

  // Foreign-key order: trip → members → places, days → stops → wishlist → … → money
  const statements = [
    ...bulkInsert(db, 'trips', [tripRecord]),
    ...bulkInsert(db, 'members', memberRecords),
    ...bulkInsert(db, 'memberTokens', [
      { tokenHash: await hashToken(memberToken), tripId, memberId: ownerMemberId, createdAt: now },
    ]),
    ...bulkInsert(db, 'places', placeRecords),
    ...bulkInsert(db, 'days', dayRecords),
    ...bulkInsert(db, 'lodgings', lodgingRecords),
    ...bulkInsert(db, 'bookings', bookingRecords),
    ...bulkInsert(db, 'stops', stopRecords),
    ...bulkInsert(db, 'legOverrides', legRecords),
    ...bulkInsert(db, 'wishlistItems', itemRecords),
    ...bulkInsert(db, 'wishlistVotes', voteRecords),
    ...bulkInsert(db, 'wishlistClaims', claimRecords),
    ...bulkInsert(db, 'expenses', expenseRecords),
    ...bulkInsert(db, 'expenseShares', shareRecords),
    ...bulkInsert(db, 'poolContributions', poolRecords),
    ...bulkInsert(db, 'settlements', settlementRecords),
    ...bulkInsert(db, 'checklists', checklistRecords),
    ...bulkInsert(db, 'checklistItems', checklistItemRecords),
    ...bulkInsert(db, 'budgets', budgetRecords),
    ...bulkInsert(db, 'notes', noteRecords),
    ...bulkInsert(db, 'dayRecaps', recapRecords),
    ...(await extra(ids)),
  ]
  const rev = await writeWithRev(db, tripId, statements)

  const [tripRow, ownerRow] = await Promise.all([
    db.prepare('SELECT * FROM trips WHERE id = ?').bind(tripId).first<Row>(),
    db.prepare('SELECT * FROM members WHERE id = ?').bind(ownerMemberId).first<Row>(),
  ])
  const response: ImportTripResponse = {
    trip: toTrip(tripRow as Row),
    member: toMember(ownerRow as Row),
    memberToken,
    rev,
    skipped,
  }
  return { response, ids }
}

/** POST /api/import: no auth (like POST /api/trips); 413 over 5 MB, 422 on a bad file */
export async function importTrip(c: RouteContext): Promise<Response> {
  const declared = Number(c.request.headers.get('content-length') ?? '0')
  if (declared > MAX_IMPORT_BYTES) throw tooLarge()
  const raw = await c.request.arrayBuffer()
  if (raw.byteLength > MAX_IMPORT_BYTES) throw tooLarge()
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    throw new ApiError(422, 'invalid_json', 'request body is not valid JSON')
  }
  const result = tripImportSchema.safeParse(body)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first?.path.length ? `${first.path.join('.')}: ` : ''
    throw invalid(`${where}${first?.message ?? 'invalid file'}`, result.error.issues)
  }
  const { owner, name, startDate, asMember, keep, ...file } = result.data
  const hasExpenses = (file.expenses?.length ?? 0) > 0
  const { response } = await writeImport(c.env.DB, file, {
    owner,
    name,
    startDate,
    asMember,
    keep: { members: keep?.members ?? true, expenses: keep?.expenses ?? hasExpenses },
  })
  return json(response, 201)
}

const tooLarge = () =>
  new ApiError(413, 'too_large', `an import file is at most ${MAX_IMPORT_BYTES} bytes`)

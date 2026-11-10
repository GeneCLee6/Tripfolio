import { z } from 'zod'
import type { TripExport } from '../api/export.ts'
import { TRIP_EXPORT_FORMAT, TRIP_EXPORT_VERSION } from '../api/export.ts'
import { RECAP_MAX_CHARS } from '../api/share.ts'
import { bookingType } from './booking.ts'
import {
  colorValue,
  currencyCode,
  ianaTimeZone,
  isoDate,
  isoDateTime,
  latitude,
  linkList,
  longitude,
} from './common.ts'
import { expenseCategory, poolRefundMode, settlementMethod, splitMethod } from './expense.ts'
import { campFacilitiesSchema, campType, hhmm, payStatus } from './lodging.ts'
import { memberIdentity, role } from './member.ts'
import { placeHours, placeSource } from './place.ts'
import { budgetCategory, checklistKind, noteSection } from './prep.ts'
import { bookingState, legMode, stopType } from './stop.ts'
import { MAX_TRIP_DAYS, tripStyle } from './trip.ts'
import { wishlistCategory, wishlistStatus } from './wishlist.ts'

// The trip export file (e8-t03, shared/api/export.ts) as POST /api/import validates it. Structure
// and value ranges are checked here; that every local reference points at an entity in the file is
// checked by the importer (worker/trips/export.ts), also with 422.

const localId = z.number().int().min(1).max(1_000_000)
const ref = localId.nullable()
const text = (max: number) => z.string().max(max)
const nullableText = (max: number) => z.string().max(max).nullable()
const minor = z.number().int().min(0).max(1e13)
const rate = z.number().finite().positive().max(1e9)
const fxSource = z.enum(['base', 'manual', 'trip', 'auto'])
/** UTC instant (…Z) or a wall-clock time without a zone (photo takenAt) */
const instantOrLocal = z.union([isoDateTime, z.iso.datetime({ local: true })])
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max)

const exportTrip = z.object({
  name: z.string().trim().min(1).max(120),
  destination: text(200),
  centerLat: latitude.nullable(),
  centerLng: longitude.nullable(),
  startDate: isoDate,
  endDate: isoDate,
  tz: ianaTimeZone,
  baseCurrency: currencyCode,
  secondaryCurrency: currencyCode.nullable(),
  localCurrencies: list(currencyCode, 10),
  coverColor: colorValue.nullable(),
  summary: text(300),
  style: tripStyle,
  driveLimitMin: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .nullable(),
  poolRefundMode,
  fxOverrides: z.record(currencyCode, rate),
})

const exportMember = z.object({
  id: localId,
  name: z.string().trim().min(1).max(60),
  color: colorValue,
  role,
  removed: z.boolean(),
})

const exportDay = z.object({
  id: localId,
  date: isoDate.nullable(),
  idx: z.number().int().min(1).max(MAX_TRIP_DAYS).nullable(),
  title: text(200),
  color: colorValue.nullable(),
  note: text(5000),
  lodging: ref,
})

const exportPlace = z.object({
  id: localId,
  nameLocal: z.string().trim().min(1).max(200),
  nameEn: text(200),
  lat: latitude,
  lng: longitude,
  address: text(500),
  category: text(40),
  source: placeSource,
  hours: placeHours.nullable(),
  links: linkList,
})

const exportStop = z.object({
  id: localId,
  day: localId,
  order: z.number().finite(),
  type: stopType,
  title: text(200),
  place: ref,
  startAt: isoDateTime.nullable(),
  endAt: isoDateTime.nullable(),
  durationMin: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .nullable(),
  costMinor: minor.nullable(),
  currency: currencyCode.nullable(),
  booking: bookingState,
  note: text(5000),
  links: linkList,
  wishlistItem: ref,
  bookingRef: ref,
  source: z.string().min(1).max(20),
  bookingSlot: nullableText(40),
  lodging: ref,
  isBackup: z.boolean(),
})

const exportLeg = z.object({
  from: localId,
  to: localId,
  mode: legMode,
  minutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .nullable(),
})

const exportLodging = z.object({
  id: localId,
  place: ref,
  name: z.string().trim().min(1).max(200),
  checkIn: isoDate,
  checkOut: isoDate,
  checkInTime: hhmm.nullable(),
  checkOutTime: hhmm.nullable(),
  roomType: nullableText(200),
  guests: z.number().int().min(1).max(99).nullable(),
  platform: nullableText(100),
  ref: nullableText(100),
  priceMinor: minor.nullable(),
  currency: currencyCode.nullable(),
  payStatus,
  cancelBy: isoDateTime.nullable(),
  phone: nullableText(50),
  campType: campType.nullable(),
  campFacilities: campFacilitiesSchema.nullable(),
  note: text(5000),
})

const exportBooking = z.object({
  id: localId,
  type: bookingType,
  title: z.string().trim().min(1).max(200),
  // Validated per type by the importer once the place references are mapped back
  details: z.record(z.string(), z.unknown()),
  startAt: isoDateTime.nullable(),
  endAt: isoDateTime.nullable(),
  startTz: ianaTimeZone.nullable(),
  endTz: ianaTimeZone.nullable(),
  priceMinor: minor.nullable(),
  currency: currencyCode.nullable(),
  payStatus,
  payer: ref,
  cancelBy: isoDateTime.nullable(),
  ref: nullableText(100),
  note: text(5000),
})

const exportWishlistItem = z.object({
  id: localId,
  category: wishlistCategory,
  name: z.string().trim().min(1).max(200),
  place: ref,
  estMinor: minor.nullable(),
  currency: currencyCode.nullable(),
  sourceUrl: nullableText(2000),
  sourceTitle: nullableText(300),
  sourceImageUrl: nullableText(2000),
  recommender: ref,
  note: text(5000),
  status: wishlistStatus,
  stop: ref,
  order: z.number().finite(),
  votes: list(localId, 100),
  claims: list(
    z.object({
      buyer: ref,
      forName: text(100),
      qty: z.number().int().min(1).max(999),
      done: z.boolean(),
    }),
    100,
  ),
})

const exportExpense = z.object({
  id: localId,
  payer: ref,
  payerIsPool: z.boolean(),
  amountMinor: minor,
  currency: currencyCode,
  fxRate: rate,
  fxSource,
  fxDate: isoDate.nullable(),
  baseMinor: minor,
  date: isoDate,
  category: expenseCategory,
  note: text(2000),
  stop: ref,
  day: ref,
  bookingRef: ref,
  wishlistItem: ref,
  splitMethod,
  createdBy: ref,
  shares: list(
    z.object({
      member: localId,
      idx: z.number().int().min(0).max(1000),
      weight: z.number().finite().min(0).max(1000).nullable(),
      percent: z.number().finite().min(0).max(100).nullable(),
      amountMinor: minor.nullable(),
      shareMinor: z.number().int().min(-1e13).max(1e13),
    }),
    100,
  ),
})

const exportPool = z.object({
  member: localId,
  amountMinor: minor,
  currency: currencyCode,
  fxRate: rate,
  fxSource,
  fxDate: isoDate.nullable(),
  baseMinor: minor,
  date: isoDate,
  note: text(2000),
  createdBy: ref,
})

const exportSettlement = z.object({
  from: localId,
  to: localId,
  amountMinor: z.number().int().min(1).max(1e13),
  method: settlementMethod,
  note: text(2000),
  date: isoDate,
  createdBy: ref,
})

const exportAttachment = z.object({
  id: localId,
  kind: z.literal('photo'),
  mime: text(100),
  bytes: z.number().int().min(0),
  width: z.number().int().min(0).nullable(),
  height: z.number().int().min(0).nullable(),
  takenAt: instantOrLocal.nullable(),
  lat: latitude.nullable(),
  lng: longitude.nullable(),
  place: ref,
  stop: ref,
  day: ref,
  bookingRef: ref,
  lodging: ref,
  wishlistItem: ref,
  visibility: z.enum(['trip', 'members-only']),
})

const exportChecklistItem = z.object({
  text: z.string().trim().min(1).max(500),
  note: text(2000),
  done: z.boolean(),
  assignee: ref,
  dueAt: isoDate.nullable(),
  order: z.number().finite(),
  templateKey: nullableText(200),
  linkHint: z
    .object({ label: z.string().max(300), url: z.url({ protocol: /^https$/ }).optional() })
    .nullable(),
})

const exportChecklist = z.object({
  id: localId,
  kind: checklistKind,
  title: z.string().trim().min(1).max(200),
  order: z.number().finite(),
  templateKey: nullableText(200),
  items: list(exportChecklistItem, 2000),
})

const exportBudgetRow = z.object({
  category: budgetCategory,
  plannedMinor: z.number().int().min(0).max(100_000_000_000),
  currency: currencyCode,
  perPerson: z.boolean(),
})

const exportNote = z.object({
  section: noteSection,
  title: z.string().trim().min(1).max(200),
  body: text(20_000),
  order: z.number().finite(),
  templateKey: nullableText(200),
  shareable: z.boolean(),
})

const exportDayRecap = z.object({
  day: localId,
  body: z.string().trim().min(1).max(RECAP_MAX_CHARS),
})

const tripExportShape = {
  format: z.literal(TRIP_EXPORT_FORMAT),
  version: z.literal(TRIP_EXPORT_VERSION),
  exportedAt: isoDateTime,
  includes: z.object({ expenses: z.boolean(), photos: z.boolean() }),
  trip: exportTrip,
  members: list(exportMember, 200),
  days: list(exportDay, 400),
  places: list(exportPlace, 5000),
  stops: list(exportStop, 10000),
  legOverrides: list(exportLeg, 10000),
  lodgings: list(exportLodging, 1000),
  bookings: list(exportBooking, 1000),
  wishlist: list(exportWishlistItem, 5000),
  expenses: list(exportExpense, 20000).optional(),
  poolContributions: list(exportPool, 5000).optional(),
  settlements: list(exportSettlement, 5000).optional(),
  attachments: list(exportAttachment, 20000).optional(),
  // Additive v1 extension (prep data, recaps): optional, so older files still import
  checklists: list(exportChecklist, 200).optional(),
  budgets: list(exportBudgetRow, 20).optional(),
  notes: list(exportNote, 500).optional(),
  dayRecaps: list(exportDayRecap, 400).optional(),
}

export const tripExportSchema = z.object(tripExportShape)

// The file format and its type must not drift apart
const exportMatchesType = (file: z.output<typeof tripExportSchema>): TripExport => file
void exportMatchesType

const keepSchema = z.object({
  members: z.boolean().optional(),
  expenses: z.boolean().optional(),
})

/**
 * POST /api/import: the export file's fields at the top level, plus who the caller is. The caller
 * becomes the owner: a new member (`owner`), or the file's member `asMember` (renamed to `owner`).
 * `startDate` moves every date and time by the same number of days. `keep` defaults to everything
 * the file has.
 */
export const tripImportSchema = z.object({
  ...tripExportShape,
  owner: memberIdentity,
  name: z.string().trim().min(1).max(120).optional(),
  startDate: isoDate.optional(),
  asMember: localId.optional(),
  keep: keepSchema.optional(),
})
export type TripImport = z.infer<typeof tripImportSchema>

/** POST /api/trips/:id/clone: a template copy; members, expenses and photos are cleared unless kept */
export const tripCloneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  startDate: isoDate.optional(),
  keep: z
    .object({
      expenses: z.boolean().default(false),
      photos: z.boolean().default(false),
      members: z.boolean().default(false),
    })
    .default({ expenses: false, photos: false, members: false }),
})
export type TripClone = z.infer<typeof tripCloneSchema>

// Trip export file (e8-t03) and the lifecycle responses (e1-t07). GET /api/trips/:id/export writes a
// `TripExport`; POST /api/import reads one back into a new trip; POST /api/trips/:id/clone runs the
// same engine in memory. Validation of incoming files: shared/schema/export.ts.
//
// Ids are file-local: every entity gets a sequential integer `id` (1, 2, 3 … per kind) and
// references point at those numbers, so a file never carries database ids, tokens, emails or R2
// keys, and an import can rebuild every relation (stop → place, wishlist ↔ stop, day → lodging,
// booking → stops, expense → member …). Money stays integer minor units with its currency and rate.

import type { MemberTokenResponse, Trip } from './types.ts'
import type {
  BookingState,
  BookingType,
  ExpenseCategory,
  LegMode,
  Link,
  PayStatus,
  PlaceHours,
  PlaceSource,
  Role,
  SettlementMethod,
  StopType,
  TripStyle,
  WishlistCategory,
  WishlistStatus,
} from '../schema/index.ts'
import type { BudgetCategory, ChecklistKind, NoteSection } from '../schema/prep.ts'

export const TRIP_EXPORT_FORMAT = 'tripfolio.trip'
export const TRIP_EXPORT_VERSION = 1
/** POST /api/import refuses bodies over this many bytes (413) */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
/** Soft-deleted trips can be restored for this many days; e11-t06 purges them afterwards */
export const TRIP_RESTORE_DAYS = 30

/** A file-local id: 1-based, sequential per entity kind */
export type LocalId = number
export type FxSource = 'base' | 'manual' | 'trip' | 'auto'

export interface ExportTrip {
  name: string
  destination: string
  centerLat: number | null
  centerLng: number | null
  startDate: string
  endDate: string
  tz: string
  baseCurrency: string
  secondaryCurrency: string | null
  localCurrencies: string[]
  coverColor: string | null
  summary: string
  style: TripStyle
  driveLimitMin: number | null
  poolRefundMode: 'proportional' | 'equal'
  /** {"NZD": 0.912345}: 1 unit of the key currency = value units of the base currency */
  fxOverrides: Record<string, number>
}

/** Names and colours only: no emails, user ids or tokens */
export interface ExportMember {
  id: LocalId
  name: string
  color: string
  role: Role
  /** Removed members stay in the file because expenses can still point at them */
  removed: boolean
}

export interface ExportDay {
  id: LocalId
  date: string | null
  /** 1-based Day number; null = unassigned */
  idx: number | null
  title: string
  color: string | null
  note: string
  lodging: LocalId | null
}

export interface ExportPlace {
  id: LocalId
  nameLocal: string
  nameEn: string
  lat: number
  lng: number
  address: string
  category: string
  source: PlaceSource
  hours: PlaceHours | null
  links: Link[]
}

export interface ExportStop {
  id: LocalId
  day: LocalId
  order: number
  type: StopType
  title: string
  place: LocalId | null
  startAt: string | null
  endAt: string | null
  durationMin: number | null
  costMinor: number | null
  currency: string | null
  booking: BookingState
  note: string
  links: Link[]
  wishlistItem: LocalId | null
  /** The transport/activity booking it belongs to (`bookings[].id`) */
  bookingRef: LocalId | null
  /** How the stop was created (manual, booking …); booking stops are kept in sync by E4 */
  source: string
  /** Which of the booking's stops this is: depart, arrive, pickup, dropoff, main, day:YYYY-MM-DD */
  bookingSlot: string | null
  lodging: LocalId | null
  isBackup: boolean
}

export interface ExportLeg {
  from: LocalId
  to: LocalId
  mode: LegMode
  minutes: number | null
}

export interface ExportLodging {
  id: LocalId
  place: LocalId | null
  name: string
  checkIn: string
  checkOut: string
  checkInTime: string | null
  checkOutTime: string | null
  roomType: string | null
  guests: number | null
  platform: string | null
  ref: string | null
  priceMinor: number | null
  currency: string | null
  payStatus: PayStatus
  cancelBy: string | null
  phone: string | null
  campType: 'holiday-park' | 'doc' | 'freedom' | null
  campFacilities: { power: boolean; water: boolean; dump: boolean } | null
  note: string
}

export interface ExportBooking {
  id: LocalId
  type: BookingType
  title: string
  /** Per-type details (shared/schema/booking.ts); the place ids in it (pickupPlaceId,
   * dropoffPlaceId, meetingPlaceId) are `places[].id` numbers */
  details: Record<string, unknown>
  startAt: string | null
  endAt: string | null
  startTz: string | null
  endTz: string | null
  priceMinor: number | null
  currency: string | null
  payStatus: PayStatus
  payer: LocalId | null
  cancelBy: string | null
  ref: string | null
  note: string
}

export interface ExportClaim {
  buyer: LocalId | null
  forName: string
  qty: number
  done: boolean
}

export interface ExportWishlistItem {
  id: LocalId
  category: WishlistCategory
  name: string
  place: LocalId | null
  estMinor: number | null
  currency: string | null
  sourceUrl: string | null
  sourceTitle: string | null
  sourceImageUrl: string | null
  recommender: LocalId | null
  note: string
  status: WishlistStatus
  stop: LocalId | null
  order: number
  /** Members who voted "I want to go" (`members[].id`) */
  votes: LocalId[]
  claims: ExportClaim[]
}

export interface ExportExpenseShare {
  member: LocalId
  idx: number
  weight: number | null
  percent: number | null
  amountMinor: number | null
  shareMinor: number
}

export interface ExportExpense {
  id: LocalId
  /** null when the pool paid */
  payer: LocalId | null
  payerIsPool: boolean
  amountMinor: number
  currency: string
  fxRate: number
  fxSource: FxSource
  fxDate: string | null
  baseMinor: number
  date: string
  category: ExpenseCategory
  note: string
  stop: LocalId | null
  day: LocalId | null
  bookingRef: LocalId | null
  wishlistItem: LocalId | null
  splitMethod: 'equal' | 'shares' | 'percent' | 'exact' | 'self'
  createdBy: LocalId | null
  shares: ExportExpenseShare[]
}

export interface ExportPoolContribution {
  member: LocalId
  amountMinor: number
  currency: string
  fxRate: number
  fxSource: FxSource
  fxDate: string | null
  baseMinor: number
  date: string
  note: string
  createdBy: LocalId | null
}

export interface ExportSettlement {
  from: LocalId
  to: LocalId
  amountMinor: number
  method: SettlementMethod
  note: string
  date: string
  createdBy: LocalId | null
}

/** Photo metadata only: the files are not in an export and an import does not recreate them */
export interface ExportAttachment {
  id: LocalId
  kind: 'photo'
  mime: string
  bytes: number
  width: number | null
  height: number | null
  takenAt: string | null
  lat: number | null
  lng: number | null
  place: LocalId | null
  stop: LocalId | null
  day: LocalId | null
  bookingRef: LocalId | null
  lodging: LocalId | null
  wishlistItem: LocalId | null
  visibility: 'trip' | 'members-only'
}

/** One to-do or packing item of a checklist (E9) */
export interface ExportChecklistItem {
  text: string
  note: string
  done: boolean
  /** On a packing list: who brings it (`members[].id`) */
  assignee: LocalId | null
  /** A calendar date (YYYY-MM-DD) in the trip's zone */
  dueAt: string | null
  order: number
  templateKey: string | null
  /** Where to confirm it, from the template: the label in the language it was applied in */
  linkHint: { label: string; url?: string } | null
}

export interface ExportChecklist {
  id: LocalId
  kind: ChecklistKind
  title: string
  order: number
  templateKey: string | null
  items: ExportChecklistItem[]
}

/** A budget row (E9): minor units of the trip's base currency, per member or for the group */
export interface ExportBudgetRow {
  category: BudgetCategory
  plannedMinor: number
  currency: string
  perPerson: boolean
}

/** A destination note (E9), markdown-lite body */
export interface ExportNote {
  section: NoteSection
  title: string
  body: string
  order: number
  templateKey: string | null
  shareable: boolean
}

/** A day's recap text (e8-t04) */
export interface ExportDayRecap {
  day: LocalId
  body: string
}

export interface TripExport {
  format: typeof TRIP_EXPORT_FORMAT
  version: typeof TRIP_EXPORT_VERSION
  exportedAt: string
  /** What `?include=` asked for; sections not asked for are missing from the file */
  includes: { expenses: boolean; photos: boolean }
  trip: ExportTrip
  members: ExportMember[]
  days: ExportDay[]
  places: ExportPlace[]
  stops: ExportStop[]
  legOverrides: ExportLeg[]
  lodgings: ExportLodging[]
  bookings: ExportBooking[]
  wishlist: ExportWishlistItem[]
  /** ?include=expenses */
  expenses?: ExportExpense[]
  poolContributions?: ExportPoolContribution[]
  settlements?: ExportSettlement[]
  /** ?include=photos (metadata only) */
  attachments?: ExportAttachment[]
  // Additive v1 extension (e8-t04, E9 prep data): always written by GET /export; files from before
  // it have none of them and still import.
  checklists?: ExportChecklist[]
  budgets?: ExportBudgetRow[]
  notes?: ExportNote[]
  dayRecaps?: ExportDayRecap[]
}

/** What an import or a clone carries over into the new trip. Checklists, the budget and notes
 * always come along (a clone unticks the checklists); day recaps come with an import, never with a
 * clone. */
export interface CopyOptions {
  /** The file's other members, as placeholder members (no tokens; claimable with an invite) */
  members: boolean
  /** Expenses, pool contributions and settlements (only with `members`) */
  expenses: boolean
  /** Clone only: the trip's photos (their R2 objects are copied); an import never has files */
  photos: boolean
}

/** POST /api/import (201) and POST /api/trips/:id/clone (201): like POST /api/trips */
export type ImportTripResponse = MemberTokenResponse & {
  /** What was left out and why, e.g. "expenses: needs members" */
  skipped: string[]
}

/** GET /api/trips/deleted: soft-deleted trips behind the device's memberTokens (X-Member-Tokens) */
export interface DeletedTripsResponse {
  trips: {
    tokenIndex: number
    trip: Pick<Trip, 'id' | 'name' | 'destination' | 'startDate' | 'endDate' | 'coverColor'>
    deletedAt: string
    /** deletedAt + 30 days: afterwards restore answers 410 and e11-t06 purges the trip */
    purgeAt: string
    /** Only the owner can restore */
    canRestore: boolean
  }[]
}

/** POST /api/trips/:id/restore */
export interface RestoreTripResponse {
  trip: Trip
  rev: number
}

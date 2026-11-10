// GET /api/share/:token (e8-t01a, e8-t01b): the read-only share page's payload. The Worker builds it field
// by field from an allow-list and applies the share's hide options itself (CLAUDE.md rule 4): a
// hidden field is absent from the JSON, never null or blanked, so the page has nothing to hide.

import type { LegMode } from '../itinerary/types.ts'
import type { BookingType } from '../schema/booking.ts'
import type { CampType, PayStatus } from '../schema/lodging.ts'
import type { BookingState, ShareOptions, StopType, TripStyle } from '../schema/index.ts'
import type { WishlistCategory } from '../schema/wishlist.ts'

export interface ShareTrip {
  name: string
  destination: string
  /** YYYY-MM-DD */
  startDate: string
  endDate: string
  /** IANA zone the trip's times are shown in */
  tz: string
  coverColor: string | null
  summary: string
  style: TripStyle
  /** Current (not removed) members */
  memberCount: number
  /** Assigned days (unassigned ones are not shared) */
  dayCount: number
  /** Absent with hideMoney */
  baseCurrency?: string
  /** Per-person estimate in baseCurrency minor units (the estimate's perPersonMinor); absent
   * with hideMoney or when nothing is priced in the base currency */
  estimatedPerPersonMinor?: number
  /** Cover photo (a ready photo with visibility 'trip'); read as /api/media/:id?s=<token> */
  coverAttachmentId?: string
}

export interface ShareStop {
  /** Sort key within the day (fractional); legs refer to stops by it */
  order: number
  type: StopType
  /** The stop's own title, else its place's local name */
  name: string
  /** The place's English name when the stop has no title of its own and the place has one */
  nameEn?: string
  lat?: number
  lng?: number
  /** Place address; absent with hideAddresses */
  address?: string
  /** UTC ISO; shown in the trip's zone */
  startAt?: string
  endAt?: string
  durationMin?: number
  note: string
  /** Integer minor units of `currency`; both absent with hideMoney or when not set */
  costMinor?: number
  currency?: string
  booking: BookingState
  /** Rainy-day alternative: not part of the day's legs and totals */
  isBackup: boolean
}

export interface ShareLeg {
  fromOrder: number
  toOrder: number
  mode: LegMode
  distanceM?: number
  durationS?: number
  /** route: cached routing; estimate: straight line x factor; manual: overridden time */
  source: 'route' | 'estimate' | 'manual'
}

export interface ShareDay {
  /** 1-based Day number */
  index: number
  date: string | null
  title: string
  /** The day colour from the editor; null means the default for its index */
  color: string | null
  note: string
  /** Tonight's lodging name (days.lodgingId); null when the night has none */
  lodgingName: string | null
  /** Checkout time (HH:mm, trip zone) of the lodging left this morning, when it has one */
  checkoutTime?: string
  /** Tonight's campsite kind (campervan trips) */
  campType?: CampType
  /** Up to 3 ready photos with visibility 'trip' of this day or its stops, by takenAt; read as
   * /api/media/:id/thumb?s=<token> */
  photoIds: string[]
  stops: ShareStop[]
  legs: ShareLeg[]
  /** Road minutes (drive and campervan legs) */
  driveMinutes: number
  /** Distance of all legs, metres */
  distanceM: number
  /** Recap text (e8-t04); only with the share option showRecap, once the trip has ended, and when
   * the day has one */
  recapBody?: string
  /** Recap photo wall (e8-t04): up to 9 ready photos with visibility 'trip' of this day or its
   * stops, by takenAt; only with showRecap after the end date. Read as
   * /api/media/:id/thumb?s=<token> */
  recapPhotoIds?: string[]
}

export interface SharePoint {
  lat: number
  lng: number
}

/** Whole-trip route: where Day N starts (last night's lodging, else its first located stop) to
 * where it sleeps (tonight's lodging, else its last located stop) */
export interface ShareOvernight {
  /** 1-based day travelled */
  dayIndex: number
  from: SharePoint
  to: SharePoint
  /** Name of the `to` end (the lodging, else the stop) */
  toName: string
  /** The `to` end is a lodging */
  toLodging: boolean
}

export interface SharePick {
  category: WishlistCategory
  name: string
  /** The place's English name, when it differs from `name` */
  nameEn?: string
  /** Estimate in `currency` minor units; both absent with hideMoney or when not set */
  estMinor?: number
  currency?: string
  /** A ready photo with visibility 'trip'; read as /api/media/:id/thumb?s=<token> */
  photoAttachmentId?: string
  /** The link preview's image (https only) */
  sourceImageUrl?: string
  /** Current members who want to go */
  votes: number
  place?: { lat: number; lng: number; nameLocal: string; nameEn: string }
  /** 1-based day it is scheduled on */
  dayIndex?: number
}

export const ESTIMATE_CATEGORIES = [
  'lodging',
  'transport',
  'food',
  'activity',
  'shopping',
  'other',
] as const
export type EstimateCategory = (typeof ESTIMATE_CATEGORIES)[number]

export interface EstimateLine {
  category: EstimateCategory
  minor: number
}

/** One currency's sums; minor units of `currency` */
export interface EstimateCurrency {
  currency: string
  totalMinor: number
  /** totalMinor split over the current members, rounded */
  perPersonMinor: number
  /** Non-zero categories in ESTIMATE_CATEGORIES order */
  breakdown: EstimateLine[]
}

/** 「概算」: stop costs (not rainy-day backups) + lodging prices + booking prices, summed per
 * currency without exchange rates. The base currency's sums are the top-level fields; prices in
 * other currencies are listed in `others`. Absent with hideMoney or when nothing is priced. */
export interface ShareEstimate {
  /** The trip's base currency */
  currency: string
  /** Absent when nothing is priced in the base currency */
  totalMinor?: number
  perPersonMinor?: number
  breakdown: EstimateLine[]
  others: EstimateCurrency[]
  /** Where perPersonMinor comes from: the trip's budget (E9, preferred when one is set) or the
   * priced items above split over the members. Absent means 'items' (older payloads). */
  perPersonSource?: 'budget' | 'items'
  /** The budget's group total in `currency`, when perPersonSource is 'budget' */
  budgetTotalMinor?: number
}

/** What a row of the bookings summary is: a lodging, or a transport / activity booking */
export type ShareBookingKind = 'lodging' | BookingType

/**
 * One row of the bookings summary (e8-t02, printed on the last page): lodgings and bookings, by
 * start. Dates and times are local wall-clock values worked out on the server (a lodging's in the
 * trip's zone, a booking's in the zone it was entered in, e.g. a flight's two airports).
 */
export interface ShareBooking {
  kind: ShareBookingKind
  title: string
  /** YYYY-MM-DD; absent when the booking has no time yet */
  startDate?: string
  /** HH:mm */
  startTime?: string
  endDate?: string
  endTime?: string
  /** Booking reference / confirmation number; absent with hideAddresses or when not set */
  ref?: string
  /** Integer minor units of `currency`; both absent with hideMoney or when not set */
  priceMinor?: number
  currency?: string
  payStatus: PayStatus
}

export interface SharePayload {
  trip: ShareTrip
  days: ShareDay[]
  /** Whole-trip route lines, in day order */
  overnight: ShareOvernight[]
  /** Wishlist highlights (not dropped): with an image first, then by votes; at most 24 */
  picks: SharePick[]
  /** Absent with hideMoney or when nothing is priced */
  estimate?: ShareEstimate
  /** Lodgings and transport / activity bookings, by start (undated ones last) */
  bookings: ShareBooking[]
  options: ShareOptions
  /** UTC ISO time the payload was built */
  generatedAt: string
}

// ---- Recap mode (e8-t04) ------------------------------------------------------------------------
// GET /api/trips/:id/recap (viewer) and PUT /api/trips/:id/days/:dayId/recap (editor),
// worker/trips/recap.ts. Recap money is app-only: share pages never get actual or estimate amounts.

/** A day's recap text is at most this many characters */
export const RECAP_MAX_CHARS = 4000
/** Photos per day in the share page's recap section */
export const SHARE_RECAP_PHOTOS = 9

/** A planned price that could not be converted to the base currency (no rate known) */
export interface RecapUnconverted {
  currency: string
  minor: number
}

export interface RecapDay {
  dayId: string
  /** 1-based Day number */
  index: number
  date: string | null
  title: string
  /** The day colour from the editor; null means the default for its index */
  color: string | null
  /** Absent when nobody has written one */
  recapBody?: string
  recapUpdatedAt?: string
  /** Ready photos of the day or its stops, by takenAt */
  photoIds: string[]
  /** Planned cost in base minor units: stop costs (not rainy-day backups) + the lodging's nightly
   * share + bookings starting that day, converted where a rate is known */
  estimateMinor: number
  /** Planned prices with no known rate (left out of estimateMinor), per currency */
  unconverted: RecapUnconverted[]
  /** Spent that day in base minor units (expenses by date, as GET /expenses/summary?by=day) */
  actualMinor: number
}

export interface RecapResponse {
  baseCurrency: string
  /** The trip's end date has passed in its own zone */
  ended: boolean
  days: RecapDay[]
  totals: {
    estimateMinor: number
    actualMinor: number
    /** Expenses dated outside the trip's days (not in actualMinor) */
    otherActualMinor: number
  }
  rev: number
}

/** PUT /api/trips/:id/days/:dayId/recap { body }: an empty body clears the recap */
export interface RecapPutBody {
  body: string
}

export interface RecapPutResponse {
  dayId: string
  /** '' when the recap was cleared */
  body: string
  updatedAt: string
  rev: number
}

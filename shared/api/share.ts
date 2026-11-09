// GET /api/share/:token (e8-t01a, e8-t01b): the read-only share page's payload. The Worker builds it field
// by field from an allow-list and applies the share's hide options itself (CLAUDE.md rule 4): a
// hidden field is absent from the JSON, never null or blanked, so the page has nothing to hide.

import type { LegMode } from '../itinerary/types.ts'
import type { CampType } from '../schema/lodging.ts'
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
  options: ShareOptions
  /** UTC ISO time the payload was built */
  generatedAt: string
}

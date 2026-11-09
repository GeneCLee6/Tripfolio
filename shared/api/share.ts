// GET /api/share/:token (e8-t01a): the read-only share page's payload. The Worker builds it field
// by field from an allow-list and applies the share's hide options itself (CLAUDE.md rule 4): a
// hidden field is absent from the JSON, never null or blanked, so the page has nothing to hide.

import type { LegMode } from '../itinerary/types.ts'
import type { BookingState, ShareOptions, StopType, TripStyle } from '../schema/index.ts'

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
  /** Per-person estimate in baseCurrency minor units; absent with hideMoney or until E9 budgets */
  estimatedPerPersonMinor?: number
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
  /** Tonight's lodging name; null until E4 */
  lodgingName: string | null
  stops: ShareStop[]
  legs: ShareLeg[]
  /** Road minutes (drive and campervan legs) */
  driveMinutes: number
  /** Distance of all legs, metres */
  distanceM: number
}

export interface SharePayload {
  trip: ShareTrip
  days: ShareDay[]
  options: ShareOptions
  /** UTC ISO time the payload was built */
  generatedAt: string
}

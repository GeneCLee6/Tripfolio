// Response shapes of the REST API (worker/app.ts). Request bodies are the zod schemas in
// shared/schema. Every write answers with the trip's new `rev` (for the later TripDO sync).

import type { Link, PlaceHours, Role, ShareOptions, TripStyle } from '../schema/index.ts'
import type { BookingState, LegMode, PlaceSource, StopType } from '../schema/index.ts'
import type { WishlistCategory, WishlistStatus } from '../schema/index.ts'

/** Every /api/trips/:id/* request: `Authorization: Bearer <memberToken>` */
export const AUTH_HEADER = 'authorization'
/** GET /api/trips: the device's memberTokens, comma-separated (there are no accounts) */
export const MEMBER_TOKENS_HEADER = 'x-member-tokens'
/** The most tokens GET /api/trips looks at */
export const MAX_MEMBER_TOKENS = 50

export interface ApiErrorBody {
  error: {
    /** unauthorized 401 · forbidden / trip_archived 403 · not_found 404 · method_not_allowed 405 ·
     * invalid / invalid_json 422 */
    code: string
    message: string
    /** zod issues for 422 */
    details?: unknown
  }
}

export interface Trip {
  id: string
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
  coverAttachmentId: string | null
  summary: string
  style: TripStyle
  driveLimitMin: number | null
  ownerMemberId: string
  /** Bumped by every write to the trip or anything in it */
  rev: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  deletedAt: string | null
}

export interface Member {
  id: string
  tripId: string
  name: string
  color: string
  email: string | null
  role: Role
  createdAt: string
  updatedAt: string
}

export interface Day {
  id: string
  tripId: string
  /** The date it was last assigned to; kept when the day becomes unassigned */
  date: string | null
  /** 1-based Day number; null = unassigned (outside the trip's dates, stops kept) */
  idx: number | null
  title: string
  color: string | null
  note: string
  lodgingId: string | null
  rev: number
  updatedAt: string
}

export interface Stop {
  id: string
  tripId: string
  dayId: string
  /** Fractional sort key within the day */
  order: number
  type: StopType
  title: string
  placeId: string | null
  startAt: string | null
  endAt: string | null
  durationMin: number | null
  costMinor: number | null
  currency: string | null
  booking: BookingState
  note: string
  links: Link[]
  wishlistItemId: string | null
  bookingId: string | null
  /** 'manual', or 'booking' for the stops a booking created (e4-t01); always sent by the API */
  source?: StopSource
  /** Which of its booking's stops this is ('depart', 'arrive', 'pickup', 'dropoff', 'main',
   * 'day:YYYY-MM-DD'); null for manual stops. Optional in the type only (older fixtures); the API
   * always sends it */
  bookingSlot?: string | null
  isBackup: boolean
  rev: number
  updatedAt: string
}

export type StopSource = 'manual' | 'booking'

export interface LegOverride {
  tripId: string
  fromStopId: string
  toStopId: string
  mode: LegMode
  minutes: number | null
  rev: number
  updatedAt: string
}

export interface Place {
  id: string
  tripId: string
  nameLocal: string
  nameEn: string
  lat: number
  lng: number
  address: string
  category: string
  source: PlaceSource
  hours: PlaceHours | null
  links: Link[]
  /** The search provider's id (`osm:N…`); null for manual pins, links and coordinates. Optional
   * in the type only (older fixtures); the API always sends it */
  externalId?: string | null
  rev: number
  createdAt: string
  updatedAt: string
}

export interface Invite {
  id: string
  tripId: string
  createdAt: string
  revokedAt: string | null
}

export interface Share {
  id: string
  tripId: string
  options: ShareOptions
  createdAt: string
  revokedAt: string | null
}

export interface Rev {
  rev: number
}

export type DayWithStops = Day & { stops: Stop[] }

// ---- responses ----

/** POST /api/trips (201) and POST /api/join/:inviteToken (201): keep memberToken in localStorage */
export interface MemberTokenResponse extends Rev {
  trip: Trip
  member: Member
  memberToken: string
}
export type CreateTripResponse = MemberTokenResponse & { days: Day[] }

/** GET /api/trips: tokenIndex points into the X-Member-Tokens list; tokens missing from `trips`
 * are revoked, removed or for deleted trips and can be dropped */
export interface TripListResponse {
  trips: {
    tokenIndex: number
    trip: Trip
    member: Member
    /** Current (not removed) members */
    memberCount: number
    /** Assigned days (idx not null) */
    dayCount: number
  }[]
}

/** GET /api/trips/:id */
export interface TripDetailResponse extends Rev {
  trip: Trip
  me: Member
  members: Member[]
}

/** GET /api/join/:inviteToken: what the "who are you" screen shows */
export interface JoinPreviewResponse {
  trip: Pick<Trip, 'id' | 'name' | 'destination' | 'startDate' | 'endDate' | 'coverColor'>
  /** Members an invitee may claim (the owner is never claimable) */
  members: Pick<Member, 'id' | 'name' | 'color' | 'role'>[]
}

/** GET /api/trips/:id/days: assigned days by idx, then unassigned ones */
export interface DaysResponse extends Rev {
  days: DayWithStops[]
  legs: LegOverride[]
}

export interface PlaceRefsResponse {
  stops: Pick<Stop, 'id' | 'dayId' | 'title'>[]
  /** Wishlist items (not deleted) at this place */
  wishlistItems: Pick<WishlistItem, 'id' | 'name' | 'status'>[]
  /** Lodgings (not deleted) at this place */
  lodgings: { id: string; name: string; checkIn: string }[]
  /** Bookings (not deleted) whose details point at it (pickup / dropoff / meeting place) */
  bookings: { id: string; title: string; type: string; fields: string[] }[]
}

/** POST /api/trips/:id/invites (201): the token is only ever returned here */
export interface CreateInviteResponse extends Rev {
  invite: Invite
  inviteToken: string
}

/** POST /api/trips/:id/shares (201): the token is only ever returned here */
export interface CreateShareResponse extends Rev {
  share: Share
  shareToken: string
}

/** GET /api/share/:token: already filtered on the server (E8 fills `days`) */
export interface PublicShareResponse {
  trip: Pick<
    Trip,
    'name' | 'destination' | 'startDate' | 'endDate' | 'tz' | 'coverColor' | 'summary'
  >
  days: never[]
}

// ---- wishlist (e5-t01) ----

export interface WishlistItem {
  id: string
  tripId: string
  category: WishlistCategory
  name: string
  placeId: string | null
  photoAttachmentId: string | null
  /** Integer minor units of `currency` */
  estMinor: number | null
  currency: string | null
  sourceUrl: string | null
  sourceTitle: string | null
  sourceImageUrl: string | null
  recommenderMemberId: string | null
  note: string
  status: WishlistStatus
  /** The stop it was scheduled as; that stop's wishlistItemId points back */
  stopId: string | null
  /** Fractional sort key within the trip's wishlist */
  order: number
  rev: number
  createdAt: string
  updatedAt: string
}

export interface WishlistClaim {
  id: string
  itemId: string
  buyerMemberId: string | null
  forName: string
  qty: number
  done: boolean
  createdAt: string
  updatedAt: string
}

export type WishlistPlaceSummary = Pick<Place, 'id' | 'nameLocal' | 'nameEn' | 'lat' | 'lng'>

/** An item as the API returns it: who voted (current members only), claims, place summary */
export interface WishlistItemView extends WishlistItem {
  votes: string[]
  claims: WishlistClaim[]
  place: WishlistPlaceSummary | null
}

/** GET /api/trips/:id/wishlist?status=&category= : by order */
export interface WishlistResponse extends Rev {
  items: WishlistItemView[]
}

/** POST/PATCH …/wishlist(/:wid), POST/DELETE …/vote, POST …/unschedule */
export interface WishlistItemResponse extends Rev {
  item: WishlistItemView
}

/** POST/PATCH …/wishlist/:wid/claims(/:cid) */
export interface WishlistClaimResponse extends Rev {
  claim: WishlistClaim
}

/** POST …/wishlist/:wid/schedule (201): the new stop, linked both ways */
export interface WishlistScheduleResponse extends Rev {
  item: WishlistItemView
  stop: Stop
}

/** POST …/wishlist/:wid/unschedule: the stop that was deleted (null if it was already gone) */
export interface WishlistUnscheduleResponse extends WishlistItemResponse {
  deletedStopId: string | null
}

/** GET /api/trips/:id/pocket: what the itinerary sidebar can drag into a day (E2) */
export interface PocketResponse extends Rev {
  /** Wishlist items with status wish, by order */
  items: WishlistItemView[]
  /** Places no stop and no (non-deleted) wishlist item points at */
  places: Place[]
}

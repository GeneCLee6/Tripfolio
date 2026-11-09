// Response shapes of the REST API (worker/app.ts). Request bodies are the zod schemas in
// shared/schema. Every write answers with the trip's new `rev` (for the later TripDO sync).

import type { Link, PlaceHours, Role, ShareOptions, TripStyle } from '../schema/index.ts'
import type { BookingState, LegMode, PlaceSource, StopType } from '../schema/index.ts'

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
  isBackup: boolean
  rev: number
  updatedAt: string
}

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
  trips: { tokenIndex: number; trip: Trip; member: Member }[]
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

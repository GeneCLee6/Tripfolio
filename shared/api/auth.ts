// Optional Google sign-in (e1-t06, ARCHITECTURE.md §4.1): response shapes of /api/auth/* and the
// member link routes. The session lives in an HttpOnly cookie, so nothing here carries it.

import type { Member, Trip } from './types.ts'

/** The signed-in Google account (no email verification state, no tokens) */
export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  picture: string | null
}

/** GET /api/auth/me → 200; 401 `unauthorized` when signed out, 503 `auth_disabled` when the
 * owner has not configured Google sign-in (the UI then hides the button) */
export interface AuthMeResponse {
  user: AuthUser
}

/** POST /api/auth/trips: one entry per trip a member of which is linked to the account */
export interface AuthTripEntry {
  trip: Trip
  member: Member
  /** A fresh memberToken for this device, or null when the device already sent a valid token for
   * this trip (X-Member-Tokens) and nothing was minted */
  memberToken: string | null
}

export interface AuthTripsResponse {
  trips: AuthTripEntry[]
}

/** GET/POST/DELETE /api/trips/:id/members/me/link */
export interface MemberLinkResponse {
  /** Whether the signed-in account is linked to the caller's member in this trip */
  linked: boolean
  /** Whether the account is linked to another member of this trip (POST replaces it) */
  linkedToOther: boolean
}

/** The error code /api/auth/* answers with (503) when Google sign-in is not configured */
export const AUTH_DISABLED = 'auth_disabled'

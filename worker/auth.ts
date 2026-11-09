// Tokens and roles (ARCHITECTURE.md §4.1). memberToken, inviteToken and shareToken are 16 random
// bytes as base64url; D1 only stores their SHA-256 (hex). A memberToken binds (trip, member): every
// /api/trips/:id/* request carries `Authorization: Bearer <memberToken>`.

import type { Member, Trip } from '../shared/api/types.ts'
import type { Role } from '../shared/schema/member.ts'
import { toMember, toTrip, type Row } from './db.ts'
import { ApiError, forbidden, notFound, unauthorized } from './http.ts'

const roleRank: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

export function roleAtLeast(role: Role, minRole: Role): boolean {
  return roleRank[role] >= roleRank[minRole]
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 128-bit random token, base64url (22 characters) */
export function generateToken(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  return bytesToBase64Url(random(new Uint8Array(16)))
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/

/** Cheap shape check before touching D1 */
export function isTokenShaped(token: string): boolean {
  return TOKEN_SHAPE.test(token)
}

/** SHA-256 of the token as lowercase hex: what D1 stores */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Compares two strings without an early exit on the first difference */
export function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header?.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : null
}

export interface MemberAuth {
  trip: Trip
  member: Member
  role: Role
}

/**
 * memberToken → { trip, member, role }, or null when the token is unknown, revoked, belongs to a
 * removed member or to a deleted trip. The D1 lookup is by hash; the hash is then compared again in
 * constant time so the check never relies on the index lookup alone.
 */
export async function resolveMemberToken(
  db: D1Database,
  token: string,
): Promise<MemberAuth | null> {
  if (!isTokenShaped(token)) return null
  const tokenHash = await hashToken(token)
  const row = await db
    .prepare(
      `SELECT t.tokenHash AS tokenHash, m.*
         FROM memberTokens t JOIN members m ON m.id = t.memberId
        WHERE t.tokenHash = ? AND t.revokedAt IS NULL AND m.removedAt IS NULL`,
    )
    .bind(tokenHash)
    .first<Row>()
  if (!row || !timingSafeEqual(String(row.tokenHash), tokenHash)) return null
  const tripRow = await db
    .prepare('SELECT * FROM trips WHERE id = ? AND deletedAt IS NULL')
    .bind(row.tripId)
    .first<Row>()
  if (!tripRow) return null
  const member = toMember(row)
  return { trip: toTrip(tripRow), member, role: member.role }
}

export function requireRole(auth: MemberAuth, minRole: Role): MemberAuth {
  if (!roleAtLeast(auth.role, minRole)) throw forbidden(`requires ${minRole}`)
  return auth
}

/** Archived trips are read-only (E1 lifecycle) */
export function requireWritable(auth: MemberAuth): MemberAuth {
  if (auth.trip.archivedAt) throw new ApiError(403, 'trip_archived', 'the trip is archived')
  return auth
}

/**
 * The role middleware for /api/trips/:id/*: 401 without a valid token, 404 when the trip is gone
 * or the token is for another trip (no probing other trip ids), 403 below `minRole`.
 * Writes (minRole editor or owner) are also refused on archived trips unless `allowArchived`.
 */
export async function authTrip(
  request: Request,
  db: D1Database,
  tripId: string,
  minRole: Role,
  { allowArchived = false }: { allowArchived?: boolean } = {},
): Promise<MemberAuth> {
  const token = bearerToken(request)
  if (!token) throw unauthorized()
  const auth = await resolveMemberToken(db, token)
  if (!auth) throw unauthorized()
  if (auth.trip.id !== tripId) throw notFound('trip not found')
  requireRole(auth, minRole)
  if (minRole !== 'viewer' && !allowArchived) requireWritable(auth)
  return auth
}

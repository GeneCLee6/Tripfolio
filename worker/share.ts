// Share links (e1-t01; the read-only page is E8). Hiding happens here, on the server: the public
// endpoint builds its answer field by field from an allow-list, so nothing hidden ever leaves the
// Worker (CLAUDE.md rule 4).

import type { CreateShareResponse, PublicShareResponse } from '../shared/api/types.ts'
import { shareCreateSchema } from '../shared/schema/share.ts'
import { authTrip, generateToken, hashToken, isTokenShaped } from './auth.ts'
import { insertStatement, toShare, toTrip, writeWithRev, type Row } from './db.ts'
import { json, noStore, notFound, nowIso, readBody } from './http.ts'
import type { RouteContext } from './router.ts'

/** GET /api/trips/:id/shares (owner): active share links, without tokens */
export async function listShares(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'owner', { allowArchived: true })
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM shares WHERE tripId = ? AND revokedAt IS NULL ORDER BY createdAt',
  )
    .bind(auth.trip.id)
    .all<Row>()
  return json({ shares: results.map(toShare) })
}

/** POST /api/trips/:id/shares (owner): `{ options }`; the token is only ever returned here */
export async function createShare(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const { options } = await readBody(c.request, shareCreateSchema)
  const now = nowIso()
  const id = crypto.randomUUID()
  const shareToken = generateToken()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'shares', {
      id,
      tripId: auth.trip.id,
      tokenHash: await hashToken(shareToken),
      options,
      createdByMemberId: auth.member.id,
      createdAt: now,
    }),
  ])
  const body: CreateShareResponse = {
    share: { id, tripId: auth.trip.id, options, createdAt: now, revokedAt: null },
    shareToken,
    rev,
  }
  return json(body, 201)
}

/** DELETE /api/trips/:id/shares/:sid (owner): revoke */
export async function revokeShare(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const row = await db
    .prepare('SELECT id FROM shares WHERE id = ? AND tripId = ? AND revokedAt IS NULL')
    .bind(c.params.sid, auth.trip.id)
    .first<Row>()
  if (!row) throw notFound('share not found')
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('UPDATE shares SET revokedAt = ? WHERE id = ?').bind(nowIso(), c.params.sid),
  ])
  return json({ ok: true, rev })
}

/** GET /api/share/:token: public, read-only, filtered. E8 (C1) fills `days` honouring the options */
export async function publicShare(c: RouteContext): Promise<Response> {
  const token = c.params.token
  const row = isTokenShaped(token)
    ? await c.env.DB.prepare(
        `SELECT t.* FROM shares s JOIN trips t ON t.id = s.tripId
          WHERE s.tokenHash = ? AND s.revokedAt IS NULL AND t.deletedAt IS NULL`,
      )
        .bind(await hashToken(token))
        .first<Row>()
    : null
  if (!row) throw notFound('share not found')
  const trip = toTrip(row)
  const body: PublicShareResponse = {
    trip: {
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      tz: trip.tz,
      coverColor: trip.coverColor,
      summary: trip.summary,
    },
    days: [],
  }
  return Response.json(body, { headers: { ...noStore, 'x-robots-tag': 'noindex' } })
}

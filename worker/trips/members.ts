// Members, invites and joining (e1-t01). Members are people in this trip, not accounts. An invite
// link makes the holder an editor: they claim an existing (non-owner) member or create one, and get
// a memberToken for this device.

import type {
  CreateInviteResponse,
  JoinPreviewResponse,
  MemberTokenResponse,
} from '../../shared/api/types.ts'
import { joinSchema, memberCreateSchema, memberPatchSchema } from '../../shared/schema/member.ts'
import {
  authTrip,
  generateToken,
  hashToken,
  isTokenShaped,
  requireRole,
  requireWritable,
} from '../auth.ts'
import {
  insertStatement,
  toInvite,
  toMember,
  toTrip,
  updateStatement,
  writeWithRev,
  type Row,
} from '../db.ts'
import { forbidden, json, notFound, nowIso, readBody } from '../http.ts'
import type { RouteContext } from '../router.ts'
import { notifyTrip } from '../sync.ts'

async function loadMember(db: D1Database, tripId: string, memberId: string) {
  const row = await db
    .prepare('SELECT * FROM members WHERE id = ? AND tripId = ? AND removedAt IS NULL')
    .bind(memberId, tripId)
    .first<Row>()
  if (!row) throw notFound('member not found')
  return toMember(row)
}

/** POST /api/trips/:id/members (owner) */
export async function createMember(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner')
  const body = await readBody(c.request, memberCreateSchema)
  const now = nowIso()
  const id = crypto.randomUUID()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'members', {
      id,
      tripId: auth.trip.id,
      ...body,
      createdAt: now,
      updatedAt: now,
    }),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'member', id, action: 'upsert', by: auth.member.id })
  return json({ member: await loadMember(db, auth.trip.id, id), rev }, 201)
}

/** PATCH /api/trips/:id/members/:mid: owner, or members editing their own name/colour/email */
export async function patchMember(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = requireWritable(await authTrip(c.request, db, c.params.id, 'viewer'))
  const target = await loadMember(db, auth.trip.id, c.params.mid)
  const body = await readBody(c.request, memberPatchSchema)
  if (target.id !== auth.member.id) requireRole(auth, 'owner')
  if (body.role !== undefined) {
    requireRole(auth, 'owner')
    if (target.role === 'owner') throw forbidden('the owner role cannot be changed')
  }
  const now = nowIso()
  const update = updateStatement(
    db,
    'members',
    body,
    ['name', 'color', 'email', 'role'],
    now,
    {
      sql: 'id = ?',
      values: [target.id],
    },
    { bumpRowRev: false },
  )
  const rev = update ? await writeWithRev(db, auth.trip.id, [update]) : auth.trip.rev
  if (update) notifyTrip(c.env, auth.trip.id, { rev, entity: 'member', id: target.id, action: 'upsert', by: auth.member.id })
  return json({ member: await loadMember(db, auth.trip.id, target.id), rev })
}

/** DELETE /api/trips/:id/members/:mid (owner): marks removed and revokes the member's tokens */
export async function deleteMember(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner')
  const target = await loadMember(db, auth.trip.id, c.params.mid)
  if (target.role === 'owner') throw forbidden('the owner cannot be removed')
  const now = nowIso()
  const rev = await writeWithRev(db, auth.trip.id, [
    db
      .prepare('UPDATE members SET removedAt = ?, updatedAt = ? WHERE id = ?')
      .bind(now, now, target.id),
    db
      .prepare('UPDATE memberTokens SET revokedAt = ? WHERE memberId = ? AND revokedAt IS NULL')
      .bind(now, target.id),
  ])
  notifyTrip(c.env, auth.trip.id, { rev, entity: 'member', id: target.id, action: 'delete', by: auth.member.id })
  return json({ ok: true, rev })
}

/** GET /api/trips/:id/invites (owner): active invites, without tokens */
export async function listInvites(c: RouteContext): Promise<Response> {
  const auth = await authTrip(c.request, c.env.DB, c.params.id, 'owner', { allowArchived: true })
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM invites WHERE tripId = ? AND revokedAt IS NULL ORDER BY createdAt',
  )
    .bind(auth.trip.id)
    .all<Row>()
  return json({ invites: results.map(toInvite) })
}

/** POST /api/trips/:id/invites (owner): the token is only ever returned here */
export async function createInvite(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner')
  const now = nowIso()
  const id = crypto.randomUUID()
  const inviteToken = generateToken()
  const rev = await writeWithRev(db, auth.trip.id, [
    insertStatement(db, 'invites', {
      id,
      tripId: auth.trip.id,
      tokenHash: await hashToken(inviteToken),
      createdByMemberId: auth.member.id,
      createdAt: now,
    }),
  ])
  const body: CreateInviteResponse = {
    invite: { id, tripId: auth.trip.id, createdAt: now, revokedAt: null },
    inviteToken,
    rev,
  }
  return json(body, 201)
}

/** DELETE /api/trips/:id/invites/:iid (owner): revoke */
export async function revokeInvite(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const auth = await authTrip(c.request, db, c.params.id, 'owner', { allowArchived: true })
  const row = await db
    .prepare('SELECT id FROM invites WHERE id = ? AND tripId = ? AND revokedAt IS NULL')
    .bind(c.params.iid, auth.trip.id)
    .first<Row>()
  if (!row) throw notFound('invite not found')
  const rev = await writeWithRev(db, auth.trip.id, [
    db.prepare('UPDATE invites SET revokedAt = ? WHERE id = ?').bind(nowIso(), c.params.iid),
  ])
  return json({ ok: true, rev })
}

async function resolveInvite(db: D1Database, token: string) {
  if (!isTokenShaped(token)) throw notFound('invite not found')
  const row = await db
    .prepare(
      `SELECT t.* FROM invites i JOIN trips t ON t.id = i.tripId
        WHERE i.tokenHash = ? AND i.revokedAt IS NULL AND t.deletedAt IS NULL`,
    )
    .bind(await hashToken(token))
    .first<Row>()
  if (!row) throw notFound('invite not found')
  return toTrip(row)
}

/** GET /api/join/:inviteToken: the "who are you" screen; no auth */
export async function previewJoin(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const trip = await resolveInvite(db, c.params.token)
  const { results } = await db
    .prepare(
      `SELECT id, name, color, role FROM members
        WHERE tripId = ? AND removedAt IS NULL AND role != 'owner' ORDER BY createdAt, id`,
    )
    .bind(trip.id)
    .all<Row>()
  const body: JoinPreviewResponse = {
    trip: {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      coverColor: trip.coverColor,
    },
    members: results.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      color: String(r.color),
      role: String(r.role) as 'editor' | 'viewer',
    })),
  }
  return json(body)
}

/** POST /api/join/:inviteToken: `{ memberId }` claims a member, `{ name, color }` creates one */
export async function join(c: RouteContext): Promise<Response> {
  const db = c.env.DB
  const trip = await resolveInvite(db, c.params.token)
  const body = await readBody(c.request, joinSchema)
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  let memberId: string
  if ('memberId' in body) {
    const member = await loadMember(db, trip.id, body.memberId)
    if (member.role === 'owner') throw forbidden('the owner cannot be claimed through an invite')
    memberId = member.id
  } else {
    memberId = crypto.randomUUID()
    statements.push(
      insertStatement(db, 'members', {
        id: memberId,
        tripId: trip.id,
        name: body.name,
        color: body.color,
        role: 'editor',
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  const memberToken = generateToken()
  statements.push(
    insertStatement(db, 'memberTokens', {
      tokenHash: await hashToken(memberToken),
      tripId: trip.id,
      memberId,
      createdAt: now,
    }),
  )
  const rev = await writeWithRev(db, trip.id, statements)
  notifyTrip(c.env, trip.id, { rev, entity: 'member', id: memberId, action: 'upsert', by: memberId })
  const response: MemberTokenResponse = {
    trip: { ...trip, rev },
    member: await loadMember(db, trip.id, memberId),
    memberToken,
    rev,
  }
  return json(response, 201)
}

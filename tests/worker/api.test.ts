import { beforeEach, describe, expect, it } from 'vitest'
import type {
  CreateInviteResponse,
  CreateShareResponse,
  CreateTripResponse,
  DaysResponse,
  MemberTokenResponse,
  Place,
  Stop,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

let env: Env

beforeEach(() => {
  env = { DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
})

interface Call {
  token?: string
  body?: unknown
  headers?: Record<string, string>
}

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  { token, body, headers = {} }: Call = {},
): Promise<{ status: number; body: T }> {
  const h: Record<string, string> = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined) h['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  expect(response.headers.get('cache-control')).toBe('no-store')
  return { status: response.status, body: (await response.json()) as T }
}

const tripBody = {
  name: 'NZ South Island',
  destination: 'New Zealand',
  startDate: '2026-12-20',
  endDate: '2026-12-22',
  tz: 'Pacific/Auckland',
  localCurrencies: ['NZD'],
  style: 'campervan',
  owner: { name: 'Gene', color: 'teal' },
}

async function createTrip() {
  const res = await call<CreateTripResponse>('POST', '/api/trips', { body: tripBody })
  expect(res.status).toBe(201)
  return res.body
}

async function joinAsEditor(ownerToken: string, tripId: string) {
  const invite = await call<CreateInviteResponse>('POST', `/api/trips/${tripId}/invites`, {
    token: ownerToken,
  })
  const joined = await call<MemberTokenResponse>('POST', `/api/join/${invite.body.inviteToken}`, {
    body: { name: 'Amy', color: 'rose' },
  })
  expect(joined.status).toBe(201)
  return joined.body
}

describe('trips', () => {
  it('creates a trip with owner, token, defaults and one Day per date', async () => {
    const created = await createTrip()
    expect(created.memberToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(created.member).toMatchObject({ name: 'Gene', role: 'owner' })
    expect(created.trip).toMatchObject({
      name: 'NZ South Island',
      baseCurrency: 'AUD',
      secondaryCurrency: 'TWD',
      localCurrencies: ['NZD'],
      style: 'campervan',
      ownerMemberId: created.member.id,
      rev: 1,
    })
    expect(created.rev).toBe(1)
    expect(created.days.map((d) => [d.idx, d.date])).toEqual([
      [1, '2026-12-20'],
      [2, '2026-12-21'],
      [3, '2026-12-22'],
    ])
  })

  it('stores only the token hash', async () => {
    const { db } = createFakeD1()
    env = { DB: db } as unknown as Env
    const created = await createTrip()
    const rows = await db.prepare('SELECT tokenHash FROM memberTokens').all<{ tokenHash: string }>()
    expect(rows.results).toHaveLength(1)
    expect(rows.results[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rows.results[0].tokenHash).not.toContain(created.memberToken)
  })

  it('validates the body with 422', async () => {
    const res = await call<{ error: { code: string } }>('POST', '/api/trips', {
      body: { ...tripBody, tz: 'Nowhere/Land' },
    })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('invalid')
    const bad = await call<{ error: { code: string } }>('POST', '/api/trips', { body: undefined })
    expect(bad.status).toBe(422)
  })

  it('needs a member token: 401 without, 404 for another trip', async () => {
    const a = await createTrip()
    const b = await createTrip()
    expect((await call('GET', `/api/trips/${a.trip.id}`)).status).toBe(401)
    expect((await call('GET', `/api/trips/${a.trip.id}`, { token: 'x'.repeat(22) })).status).toBe(
      401,
    )
    expect((await call('GET', `/api/trips/${a.trip.id}`, { token: b.memberToken })).status).toBe(
      404,
    )
    const ok = await call<{ me: { role: string }; members: unknown[] }>(
      'GET',
      `/api/trips/${a.trip.id}`,
      { token: a.memberToken },
    )
    expect(ok.status).toBe(200)
    expect(ok.body.me.role).toBe('owner')
    expect(ok.body.members).toHaveLength(1)
  })

  it('lists the trips behind X-Member-Tokens', async () => {
    const a = await createTrip()
    const b = await createTrip()
    const res = await call<{ trips: { tokenIndex: number; trip: { id: string } }[] }>(
      'GET',
      '/api/trips',
      { headers: { 'x-member-tokens': `${a.memberToken}, bogus,${b.memberToken}` } },
    )
    expect(res.body.trips.map((t) => [t.tokenIndex, t.trip.id])).toEqual([
      [0, a.trip.id],
      [2, b.trip.id],
    ])
  })

  it('PATCH bumps rev; date changes keep extra days unassigned', async () => {
    const t = await createTrip()
    const res = await call<{ trip: { name: string; endDate: string }; rev: number }>(
      'PATCH',
      `/api/trips/${t.trip.id}`,
      { token: t.memberToken, body: { name: 'NZ', endDate: '2026-12-21' } },
    )
    expect(res.status).toBe(200)
    expect(res.body.trip).toMatchObject({ name: 'NZ', endDate: '2026-12-21' })
    expect(res.body.rev).toBe(2)
    const days = await call<DaysResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    expect(days.body.days.map((d) => d.idx)).toEqual([1, 2, null])
    expect(days.body.rev).toBe(2)
    const back = await call<{ rev: number }>('PATCH', `/api/trips/${t.trip.id}`, {
      token: t.memberToken,
      body: { endDate: '2026-12-23' },
    })
    expect(back.status).toBe(200)
    const again = await call<DaysResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    expect(again.body.days.map((d) => [d.idx, d.date])).toEqual([
      [1, '2026-12-20'],
      [2, '2026-12-21'],
      [3, '2026-12-22'],
      [4, '2026-12-23'],
    ])
    expect(again.body.days[2].id).toBe(t.days[2].id)
  })

  it('archive: owner only, then read-only until unarchived', async () => {
    const t = await createTrip()
    const amy = await joinAsEditor(t.memberToken, t.trip.id)
    const path = `/api/trips/${t.trip.id}`
    expect(
      (await call('PATCH', path, { token: amy.memberToken, body: { archived: true } })).status,
    ).toBe(403)
    expect(
      (await call('PATCH', path, { token: t.memberToken, body: { archived: true } })).status,
    ).toBe(200)
    const blocked = await call<{ error: { code: string } }>('POST', `${path}/places`, {
      token: amy.memberToken,
      body: { nameLocal: 'X', lat: 0, lng: 0 },
    })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('trip_archived')
    expect(
      (await call('PATCH', path, { token: t.memberToken, body: { archived: false } })).status,
    ).toBe(200)
  })

  it('soft-deletes for the owner only', async () => {
    const t = await createTrip()
    const amy = await joinAsEditor(t.memberToken, t.trip.id)
    expect(
      (await call('DELETE', `/api/trips/${t.trip.id}`, { token: amy.memberToken })).status,
    ).toBe(403)
    expect((await call('DELETE', `/api/trips/${t.trip.id}`, { token: t.memberToken })).status).toBe(
      200,
    )
    const list = await call<{ trips: unknown[] }>('GET', '/api/trips', {
      headers: { 'x-member-tokens': t.memberToken },
    })
    expect(list.body.trips).toEqual([])
  })
})

describe('members and invites', () => {
  it('owner adds members; an invitee claims one and gets its role', async () => {
    const t = await createTrip()
    const kid = await call<{ member: { id: string; role: string } }>(
      'POST',
      `/api/trips/${t.trip.id}/members`,
      { token: t.memberToken, body: { name: 'Kid', color: 'amber', role: 'viewer' } },
    )
    expect(kid.status).toBe(201)
    const invite = await call<CreateInviteResponse>('POST', `/api/trips/${t.trip.id}/invites`, {
      token: t.memberToken,
    })
    const preview = await call<{ members: { id: string }[] }>(
      'GET',
      `/api/join/${invite.body.inviteToken}`,
    )
    expect(preview.body.members.map((m) => m.id)).toEqual([kid.body.member.id])
    // The owner cannot be claimed through an invite
    const claimOwner = await call('POST', `/api/join/${invite.body.inviteToken}`, {
      body: { memberId: t.member.id },
    })
    expect(claimOwner.status).toBe(403)
    const claimed = await call<MemberTokenResponse>(
      'POST',
      `/api/join/${invite.body.inviteToken}`,
      {
        body: { memberId: kid.body.member.id },
      },
    )
    expect(claimed.status).toBe(201)
    expect(claimed.body.member.role).toBe('viewer')
    // A viewer cannot write content
    const write = await call('POST', `/api/trips/${t.trip.id}/places`, {
      token: claimed.body.memberToken,
      body: { nameLocal: 'X', lat: 0, lng: 0 },
    })
    expect(write.status).toBe(403)
  })

  it('editors cannot manage members or invites; revoked invites stop working', async () => {
    const t = await createTrip()
    const amy = await joinAsEditor(t.memberToken, t.trip.id)
    expect(amy.member.role).toBe('editor')
    expect(
      (await call('POST', `/api/trips/${t.trip.id}/invites`, { token: amy.memberToken })).status,
    ).toBe(403)
    const invite = await call<CreateInviteResponse>('POST', `/api/trips/${t.trip.id}/invites`, {
      token: t.memberToken,
    })
    const revoked = await call(
      'DELETE',
      `/api/trips/${t.trip.id}/invites/${invite.body.invite.id}`,
      {
        token: t.memberToken,
      },
    )
    expect(revoked.status).toBe(200)
    expect((await call('GET', `/api/join/${invite.body.inviteToken}`)).status).toBe(404)
  })

  it('members rename themselves; only the owner changes roles or removes', async () => {
    const t = await createTrip()
    const amy = await joinAsEditor(t.memberToken, t.trip.id)
    const base = `/api/trips/${t.trip.id}/members`
    const self = await call<{ member: { name: string } }>('PATCH', `${base}/${amy.member.id}`, {
      token: amy.memberToken,
      body: { name: 'Amy L' },
    })
    expect(self.body.member.name).toBe('Amy L')
    expect(
      (
        await call('PATCH', `${base}/${amy.member.id}`, {
          token: amy.memberToken,
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await call('PATCH', `${base}/${t.member.id}`, {
          token: amy.memberToken,
          body: { name: 'x' },
        })
      ).status,
    ).toBe(403)
    expect((await call('DELETE', `${base}/${t.member.id}`, { token: t.memberToken })).status).toBe(
      403,
    )
    expect(
      (await call('DELETE', `${base}/${amy.member.id}`, { token: t.memberToken })).status,
    ).toBe(200)
    // Removing a member revokes their tokens
    expect((await call('GET', `/api/trips/${t.trip.id}`, { token: amy.memberToken })).status).toBe(
      401,
    )
  })
})

describe('shares', () => {
  it('returns only the filtered trip summary, and stops after revoke', async () => {
    const t = await createTrip()
    const share = await call<CreateShareResponse>('POST', `/api/trips/${t.trip.id}/shares`, {
      token: t.memberToken,
      body: { options: { hideMoney: true } },
    })
    expect(share.status).toBe(201)
    expect(share.body.share.options).toEqual({
      hideMoney: true,
      hideAddresses: false,
      showRecap: false,
    })
    const response = await handleRequest(
      new Request(`https://x.test/api/share/${share.body.shareToken}`),
      env,
    )
    expect(response.headers.get('x-robots-tag')).toBe('noindex')
    // The full payload and the hide options are covered in share.test.ts
    expect(await response.json()).toMatchObject({
      trip: {
        name: 'NZ South Island',
        destination: 'New Zealand',
        startDate: '2026-12-20',
        endDate: '2026-12-22',
        tz: 'Pacific/Auckland',
        coverColor: null,
        summary: '',
      },
      options: { hideMoney: true },
    })
    // The share token is not a member token
    expect(
      (await call('GET', `/api/trips/${t.trip.id}`, { token: share.body.shareToken })).status,
    ).toBe(401)
    await call('DELETE', `/api/trips/${t.trip.id}/shares/${share.body.share.id}`, {
      token: t.memberToken,
    })
    const revoked = await handleRequest(
      new Request(`https://x.test/api/share/${share.body.shareToken}`),
      env,
    )
    expect(revoked.status).toBe(404)
  })
})

describe('itinerary', () => {
  it('adds, orders, moves and deletes stops with rev bumps', async () => {
    const t = await createTrip()
    const [d1, d2] = t.days
    const base = `/api/trips/${t.trip.id}`
    const add = async (dayId: string, title: string, extra: object = {}) => {
      const res = await call<{ stop: Stop; rev: number }>('POST', `${base}/stops`, {
        token: t.memberToken,
        body: { dayId, title, ...extra },
      })
      expect(res.status).toBe(201)
      return res.body
    }
    const a = await add(d1.id, 'A')
    const b = await add(d1.id, 'B')
    const first = await add(d1.id, 'First', { afterStopId: null })
    expect([a.stop.order, b.stop.order, first.stop.order]).toEqual([1, 2, 0])
    expect(b.rev).toBe(a.rev + 1)

    const moved = await call<{ stop: Stop; rev: number }>(
      'POST',
      `${base}/stops/${first.stop.id}/move`,
      {
        token: t.memberToken,
        body: { dayId: d2.id, afterStopId: null },
      },
    )
    expect(moved.body.stop).toMatchObject({ dayId: d2.id, order: 1, rev: 2 })
    const between = await call<{ stop: Stop }>('POST', `${base}/stops/${b.stop.id}/move`, {
      token: t.memberToken,
      body: { dayId: d2.id, afterStopId: first.stop.id },
    })
    expect(between.body.stop.order).toBe(2)
    expect(
      (
        await call('POST', `${base}/stops/${a.stop.id}/move`, {
          token: t.memberToken,
          body: { dayId: d2.id, afterStopId: 'nope' },
        })
      ).status,
    ).toBe(422)

    const patched = await call<{ stop: Stop }>('PATCH', `${base}/stops/${a.stop.id}`, {
      token: t.memberToken,
      body: { booking: 'todo', costMinor: 4500, currency: 'NZD', isBackup: true },
    })
    expect(patched.body.stop).toMatchObject({
      booking: 'todo',
      costMinor: 4500,
      isBackup: true,
      rev: 2,
    })

    const leg = await call<{ leg: { mode: string; minutes: number } }>(
      'PUT',
      `${base}/legs/${first.stop.id}/${b.stop.id}`,
      { token: t.memberToken, body: { mode: 'drive', minutes: 95 } },
    )
    expect(leg.body.leg).toMatchObject({ mode: 'drive', minutes: 95 })

    const days = await call<DaysResponse>('GET', `${base}/days`, { token: t.memberToken })
    expect(days.body.days[0].stops.map((s) => s.title)).toEqual(['A'])
    expect(days.body.days[1].stops.map((s) => s.title)).toEqual(['First', 'B'])
    expect(days.body.legs).toHaveLength(1)

    const del = await call<{ rev: number }>('DELETE', `${base}/stops/${b.stop.id}`, {
      token: t.memberToken,
    })
    expect(del.status).toBe(200)
    const after = await call<DaysResponse>('GET', `${base}/days`, { token: t.memberToken })
    expect(after.body.legs).toHaveLength(0)
    expect(after.body.rev).toBe(del.body.rev)
  })

  it('patches a day', async () => {
    const t = await createTrip()
    const res = await call<{ day: { title: string; rev: number } }>(
      'PATCH',
      `/api/trips/${t.trip.id}/days/${t.days[0].id}`,
      { token: t.memberToken, body: { title: 'Queenstown → Te Anau', color: 'day3' } },
    )
    expect(res.body.day).toMatchObject({ title: 'Queenstown → Te Anau', rev: 2 })
  })
})

describe('places', () => {
  it('creates, references, merges and deletes places', async () => {
    const t = await createTrip()
    const base = `/api/trips/${t.trip.id}`
    const mk = async (nameLocal: string) =>
      (
        await call<{ place: Place }>('POST', `${base}/places`, {
          token: t.memberToken,
          body: { nameLocal, lat: -45.03, lng: 168.66, hours: { text: '9–17' } },
        })
      ).body.place
    const p1 = await mk('Fergburger')
    const p2 = await mk('Fergburger (dup)')
    expect(p1.hours).toEqual({ text: '9–17' })
    const stop = await call<{ stop: Stop }>('POST', `${base}/stops`, {
      token: t.memberToken,
      body: { dayId: t.days[0].id, title: 'Lunch', type: 'food', placeId: p2.id },
    })
    const refs = await call<{ stops: { id: string }[] }>('GET', `${base}/places/${p2.id}/refs`, {
      token: t.memberToken,
    })
    expect(refs.body.stops.map((s) => s.id)).toEqual([stop.body.stop.id])

    const merged = await call<{ place: Place; repointed: { stops: number } }>(
      'POST',
      `${base}/places/${p2.id}/merge-into/${p1.id}`,
      { token: t.memberToken },
    )
    expect(merged.status).toBe(200)
    expect(merged.body.repointed.stops).toBe(1)
    const list = await call<{ places: Place[] }>('GET', `${base}/places`, { token: t.memberToken })
    expect(list.body.places.map((p) => p.id)).toEqual([p1.id])
    const days = await call<DaysResponse>('GET', `${base}/days`, { token: t.memberToken })
    expect(days.body.days[0].stops[0].placeId).toBe(p1.id)

    expect((await call('DELETE', `${base}/places/${p1.id}`, { token: t.memberToken })).status).toBe(
      200,
    )
    const afterDelete = await call<DaysResponse>('GET', `${base}/days`, { token: t.memberToken })
    expect(afterDelete.body.days[0].stops[0].placeId).toBeNull()
  })

  it('rejects a placeId from another trip', async () => {
    const a = await createTrip()
    const b = await createTrip()
    const place = await call<{ place: Place }>('POST', `/api/trips/${b.trip.id}/places`, {
      token: b.memberToken,
      body: { nameLocal: 'Elsewhere', lat: 1, lng: 1 },
    })
    const res = await call('POST', `/api/trips/${a.trip.id}/stops`, {
      token: a.memberToken,
      body: { dayId: a.days[0].id, placeId: place.body.place.id },
    })
    expect(res.status).toBe(422)
  })
})

describe('routing', () => {
  it('answers unknown API paths with 404 and wrong methods with 405', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404)
    expect((await call('PUT', '/api/trips')).status).toBe(405)
  })
})

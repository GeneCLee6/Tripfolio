import { beforeEach, describe, expect, it } from 'vitest'
import type {
  DeletedTripsResponse,
  ImportTripResponse,
  RestoreTripResponse,
  TripExport,
} from '../../shared/api/export.ts'
import type { CreateTripResponse, TripListResponse } from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

// e1-t07: clone as template, soft-delete restore (30 days) and the deleted-trips list

type Json = Record<string, unknown>

let env: Env
let sqlite: ReturnType<typeof createFakeD1>['sqlite']
let r2: Map<string, { body: unknown; httpMetadata?: unknown }>

beforeEach(() => {
  const fake = createFakeD1()
  sqlite = fake.sqlite
  r2 = new Map()
  const media = {
    get: async (key: string) => r2.get(key) ?? null,
    put: async (key: string, body: unknown, options?: { httpMetadata?: unknown }) => {
      r2.set(key, { body, httpMetadata: options?.httpMetadata })
      return { key }
    },
  }
  env = { DB: fake.db, MEDIA: media, APP_VERSION: 'test', APP_ENV: 'test' } as unknown as Env
})

async function call<T = Json>(
  method: string,
  path: string,
  { token, body, headers = {} }: { token?: string; body?: unknown; headers?: Json } = {},
) {
  const h: Record<string, string> = { ...(headers as Record<string, string>) }
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

async function seed() {
  const created = await call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'Bali',
      startDate: '2026-07-01',
      endDate: '2026-07-03',
      tz: 'Asia/Makassar',
      baseCurrency: 'AUD',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  const t = created.body
  const id = t.trip.id
  const post = async (path: string, body: unknown, token = t.memberToken) => {
    const res = await call<Json>('POST', `/api/trips/${id}${path}`, { token, body })
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBeLessThan(300)
    return res.body
  }
  const join = async (name: string, role: 'editor' | 'viewer') => {
    const invite = await post('/invites', {})
    const body =
      role === 'viewer'
        ? { memberId: ((await post('/members', { name, color: 'sun', role })).member as Json).id }
        : { name, color: 'coral' }
    const res = await call<Json>('POST', `/api/join/${String(invite.inviteToken)}`, { body })
    return { id: String((res.body.member as Json).id), token: String(res.body.memberToken) }
  }
  const ana = await join('Ana', 'editor')
  const kid = await join('Kid', 'viewer')
  const place = (
    (await post('/places', { nameLocal: 'Ubud', lat: -8.5, lng: 115.26 })) as {
      place: Json
    }
  ).place
  const stop = (
    (await post('/stops', {
      dayId: t.days[0].id,
      title: 'Monkey forest',
      placeId: place.id,
      startAt: '2026-07-01T02:00:00Z',
    })) as { stop: Json }
  ).stop
  const item = (
    (await post('/wishlist', { category: 'eat', name: 'Babi guling' })) as {
      item: Json
    }
  ).item
  await post(`/wishlist/${String(item.id)}/vote`, {}, ana.token)
  await post('/expenses', {
    amountMinor: 5000,
    currency: 'AUD',
    date: '2026-07-01',
    category: 'food',
    payerMemberId: ana.id,
    splitMethod: 'equal',
    participants: [{ memberId: t.member.id }, { memberId: ana.id }],
  })
  // A ready photo on the stop, used as the cover, with its objects in R2
  const now = new Date().toISOString()
  sqlite
    .prepare(
      `INSERT INTO attachments (id, tripId, kind, r2Key, thumbKey, mime, bytes, thumbBytes, width,
        height, takenAt, stopId, dayId, wishlistItemId, uploaderMemberId, visibility, status,
        createdAt, updatedAt)
       VALUES ('ph1', ?, 'photo', 'test/trips/x/photo/ph1.webp', 'test/trips/x/photo/ph1.thumb',
        'image/webp', 1000, 100, 2048, 1536, '2026-07-01T10:00:00', ?, ?, ?, ?, 'trip', 'ready', ?, ?)`,
    )
    .all(id, String(stop.id), t.days[0].id, String(item.id), ana.id, now, now)
  sqlite.prepare(`UPDATE trips SET coverAttachmentId = 'ph1' WHERE id = ?`).all(id)
  r2.set('test/trips/x/photo/ph1.webp', { body: 'main-bytes' })
  r2.set('test/trips/x/photo/ph1.thumb', { body: 'thumb-bytes' })
  return { t, ana, kid, id }
}

async function exportOf(tripId: string, token: string): Promise<TripExport> {
  const res = await handleRequest(
    new Request(`https://x.test/api/trips/${tripId}/export?include=expenses,photos`, {
      headers: { authorization: `Bearer ${token}` },
    }),
    env,
  )
  expect(res.status).toBe(200)
  return (await res.json()) as TripExport
}

describe('POST /api/trips/:id/clone', () => {
  it('by default clears members, expenses and photos; the caller owns the copy', async () => {
    const s = await seed()
    const res = await call<ImportTripResponse>('POST', `/api/trips/${s.id}/clone`, {
      token: s.ana.token,
      body: { name: 'Bali 2027', startDate: '2027-07-01' },
    })
    expect(res.status).toBe(201)
    expect(res.body.trip).toMatchObject({
      name: 'Bali 2027',
      startDate: '2027-07-01',
      endDate: '2027-07-03',
      coverAttachmentId: null,
    })
    expect(res.body.member).toMatchObject({ name: 'Ana', role: 'owner' })
    const copy = await exportOf(res.body.trip.id, res.body.memberToken)
    expect(copy.members.map((m) => [m.name, m.role])).toEqual([['Ana', 'owner']])
    expect(copy.expenses).toEqual([])
    expect(copy.attachments).toEqual([])
    expect(copy.places).toHaveLength(1)
    expect(copy.stops[0]).toMatchObject({ title: 'Monkey forest', place: 1 })
    expect(copy.stops[0].startAt).toBe('2027-07-01T02:00:00.000Z')
    // Ana's own vote survives (she is the owner of the copy); nobody else's
    expect(copy.wishlist[0].votes).toEqual([1])
    // The source is untouched
    const source = await exportOf(s.id, s.t.memberToken)
    expect(source.members).toHaveLength(3)
    expect(source.expenses).toHaveLength(1)
  })

  it('keeps members, expenses and photos when asked (photos copied in R2)', async () => {
    const s = await seed()
    const res = await call<ImportTripResponse>('POST', `/api/trips/${s.id}/clone`, {
      token: s.t.memberToken,
      body: { name: 'Bali copy', keep: { members: true, expenses: true, photos: true } },
    })
    expect(res.status).toBe(201)
    const copy = await exportOf(res.body.trip.id, res.body.memberToken)
    expect(copy.members.map((m) => [m.name, m.role])).toEqual([
      ['Gene', 'owner'],
      ['Ana', 'editor'],
      ['Kid', 'viewer'],
    ])
    expect(copy.expenses?.[0]).toMatchObject({ payer: 2, amountMinor: 5000 })
    expect(copy.attachments).toHaveLength(1)
    expect(copy.attachments?.[0]).toMatchObject({ stop: 1, day: 1, wishlistItem: 1 })
    const row = sqlite
      .prepare('SELECT * FROM attachments WHERE tripId = ?')
      .all(res.body.trip.id)[0] as Json
    expect(String(row.r2Key)).toMatch(
      new RegExp(`^test/trips/${res.body.trip.id}/photo/[0-9a-f-]+\\.webp$`),
    )
    expect(String(row.thumbKey)).toBe(String(row.r2Key).replace('.webp', '.thumb'))
    expect(r2.get(String(row.r2Key))?.body).toBe('main-bytes')
    expect(r2.get(String(row.thumbKey))?.body).toBe('thumb-bytes')
    const detail = await call<{ trip: Json }>('GET', `/api/trips/${res.body.trip.id}`, {
      token: res.body.memberToken,
    })
    expect(detail.body.trip.coverAttachmentId).toBe(row.id)
    const item = sqlite
      .prepare('SELECT photoAttachmentId FROM wishlistItems WHERE tripId = ?')
      .all(res.body.trip.id)[0] as Json
    expect(item.photoAttachmentId).toBeNull()
    // The uploader (Ana) maps to her copy
    const ana = sqlite
      .prepare(`SELECT id FROM members WHERE tripId = ? AND name = 'Ana'`)
      .all(res.body.trip.id)[0] as Json
    expect(row.uploaderMemberId).toBe(ana.id)
  })

  it('expenses bring the members they need', async () => {
    const s = await seed()
    const res = await call<ImportTripResponse>('POST', `/api/trips/${s.id}/clone`, {
      token: s.t.memberToken,
      body: { name: 'Bali money', keep: { expenses: true } },
    })
    const copy = await exportOf(res.body.trip.id, res.body.memberToken)
    expect(copy.members).toHaveLength(3)
    expect(copy.expenses).toHaveLength(1)
  })

  it('auth: editors and owners, archived trips too; viewers 403; validation 422', async () => {
    const s = await seed()
    const clone = (token: string, body: unknown = { name: 'X' }) =>
      call('POST', `/api/trips/${s.id}/clone`, { token, body })
    expect((await clone(s.kid.token)).status).toBe(403)
    expect((await call('POST', `/api/trips/${s.id}/clone`, { body: { name: 'X' } })).status).toBe(
      401,
    )
    expect((await clone(s.t.memberToken, {})).status).toBe(422)
    expect((await clone(s.t.memberToken, { name: 'X', startDate: '2027-02-30' })).status).toBe(422)
    await call('PATCH', `/api/trips/${s.id}`, { token: s.t.memberToken, body: { archived: true } })
    expect((await clone(s.ana.token)).status).toBe(201)
  })
})

describe('soft delete: restore and the deleted list', () => {
  const setDeletedAt = (id: string, iso: string) =>
    sqlite.prepare('UPDATE trips SET deletedAt = ? WHERE id = ?').all(iso, id)

  it('restores within 30 days (owner only)', async () => {
    const s = await seed()
    expect((await call('DELETE', `/api/trips/${s.id}`, { token: s.t.memberToken })).status).toBe(
      200,
    )
    expect((await call('GET', `/api/trips/${s.id}`, { token: s.t.memberToken })).status).toBe(401)
    expect((await call('POST', `/api/trips/${s.id}/restore`, { token: s.ana.token })).status).toBe(
      403,
    )
    expect((await call('POST', `/api/trips/${s.id}/restore`)).status).toBe(401)
    const res = await call<RestoreTripResponse>('POST', `/api/trips/${s.id}/restore`, {
      token: s.t.memberToken,
    })
    expect(res.status).toBe(200)
    expect(res.body.trip.deletedAt).toBeNull()
    expect((await call('GET', `/api/trips/${s.id}`, { token: s.t.memberToken })).status).toBe(200)
    // Not deleted any more
    expect(
      (await call('POST', `/api/trips/${s.id}/restore`, { token: s.t.memberToken })).status,
    ).toBe(409)
  })

  it('refuses after 30 days (410) and for another trip id (404)', async () => {
    const s = await seed()
    setDeletedAt(s.id, new Date(Date.now() - 29 * 86_400_000).toISOString())
    const other = await call<CreateTripResponse>('POST', '/api/trips', {
      body: {
        name: 'Other',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        tz: 'UTC',
        owner: { name: 'X', color: 'teal' },
      },
    })
    expect(
      (await call('POST', `/api/trips/${other.body.trip.id}/restore`, { token: s.t.memberToken }))
        .status,
    ).toBe(404)
    expect(
      (await call('POST', `/api/trips/${s.id}/restore`, { token: s.t.memberToken })).status,
    ).toBe(200)
    setDeletedAt(s.id, new Date(Date.now() - 31 * 86_400_000).toISOString())
    const late = await call<Json>('POST', `/api/trips/${s.id}/restore`, { token: s.t.memberToken })
    expect(late.status).toBe(410)
    expect((late.body.error as Json).code).toBe('restore_expired')
  })

  it('GET /api/trips/deleted lists soft-deleted trips with purgeAt', async () => {
    const s = await seed()
    const live = await call<CreateTripResponse>('POST', '/api/trips', {
      body: {
        name: 'Live',
        startDate: '2026-01-01',
        endDate: '2026-01-01',
        tz: 'UTC',
        owner: { name: 'X', color: 'teal' },
      },
    })
    setDeletedAt(s.id, '2026-11-01T00:00:00.000Z')
    const tokens = [live.body.memberToken, s.t.memberToken, s.ana.token, 'garbage'].join(',')
    const res = await call<DeletedTripsResponse>('GET', '/api/trips/deleted', {
      headers: { 'x-member-tokens': tokens },
    })
    expect(res.status).toBe(200)
    expect(res.body.trips).toHaveLength(2)
    expect(res.body.trips[0]).toMatchObject({
      tokenIndex: 1,
      trip: { id: s.id, name: 'Bali' },
      deletedAt: '2026-11-01T00:00:00.000Z',
      purgeAt: '2026-12-01T00:00:00.000Z',
    })
    expect(res.body.trips.map((x) => [x.tokenIndex, x.canRestore])).toEqual([
      [1, Date.now() <= Date.parse('2026-12-01T00:00:00.000Z')],
      [2, false],
    ])
    // The normal list leaves deleted trips out
    const list = await call<TripListResponse>('GET', '/api/trips', {
      headers: { 'x-member-tokens': tokens },
    })
    expect(list.body.trips.map((x) => x.tokenIndex)).toEqual([0])
    expect(
      (await call('GET', '/api/trips/deleted', { headers: { 'x-member-tokens': 'a,'.repeat(51) } }))
        .status,
    ).toBe(422)
  })
})

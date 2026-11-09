import { beforeEach, describe, expect, it } from 'vitest'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  DaysResponse,
  MemberTokenResponse,
  Place,
  PlaceRefsResponse,
  PocketResponse,
  Stop,
  WishlistClaimResponse,
  WishlistItemResponse,
  WishlistResponse,
  WishlistScheduleResponse,
  WishlistUnscheduleResponse,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import type { MemberCreate } from '../../shared/schema/member.ts'
import { createFakeD1 } from './fake-d1.ts'

// Wishlist, votes, claims, scheduling and the pocket list (e5-t01)

let env: Env

beforeEach(() => {
  env = { DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await handleRequest(
    new Request(`https://x.test${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  )
  expect(response.headers.get('cache-control')).toBe('no-store')
  return { status: response.status, body: (await response.json()) as T }
}

async function setup() {
  const trip = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'Tokyo',
    destination: 'Japan',
    startDate: '2026-12-20',
    endDate: '2026-12-22',
    tz: 'Asia/Tokyo',
    localCurrencies: ['JPY'],
    style: 'city',
    owner: { name: 'Gene', color: 'teal' },
  })
  expect(trip.status).toBe(201)
  const owner = trip.body.memberToken
  const base = `/api/trips/${trip.body.trip.id}`
  const invite = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const editor = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite.body.inviteToken}`,
    undefined,
    { name: 'Amy', color: 'rose' },
  )
  // A viewer: added by the owner, then claimed through an invite
  const viewerBody: MemberCreate = { name: 'Kid', color: 'sky', email: null, role: 'viewer' }
  const added = await call<{ member: { id: string } }>('POST', `${base}/members`, owner, viewerBody)
  const invite2 = await call<CreateInviteResponse>('POST', `${base}/invites`, owner)
  const viewer = await call<MemberTokenResponse>(
    'POST',
    `/api/join/${invite2.body.inviteToken}`,
    undefined,
    { memberId: added.body.member.id },
  )
  expect(viewer.status).toBe(201)
  expect(viewer.body.member.role).toBe('viewer')
  return {
    base,
    owner,
    ownerId: trip.body.member.id,
    editor: editor.body.memberToken,
    editorId: editor.body.member.id,
    viewer: viewer.body.memberToken,
    dayIds: trip.body.days.map((d) => d.id),
  }
}

async function addPlace(base: string, token: string, nameLocal: string) {
  const res = await call<{ place: Place }>('POST', `${base}/places`, token, {
    nameLocal,
    lat: 35.68,
    lng: 139.76,
  })
  expect(res.status).toBe(201)
  return res.body.place
}

describe('wishlist items', () => {
  it('creates, lists with filters, patches and soft-deletes; viewers read only', async () => {
    const s = await setup()
    const place = await addPlace(s.base, s.owner, '一蘭 新宿')
    const created = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.editor, {
      category: 'eat',
      name: 'Ichiran ramen',
      placeId: place.id,
      estMinor: 1500,
      currency: 'JPY',
      sourceUrl: 'https://example.com/ichiran',
      recommenderMemberId: s.editorId,
      note: 'late night',
    })
    expect(created.status).toBe(201)
    const item = created.body.item
    expect(item).toMatchObject({
      category: 'eat',
      status: 'wish',
      stopId: null,
      order: 1,
      votes: [],
      claims: [],
      place: { id: place.id, nameLocal: '一蘭 新宿', lat: 35.68, lng: 139.76 },
    })
    const second = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'buy',
      name: 'Royce chocolate',
    })
    expect(second.body.item).toMatchObject({ order: 2, place: null, estMinor: null })
    expect(second.body.rev).toBeGreaterThan(created.body.rev)

    // Viewer: reads, never writes
    const listed = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(listed.status).toBe(200)
    expect(listed.body.items.map((i) => i.name)).toEqual(['Ichiran ramen', 'Royce chocolate'])
    for (const [method, path] of [
      ['POST', `${s.base}/wishlist`],
      ['PATCH', `${s.base}/wishlist/${item.id}`],
      ['DELETE', `${s.base}/wishlist/${item.id}`],
      ['POST', `${s.base}/wishlist/${item.id}/vote`],
      ['POST', `${s.base}/wishlist/${item.id}/claims`],
      ['POST', `${s.base}/wishlist/${item.id}/schedule`],
    ] as const) {
      const res = await call(method, path, s.viewer, { category: 'eat', name: 'x' })
      expect(res.status, `${method} ${path}`).toBe(403)
    }
    expect((await call('GET', `${s.base}/wishlist`)).status).toBe(401)

    const byCategory = await call<WishlistResponse>(
      'GET',
      `${s.base}/wishlist?category=buy`,
      s.viewer,
    )
    expect(byCategory.body.items.map((i) => i.name)).toEqual(['Royce chocolate'])
    expect((await call('GET', `${s.base}/wishlist?status=nope`, s.viewer)).status).toBe(422)

    // Validation: currency with a price, places and members of this trip
    const noCurrency = await call('POST', `${s.base}/wishlist`, s.owner, {
      category: 'buy',
      name: 'x',
      estMinor: 100,
    })
    expect(noCurrency.status).toBe(422)
    const badPlace = await call('PATCH', `${s.base}/wishlist/${item.id}`, s.owner, {
      placeId: 'nope',
    })
    expect(badPlace.status).toBe(422)
    const badCategory = await call('POST', `${s.base}/wishlist`, s.owner, {
      category: 'drink',
      name: 'x',
    })
    expect(badCategory.status).toBe(422)

    const patched = await call<WishlistItemResponse>(
      'PATCH',
      `${s.base}/wishlist/${second.body.item.id}`,
      s.editor,
      { estMinor: 2000, currency: 'JPY', status: 'done', sourceTitle: 'Royce', order: 0.5 },
    )
    expect(patched.status).toBe(200)
    expect(patched.body.item).toMatchObject({ estMinor: 2000, status: 'done', rev: 2 })
    // scheduled only through …/schedule
    const toScheduled = await call('PATCH', `${s.base}/wishlist/${item.id}`, s.editor, {
      status: 'scheduled',
    })
    expect(toScheduled.status).toBe(422)

    const done = await call<WishlistResponse>('GET', `${s.base}/wishlist?status=done`, s.viewer)
    expect(done.body.items.map((i) => i.name)).toEqual(['Royce chocolate'])

    const deleted = await call<{ ok: boolean }>('DELETE', `${s.base}/wishlist/${item.id}`, s.editor)
    expect(deleted.status).toBe(200)
    const after = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(after.body.items.map((i) => i.name)).toEqual(['Royce chocolate'])
    expect((await call('PATCH', `${s.base}/wishlist/${item.id}`, s.owner, {})).status).toBe(404)
  })

  it('toggles the caller’s vote', async () => {
    const s = await setup()
    const { body } = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'see',
      name: 'teamLab',
    })
    const path = `${s.base}/wishlist/${body.item.id}/vote`
    const v1 = await call<WishlistItemResponse>('POST', path, s.owner)
    expect(v1.body.item.votes).toEqual([s.ownerId])
    const again = await call<WishlistItemResponse>('POST', path, s.owner)
    expect(again.status).toBe(200)
    expect(again.body.item.votes).toEqual([s.ownerId])
    const v2 = await call<WishlistItemResponse>('POST', path, s.editor)
    expect(v2.body.item.votes).toEqual([s.ownerId, s.editorId])
    const un = await call<WishlistItemResponse>('DELETE', path, s.owner)
    expect(un.body.item.votes).toEqual([s.editorId])
    expect(un.body.rev).toBeGreaterThan(v2.body.rev)
  })

  it('adds, edits and removes claims', async () => {
    const s = await setup()
    const { body } = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'buy',
      name: 'Tokyo Banana',
    })
    const claims = `${s.base}/wishlist/${body.item.id}/claims`
    const claim = await call<WishlistClaimResponse>('POST', claims, s.editor, {
      buyerMemberId: s.editorId,
      forName: 'Mum',
      qty: 3,
    })
    expect(claim.status).toBe(201)
    expect(claim.body.claim).toMatchObject({ buyerMemberId: s.editorId, qty: 3, done: false })
    expect((await call('POST', claims, s.editor, { qty: 0 })).status).toBe(422)
    expect((await call('POST', claims, s.editor, { buyerMemberId: 'ghost' })).status).toBe(422)

    const cid = claim.body.claim.id
    const patched = await call<WishlistClaimResponse>('PATCH', `${claims}/${cid}`, s.owner, {
      done: true,
      qty: 2,
    })
    expect(patched.body.claim).toMatchObject({ done: true, qty: 2, forName: 'Mum' })
    const listed = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(listed.body.items[0].claims).toHaveLength(1)
    expect(listed.body.items[0].claims[0]).toMatchObject({ id: cid, done: true })

    expect((await call('DELETE', `${claims}/${cid}`, s.viewer)).status).toBe(403)
    expect((await call('DELETE', `${claims}/${cid}`, s.owner)).status).toBe(200)
    expect((await call('DELETE', `${claims}/${cid}`, s.owner)).status).toBe(404)
  })
})

describe('scheduling', () => {
  it('creates a typed stop linked both ways, unschedules it, and reverts when the stop is deleted', async () => {
    const s = await setup()
    const place = await addPlace(s.base, s.owner, 'Tsukiji')
    const { body } = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'eat',
      name: 'Sushi breakfast',
      placeId: place.id,
      estMinor: 4000,
      currency: 'JPY',
      note: 'go early',
    })
    const wid = body.item.id
    const first = await call<{ stop: Stop }>('POST', `${s.base}/stops`, s.owner, {
      dayId: s.dayIds[0],
      title: 'Hotel',
    })

    const scheduled = await call<WishlistScheduleResponse>(
      'POST',
      `${s.base}/wishlist/${wid}/schedule`,
      s.editor,
      { dayId: s.dayIds[0], afterStopId: null },
    )
    expect(scheduled.status).toBe(201)
    const stop = scheduled.body.stop
    expect(stop).toMatchObject({
      dayId: s.dayIds[0],
      type: 'food',
      title: 'Sushi breakfast',
      placeId: place.id,
      costMinor: 4000,
      currency: 'JPY',
      note: 'go early',
      wishlistItemId: wid,
    })
    expect(stop.order).toBeLessThan(first.body.stop.order)
    expect(scheduled.body.item).toMatchObject({ status: 'scheduled', stopId: stop.id })
    const days = await call<DaysResponse>('GET', `${s.base}/days`, s.viewer)
    expect(days.body.days[0].stops.map((x) => x.id)).toEqual([stop.id, first.body.stop.id])

    // Twice: refused; wish/dropped while scheduled: refused
    expect(
      (await call('POST', `${s.base}/wishlist/${wid}/schedule`, s.editor, { dayId: s.dayIds[1] }))
        .status,
    ).toBe(422)
    expect(
      (await call('PATCH', `${s.base}/wishlist/${wid}`, s.editor, { status: 'dropped' })).status,
    ).toBe(422)
    expect(
      (await call('POST', `${s.base}/wishlist/missing/schedule`, s.editor, { dayId: s.dayIds[1] }))
        .status,
    ).toBe(404)

    // Unschedule: the stop is gone and the item is back in the pocket list
    const un = await call<WishlistUnscheduleResponse>(
      'POST',
      `${s.base}/wishlist/${wid}/unschedule`,
      s.editor,
    )
    expect(un.status).toBe(200)
    expect(un.body.deletedStopId).toBe(stop.id)
    expect(un.body.item).toMatchObject({ status: 'wish', stopId: null })
    const days2 = await call<DaysResponse>('GET', `${s.base}/days`, s.viewer)
    expect(days2.body.days[0].stops.map((x) => x.id)).toEqual([first.body.stop.id])
    expect((await call('POST', `${s.base}/wishlist/${wid}/unschedule`, s.editor)).status).toBe(422)

    // Schedule again (end of day 2), then delete the stop through the stops API
    const again = await call<WishlistScheduleResponse>(
      'POST',
      `${s.base}/wishlist/${wid}/schedule`,
      s.editor,
      { dayId: s.dayIds[1] },
    )
    expect(again.status).toBe(201)
    const removed = await call('DELETE', `${s.base}/stops/${again.body.stop.id}`, s.editor)
    expect(removed.status).toBe(200)
    const listed = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(listed.body.items[0]).toMatchObject({ status: 'wish', stopId: null })
  })

  it('maps every category to a stop type; done keeps its stop when the stop goes', async () => {
    const s = await setup()
    const expected = { eat: 'food', buy: 'shopping', see: 'sight', experience: 'other' } as const
    for (const [category, type] of Object.entries(expected)) {
      const { body } = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
        category,
        name: category,
      })
      const res = await call<WishlistScheduleResponse>(
        'POST',
        `${s.base}/wishlist/${body.item.id}/schedule`,
        s.owner,
        { dayId: s.dayIds[2] },
      )
      expect(res.body.stop.type).toBe(type)
      expect(res.body.stop.costMinor).toBeNull()
      if (category === 'experience') {
        const done = await call<WishlistItemResponse>(
          'PATCH',
          `${s.base}/wishlist/${body.item.id}`,
          s.owner,
          { status: 'done' },
        )
        expect(done.body.item).toMatchObject({ status: 'done', stopId: res.body.stop.id })
        await call('DELETE', `${s.base}/stops/${res.body.stop.id}`, s.owner)
        const listed = await call<WishlistResponse>(
          'GET',
          `${s.base}/wishlist?status=done`,
          s.owner,
        )
        expect(listed.body.items[0]).toMatchObject({ name: 'experience', stopId: null })
      }
    }
  })

  it('unlinks the stop when its item is deleted', async () => {
    const s = await setup()
    const { body } = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'see',
      name: 'Senso-ji',
    })
    const res = await call<WishlistScheduleResponse>(
      'POST',
      `${s.base}/wishlist/${body.item.id}/schedule`,
      s.owner,
      { dayId: s.dayIds[0] },
    )
    await call('DELETE', `${s.base}/wishlist/${body.item.id}`, s.owner)
    const days = await call<DaysResponse>('GET', `${s.base}/days`, s.viewer)
    expect(days.body.days[0].stops[0]).toMatchObject({
      id: res.body.stop.id,
      title: 'Senso-ji',
      wishlistItemId: null,
    })
  })
})

describe('pocket list and places', () => {
  it('lists wished items and places nothing points at', async () => {
    const s = await setup()
    const free = await addPlace(s.base, s.owner, 'Free place')
    const atStop = await addPlace(s.base, s.owner, 'At a stop')
    const atItem = await addPlace(s.base, s.owner, 'At an item')
    const atDeleted = await addPlace(s.base, s.owner, 'At a deleted item')
    await call('POST', `${s.base}/stops`, s.owner, { dayId: s.dayIds[0], placeId: atStop.id })
    const wished = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'eat',
      name: 'Wished',
      placeId: atItem.id,
    })
    const gone = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'eat',
      name: 'Gone',
      placeId: atDeleted.id,
    })
    await call('DELETE', `${s.base}/wishlist/${gone.body.item.id}`, s.owner)
    const dropped = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'buy',
      name: 'Dropped',
    })
    await call('PATCH', `${s.base}/wishlist/${dropped.body.item.id}`, s.owner, {
      status: 'dropped',
    })
    const scheduled = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'see',
      name: 'Scheduled',
    })
    await call('POST', `${s.base}/wishlist/${scheduled.body.item.id}/schedule`, s.owner, {
      dayId: s.dayIds[1],
    })

    const pocket = await call<PocketResponse>('GET', `${s.base}/pocket`, s.viewer)
    expect(pocket.status).toBe(200)
    expect(pocket.body.items.map((i) => i.name)).toEqual(['Wished'])
    expect(pocket.body.items[0].place?.id).toBe(atItem.id)
    expect(pocket.body.places.map((p) => p.id)).toEqual([free.id, atDeleted.id])
    expect(pocket.body.rev).toBeGreaterThan(0)
    expect((await call('GET', `${s.base}/pocket`)).status).toBe(401)
    expect(pocket.body.items[0].id).toBe(wished.body.item.id)
  })

  it('reports wishlist refs, re-points them on merge and clears them on delete', async () => {
    const s = await setup()
    const dup = await addPlace(s.base, s.owner, 'Dup')
    const target = await addPlace(s.base, s.owner, 'Target')
    const item = await call<WishlistItemResponse>('POST', `${s.base}/wishlist`, s.owner, {
      category: 'eat',
      name: 'Gyoza',
      placeId: dup.id,
    })
    const refs = await call<PlaceRefsResponse>('GET', `${s.base}/places/${dup.id}/refs`, s.viewer)
    expect(refs.body).toEqual({
      stops: [],
      wishlistItems: [{ id: item.body.item.id, name: 'Gyoza', status: 'wish' }],
      lodgings: [],
      bookings: [],
    })

    const merged = await call<{ repointed: { stops: number; wishlistItems: number } }>(
      'POST',
      `${s.base}/places/${dup.id}/merge-into/${target.id}`,
      s.owner,
    )
    expect(merged.status).toBe(200)
    expect(merged.body.repointed).toMatchObject({ stops: 0, wishlistItems: 1 })
    const listed = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(listed.body.items[0].place).toMatchObject({ id: target.id, nameLocal: 'Target' })

    const deleted = await call('DELETE', `${s.base}/places/${target.id}`, s.owner)
    expect(deleted.status).toBe(200)
    const after = await call<WishlistResponse>('GET', `${s.base}/wishlist`, s.viewer)
    expect(after.body.items[0]).toMatchObject({ placeId: null, place: null })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import type {
  DaysWithLodgingResponse,
  LodgingsResponse,
  LodgingWriteResponse,
} from '../../shared/api/bookings.ts'
import type {
  CreateInviteResponse,
  CreateTripResponse,
  MemberTokenResponse,
} from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { createFakeD1 } from './fake-d1.ts'

let env: Env

beforeEach(() => {
  env = { DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
})

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
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
  return { status: response.status, body: (await response.json()) as T }
}

async function createTrip() {
  const res = await call<CreateTripResponse>('POST', '/api/trips', {
    body: {
      name: 'NZ',
      startDate: '2026-12-20',
      endDate: '2026-12-26',
      tz: 'Pacific/Auckland',
      style: 'campervan',
      owner: { name: 'Gene', color: 'teal' },
    },
  })
  expect(res.status).toBe(201)
  return res.body
}

async function viewerToken(t: CreateTripResponse) {
  const kid = await call<{ member: { id: string } }>('POST', `/api/trips/${t.trip.id}/members`, {
    token: t.memberToken,
    body: { name: 'Kid', color: 'amber', role: 'viewer' },
  })
  const invite = await call<CreateInviteResponse>('POST', `/api/trips/${t.trip.id}/invites`, {
    token: t.memberToken,
  })
  const joined = await call<MemberTokenResponse>('POST', `/api/join/${invite.body.inviteToken}`, {
    body: { memberId: kid.body.member.id },
  })
  return joined.body.memberToken
}

const dayIdsFor = (t: CreateTripResponse, dates: string[]) =>
  t.days.filter((d) => dates.includes(d.date ?? '')).map((d) => d.id)

describe('lodgings', () => {
  it('creates a multi-night stay and links its nights; checkout day is flagged', async () => {
    const t = await createTrip()
    const res = await call<LodgingWriteResponse>('POST', `/api/trips/${t.trip.id}/lodgings`, {
      token: t.memberToken,
      body: {
        name: 'Lakeview Holiday Park',
        checkIn: '2026-12-20',
        checkOut: '2026-12-23',
        checkInTime: '14:00',
        checkOutTime: '10:00',
        priceMinor: 45000,
        currency: 'NZD',
        payStatus: 'deposit',
        cancelByLocal: '2026-12-10T23:59',
        campType: 'holiday-park',
        campFacilities: { power: true, water: true },
      },
    })
    expect(res.status).toBe(201)
    expect(res.body.lodging).toMatchObject({
      name: 'Lakeview Holiday Park',
      payStatus: 'deposit',
      // 23:59 NZDT (UTC+13) is 10:59 UTC
      cancelBy: '2026-12-10T10:59:00.000Z',
      campFacilities: { power: true, water: true, dump: false },
    })
    expect(res.body.dayIds.sort()).toEqual(
      dayIdsFor(t, ['2026-12-20', '2026-12-21', '2026-12-22']).sort(),
    )
    expect(res.body.conflicts).toEqual([])
    expect(res.body.rev).toBe(2)

    const days = await call<DaysWithLodgingResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    const byDate = new Map(days.body.days.map((d) => [d.date, d]))
    expect(byDate.get('2026-12-20')?.lodging).toMatchObject({
      name: 'Lakeview Holiday Park',
      isCheckinDay: true,
      isCheckoutDay: false,
      campType: 'holiday-park',
    })
    expect(byDate.get('2026-12-21')?.lodging?.isCheckinDay).toBe(false)
    expect(byDate.get('2026-12-23')?.lodgingId).toBeNull()
    expect(byDate.get('2026-12-23')?.lodging).toMatchObject({
      id: res.body.lodging.id,
      isCheckoutDay: true,
      checkOutTime: '10:00',
    })
    expect(byDate.get('2026-12-23')?.checkout?.id).toBe(res.body.lodging.id)
    expect(byDate.get('2026-12-24')?.lodging).toBeNull()
  })

  it('reports overwritten nights, relinks on date changes and clears on delete', async () => {
    const t = await createTrip()
    const path = `/api/trips/${t.trip.id}/lodgings`
    const a = await call<LodgingWriteResponse>('POST', path, {
      token: t.memberToken,
      body: { name: 'A', checkIn: '2026-12-20', checkOut: '2026-12-22' },
    })
    const b = await call<LodgingWriteResponse>('POST', path, {
      token: t.memberToken,
      body: { name: 'B', checkIn: '2026-12-21', checkOut: '2026-12-23' },
    })
    expect(b.body.conflicts).toEqual(dayIdsFor(t, ['2026-12-21']))

    // A day that moves on from A to another lodging: B tonight, A's checkout in `checkout`
    let days = await call<DaysWithLodgingResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    const d21 = days.body.days.find((d) => d.date === '2026-12-21')
    expect(d21?.lodging).toMatchObject({ name: 'B', isCheckinDay: true, isCheckoutDay: false })
    expect(d21?.checkout).toBeNull()
    const d22 = days.body.days.find((d) => d.date === '2026-12-22')
    expect(d22?.lodging?.name).toBe('B')
    expect(d22?.checkout?.name).toBe('A')

    // Move B later: 21 is released (no lodging), 23 and 24 are linked
    const moved = await call<LodgingWriteResponse>('PATCH', `${path}/${b.body.lodging.id}`, {
      token: t.memberToken,
      body: { checkIn: '2026-12-23', checkOut: '2026-12-25' },
    })
    expect(moved.status).toBe(200)
    expect(moved.body.dayIds.sort()).toEqual(dayIdsFor(t, ['2026-12-23', '2026-12-24']).sort())
    days = await call<DaysWithLodgingResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    const link = (date: string) => days.body.days.find((d) => d.date === date)?.lodgingId
    expect(link('2026-12-20')).toBe(a.body.lodging.id)
    expect(link('2026-12-21')).toBeNull()
    expect(link('2026-12-22')).toBeNull()
    expect(link('2026-12-23')).toBe(b.body.lodging.id)

    const del = await call('DELETE', `${path}/${b.body.lodging.id}`, { token: t.memberToken })
    expect(del.status).toBe(200)
    days = await call<DaysWithLodgingResponse>('GET', `/api/trips/${t.trip.id}/days`, {
      token: t.memberToken,
    })
    expect(link('2026-12-23')).toBeNull()
    expect(days.body.days.find((d) => d.date === '2026-12-25')?.lodging).toBeNull()
    const list = await call<LodgingsResponse>('GET', path, { token: t.memberToken })
    expect(list.body.lodgings.map((l) => l.name)).toEqual(['A'])
    expect(
      (await call('PATCH', `${path}/${b.body.lodging.id}`, { token: t.memberToken, body: {} }))
        .status,
    ).toBe(404)
  })

  it('validates dates, currency and place; a day can only point at a live lodging', async () => {
    const t = await createTrip()
    const path = `/api/trips/${t.trip.id}/lodgings`
    const bad = [
      { name: 'X', checkIn: '2026-12-22', checkOut: '2026-12-22' },
      { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21', priceMinor: 100 },
      { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21', placeId: 'nope' },
      { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21', checkInTime: '25:00' },
      { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21', campType: 'beach' },
    ]
    for (const body of bad)
      expect((await call('POST', path, { token: t.memberToken, body })).status).toBe(422)
    const ok = await call<LodgingWriteResponse>('POST', path, {
      token: t.memberToken,
      body: { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21' },
    })
    const patch = await call('PATCH', `${path}/${ok.body.lodging.id}`, {
      token: t.memberToken,
      body: { checkOut: '2026-12-19' },
    })
    expect(patch.status).toBe(422)
    const dayPatch = await call('PATCH', `/api/trips/${t.trip.id}/days/${t.days[3].id}`, {
      token: t.memberToken,
      body: { lodgingId: 'missing' },
    })
    expect(dayPatch.status).toBe(422)
  })

  it('viewers read but cannot write', async () => {
    const t = await createTrip()
    const viewer = await viewerToken(t)
    const path = `/api/trips/${t.trip.id}/lodgings`
    const body = { name: 'X', checkIn: '2026-12-20', checkOut: '2026-12-21' }
    expect((await call('POST', path, { token: viewer, body })).status).toBe(403)
    const ok = await call<LodgingWriteResponse>('POST', path, { token: t.memberToken, body })
    expect((await call('GET', path, { token: viewer })).status).toBe(200)
    expect(
      (await call('PATCH', `${path}/${ok.body.lodging.id}`, { token: viewer, body: {} })).status,
    ).toBe(403)
    expect((await call('DELETE', `${path}/${ok.body.lodging.id}`, { token: viewer })).status).toBe(
      403,
    )
    expect((await call('GET', path)).status).toBe(401)
  })
})

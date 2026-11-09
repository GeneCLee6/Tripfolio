import { beforeEach, describe, expect, it } from 'vitest'
import type { CreateTripResponse, Stop } from '../../shared/api/types.ts'
import { handleRequest } from '../../worker/app.ts'
import type { Env } from '../../worker/env.ts'
import { escapeText, foldLine, moneyText } from '../../worker/trips/ics.ts'
import { createFakeD1 } from './fake-d1.ts'

// e8-t05: GET /api/trips/:id/calendar.ics and the share-token subscription URL

let env: Env

beforeEach(() => {
  env = { DB: createFakeD1().db, APP_VERSION: 'test' } as unknown as Env
})

type Json = Record<string, unknown>

async function call<T = Json>(method: string, path: string, token?: string, body?: unknown) {
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

async function fetchIcs(path: string, token?: string) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  const res = await handleRequest(new Request(`https://x.test${path}`, { headers }), env)
  return { status: res.status, headers: res.headers, text: await res.text() }
}

const LONG_TITLE = '蒂卡波湖好牧羊人教堂與星空保護區導覽，含晚餐；集合點在教堂停車場'

async function seed() {
  const created = await call<CreateTripResponse>('POST', '/api/trips', undefined, {
    name: 'NZ, South; Island',
    startDate: '2026-12-20',
    endDate: '2026-12-22',
    tz: 'Pacific/Auckland',
    owner: { name: 'Gene', color: 'teal' },
  })
  const t = created.body
  const id = t.trip.id
  const post = async (path: string, body: unknown) => {
    const res = await call<Json>('POST', `/api/trips/${id}${path}`, t.memberToken, body)
    expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBeLessThan(300)
    return res.body
  }
  const place = String(
    (
      (await post('/places', {
        nameLocal: 'Lake Tekapo',
        lat: -44.0046,
        lng: 170.4771,
        address: '1 Pioneer Dr, Tekapo',
      })) as { place: Json }
    ).place.id,
  )
  const timed = (
    await post('/stops', {
      dayId: t.days[0].id,
      title: LONG_TITLE,
      placeId: place,
      startAt: '2026-12-20T03:00:00Z',
      durationMin: 90,
      costMinor: 12345,
      currency: 'NZD',
      note: 'Bring: jackets, torch; tripod\nSecond line \\ backslash',
    })
  ).stop as Stop
  const ended = (
    await post('/stops', {
      dayId: t.days[1].id,
      title: 'Hooker Valley',
      startAt: '2026-12-20T20:00:00Z',
      endAt: '2026-12-20T23:00:00Z',
    })
  ).stop as Stop
  await post('/stops', { dayId: t.days[0].id, title: 'Supermarket' })
  await post('/stops', { dayId: t.days[1].id, title: 'Museum (backup)', isBackup: true })
  await call('PATCH', `/api/trips/${id}/days/${t.days[0].id}`, t.memberToken, { title: 'Arrive' })
  const lodging = (
    await post('/lodgings', {
      name: 'Tekapo Holiday Park',
      placeId: place,
      checkIn: '2026-12-20',
      checkOut: '2026-12-22',
      checkInTime: '14:00',
      ref: 'BK-123',
      phone: '+64 3 680 6825',
      priceMinor: 18000,
      currency: 'NZD',
      note: 'gate code 4321',
    })
  ).lodging as Json
  const flight = (
    await post('/bookings', {
      type: 'flight',
      title: 'NZ104 SYD → CHC',
      details: {
        airline: 'Air New Zealand',
        flightNo: 'NZ104',
        fromAirport: 'SYD',
        toAirport: 'CHC',
      },
      startAt: '2026-12-19T22:00:00Z',
      endAt: '2026-12-20T01:00:00Z',
      ref: 'ABC123',
      priceMinor: 45000,
      currency: 'AUD',
    })
  ).booking as Json
  const rental = (
    await post('/bookings', {
      type: 'rental',
      title: 'Campervan',
      details: { company: 'Jucy', vehicle: 'Condo', pickupPlaceId: place },
      startAt: '2026-12-20T02:00:00Z',
      endAt: '2026-12-22T21:00:00Z',
    })
  ).booking as Json
  const share = async (options: Json) =>
    String(((await post('/shares', { options })) as { shareToken: string }).shareToken)
  return { t, timed, ended, lodging, flight, rental, share }
}

/** RFC 5545 unfolding, then the content lines */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .split('\r\n')
    .filter(Boolean)
}

/** VEVENTs as { prop: value } maps (first occurrence; params kept in the key) */
function events(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  let current: Record<string, string> | null = null
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') current = {}
    else if (line === 'END:VEVENT') {
      if (current) out.push(current)
      current = null
    } else if (current) {
      const i = line.indexOf(':')
      current[line.slice(0, i)] ??= line.slice(i + 1)
    }
  }
  return out
}

const byUid = (text: string, uid: string) => events(text).find((e) => e.UID === uid)

describe('ICS text rules', () => {
  it('escapes TEXT values', () => {
    expect(escapeText('a,b;c\\d\ne\r\nf')).toBe('a\\,b\\;c\\\\d\\ne\\nf')
  })

  it('folds at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${LONG_TITLE}${LONG_TITLE}`
    const folded = foldLine(line)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(2)
    const enc = new TextEncoder()
    for (const [i, p] of parts.entries()) {
      expect(enc.encode(p).length).toBeLessThanOrEqual(75)
      if (i > 0) expect(p.startsWith(' ')).toBe(true)
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line)
    expect(foldLine('SHORT:x')).toBe('SHORT:x')
  })

  it('formats money with the currency decimals', () => {
    expect(moneyText(12345, 'NZD')).toBe('123.45 NZD')
    expect(moneyText(1500, 'JPY')).toBe('1500 JPY')
    expect(moneyText(5, 'AUD')).toBe('0.05 AUD')
  })
})

describe('GET /api/trips/:id/calendar.ics', () => {
  it('is a valid calendar with UTC times, all-day days and lodgings, bookings', async () => {
    const s = await seed()
    const res = await fetchIcs(`/api/trips/${s.t.trip.id}/calendar.ics`, s.t.memberToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="NZ-South-Island\.ics"; filename\*=UTF-8''NZ-South-Island\.ics$/,
    )
    const text = res.text
    // CRLF everywhere, every physical line ≤ 75 octets
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    for (const line of text.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    const lines = unfold(text)
    expect(lines.slice(0, 2)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0'])
    expect(lines).toContain('X-WR-CALNAME:NZ\\, South\\; Island')
    expect(lines).toContain('X-WR-TIMEZONE:Pacific/Auckland')
    expect(lines.filter((l) => l === 'BEGIN:VEVENT').length).toBe(
      lines.filter((l) => l === 'END:VEVENT').length,
    )
    for (const e of events(text)) {
      expect(e.UID).toMatch(/^[a-z]+-[0-9a-f-]+(-pickup|-dropoff)?@tripfolio$/)
      expect(e.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/)
    }

    const timed = byUid(text, `stop-${s.timed.id}@tripfolio`)
    expect(timed).toMatchObject({
      DTSTART: '20261220T030000Z',
      DURATION: 'PT90M',
      SUMMARY: LONG_TITLE,
      LOCATION: 'Lake Tekapo\\, 1 Pioneer Dr\\, Tekapo',
      GEO: '-44.004600;170.477100',
    })
    expect(timed?.DESCRIPTION).toBe(
      'Bring: jackets\\, torch\\; tripod\\nSecond line \\\\ backslash\\nCost: 123.45 NZD',
    )
    expect(byUid(text, `stop-${s.ended.id}@tripfolio`)).toMatchObject({
      DTSTART: '20261220T200000Z',
      DTEND: '20261220T230000Z',
    })
    const day1 = byUid(text, `day-${s.t.days[0].id}@tripfolio`)
    expect(day1).toMatchObject({
      'DTSTART;VALUE=DATE': '20261220',
      'DTEND;VALUE=DATE': '20261221',
      SUMMARY: 'Day 1 · Arrive',
      DESCRIPTION: '• Supermarket',
    })
    // Day 2 only has a timed stop and a backup: no all-day event; backups never appear
    expect(byUid(text, `day-${s.t.days[1].id}@tripfolio`)).toBeUndefined()
    expect(text).not.toContain('Museum')

    const lodging = byUid(text, `lodging-${String(s.lodging.id)}@tripfolio`)
    expect(lodging).toMatchObject({
      'DTSTART;VALUE=DATE': '20261220',
      'DTEND;VALUE=DATE': '20261223',
      SUMMARY: 'Tekapo Holiday Park',
    })
    expect(lodging?.DESCRIPTION).toContain('Check-in 14:00 (2026-12-20)')
    expect(lodging?.DESCRIPTION).toContain('Ref: BK-123')
    expect(lodging?.DESCRIPTION).toContain('Price: 180.00 NZD')
    expect(lodging?.DESCRIPTION).toContain('gate code 4321')

    const flight = byUid(text, `booking-${String(s.flight.id)}@tripfolio`)
    expect(flight).toMatchObject({
      DTSTART: '20261219T220000Z',
      DTEND: '20261220T010000Z',
      LOCATION: 'SYD',
    })
    expect(flight?.DESCRIPTION).toContain('Air New Zealand NZ104')
    expect(flight?.DESCRIPTION).toContain('Ref: ABC123')
    expect(byUid(text, `booking-${String(s.rental.id)}-pickup@tripfolio`)).toMatchObject({
      DTSTART: '20261220T020000Z',
      DURATION: 'PT30M',
    })
    expect(byUid(text, `booking-${String(s.rental.id)}-dropoff@tripfolio`)?.DTSTART).toBe(
      '20261222T210000Z',
    )
    // Stops generated from bookings are not repeated as stop events
    const stopUids = events(text).filter((e) => e.UID.startsWith('stop-'))
    expect(stopUids).toHaveLength(2)
  })

  it('keeps UIDs stable between downloads', async () => {
    const s = await seed()
    const uids = async () =>
      events((await fetchIcs(`/api/trips/${s.t.trip.id}/calendar.ics`, s.t.memberToken)).text)
        .map((e) => e.UID)
        .sort()
    expect(await uids()).toEqual(await uids())
  })

  it('needs a member token of this trip (viewers too)', async () => {
    const s = await seed()
    const path = `/api/trips/${s.t.trip.id}/calendar.ics`
    expect((await fetchIcs(path)).status).toBe(401)
    const kid = (
      await call<Json>('POST', `/api/trips/${s.t.trip.id}/members`, s.t.memberToken, {
        name: 'Kid',
        color: 'sun',
        role: 'viewer',
      })
    ).body.member as Json
    const invite = await call<Json>(
      'POST',
      `/api/trips/${s.t.trip.id}/invites`,
      s.t.memberToken,
      {},
    )
    const joined = await call<Json>(
      'POST',
      `/api/join/${String(invite.body.inviteToken)}`,
      undefined,
      {
        memberId: kid.id,
      },
    )
    expect((await fetchIcs(path, String(joined.body.memberToken))).status).toBe(200)
  })
})

describe('GET /api/share/:token/calendar.ics (subscription URL)', () => {
  it('without hide options carries locations and money, but never private notes', async () => {
    const s = await seed()
    const token = await s.share({})
    const res = await fetchIcs(`/api/share/${token}/calendar.ics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    const flat = unfold(res.text).join('\n')
    expect(flat).toContain('LOCATION:Lake Tekapo')
    expect(flat).toContain('Cost: 123.45 NZD')
    expect(flat).not.toContain('gate code')
  })

  it('hideAddresses drops LOCATION, GEO, references and phone numbers', async () => {
    const s = await seed()
    const token = await s.share({ hideAddresses: true })
    const lines = unfold((await fetchIcs(`/api/share/${token}/calendar.ics`)).text)
    const text = lines.join('\n')
    expect(lines.some((l) => l.startsWith('LOCATION'))).toBe(false)
    expect(lines.some((l) => l.startsWith('GEO'))).toBe(false)
    expect(text).not.toContain('Pioneer')
    expect(text).not.toContain('BK-123')
    expect(text).not.toContain('ABC123')
    expect(text).not.toContain('680 6825')
    // Money stays
    expect(text).toContain('Price: 180.00 NZD')
  })

  it('hideMoney drops every price', async () => {
    const s = await seed()
    const token = await s.share({ hideMoney: true })
    const { text } = await fetchIcs(`/api/share/${token}/calendar.ics`)
    const flat = unfold(text).join('\n')
    expect(flat).not.toMatch(/Cost:|Price:|NZD|AUD/)
    expect(flat).toContain('LOCATION:Lake Tekapo')
  })

  it('answers 404 for unknown or revoked tokens and deleted trips', async () => {
    const s = await seed()
    expect((await fetchIcs('/api/share/not-a-token/calendar.ics')).status).toBe(404)
    const token = await s.share({})
    const shares = await call<{ shares: { id: string }[] }>(
      'GET',
      `/api/trips/${s.t.trip.id}/shares`,
      s.t.memberToken,
    )
    await call(
      'DELETE',
      `/api/trips/${s.t.trip.id}/shares/${shares.body.shares[0].id}`,
      s.t.memberToken,
    )
    expect((await fetchIcs(`/api/share/${token}/calendar.ics`)).status).toBe(404)
    const other = await s.share({})
    await call('DELETE', `/api/trips/${s.t.trip.id}`, s.t.memberToken)
    expect((await fetchIcs(`/api/share/${other}/calendar.ics`)).status).toBe(404)
  })
})

import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { en } from '../shared/i18n/en.ts'
import { itineraryEn } from '../shared/i18n/pages/itinerary.en.ts'
import { itineraryZhTW } from '../shared/i18n/pages/itinerary.zh-TW.ts'
import { photosEn } from '../shared/i18n/pages/photos.en.ts'
import { photosZhTW } from '../shared/i18n/pages/photos.zh-TW.ts'
import { zhTW } from '../shared/i18n/zh-TW.ts'

// A rich trip seeded through the API for the accessibility specs (e10-t06): members, three days with
// stops, places with coordinates, a lodging, a booking, picks, an expense, a budget, a checklist,
// notes, a photo, a share and an invite. Not a spec itself (no `.spec.ts`).

export const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

export interface RichTrip {
  tripId: string
  memberToken: string
  shareToken: string
  inviteToken: string
  headers: { authorization: string }
}

/** A small JPEG drawn in the browser (thumbnails must be JPEG or WebP) */
export async function tinyJpeg(browser: Browser): Promise<Buffer> {
  const page = await browser.newPage()
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0F6E74'
    ctx.fillRect(0, 0, 40, 30)
    ctx.fillStyle = '#E7B86B'
    ctx.fillRect(10, 8, 20, 14)
    return canvas.toDataURL('image/jpeg', 0.8)
  })
  await page.close()
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

export async function seedRichTrip(
  request: APIRequestContext,
  jpeg: Buffer,
  name = 'South Island loop',
): Promise<RichTrip> {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(0),
      endDate: inDays(2),
      tz: 'Pacific/Auckland',
      baseCurrency: 'AUD',
      localCurrencies: ['NZD'],
      style: 'campervan',
      summary: 'Lakes, glaciers and stars',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const t = (await created.json()) as {
    trip: { id: string; ownerMemberId: string }
    memberToken: string
    days: { id: string; idx: number | null; date: string | null }[]
  }
  const headers = { authorization: `Bearer ${t.memberToken}` }
  const base = `/api/trips/${t.trip.id}`
  const days = t.days.filter((d) => d.idx !== null).sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  const send = async <T>(method: 'post' | 'put' | 'patch', path: string, data: object): Promise<T> => {
    const res = await request[method](`${base}${path}`, { headers, data })
    expect(res.status(), `${path} ${await res.text()}`).toBeLessThan(300)
    return (await res.json()) as T
  }
  const post = <T>(path: string, data: object) => send<T>('post', path, data)

  const mei = await post<{ member: { id: string } }>('/members', { name: 'Mei', color: '#B5654A' })
  const gene = t.trip.ownerMemberId
  const place = async (nameLocal: string, nameEn: string, lat: number, lng: number) =>
    (
      await post<{ place: { id: string } }>('/places', {
        nameLocal,
        nameEn,
        lat,
        lng,
        address: `${nameEn} Rd`,
      })
    ).place.id
  const chc = await place('基督城', 'Christchurch', -43.5321, 172.6362)
  const tek = await place('蒂卡波湖', 'Lake Tekapo', -44.0046, 170.4771)
  const cook = await place('庫克山', 'Aoraki Mount Cook', -43.7342, 170.0966)
  const zqn = await place('皇后鎮', 'Queenstown', -45.0312, 168.6626)
  const stop = (dayId: string, fields: object) => post('/stops', { dayId, ...fields })
  await stop(days[0]!.id, { placeId: chc, type: 'transport' })
  await stop(days[0]!.id, { placeId: tek, type: 'sight', costMinor: 1500, currency: 'NZD' })
  await stop(days[1]!.id, { placeId: cook, type: 'sight', title: 'Hooker Valley Track' })
  await stop(days[2]!.id, { placeId: zqn, type: 'food', costMinor: 3000, currency: 'AUD' })
  await post('/lodgings', {
    placeId: tek,
    name: 'Lakes Edge Holiday Park',
    checkIn: days[0]!.date,
    checkOut: days[2]!.date,
    checkOutTime: '10:00',
    campType: 'holiday-park',
    priceMinor: 30000,
    currency: 'NZD',
  })
  await post('/bookings', {
    type: 'rental',
    title: 'Jucy Condo',
    details: { company: 'Jucy', vehicle: 'Condo' },
    startLocal: `${days[0]!.date}T10:00`,
    endLocal: `${days[2]!.date}T16:00`,
    priceMinor: 60000,
    currency: 'NZD',
  })
  await post('/wishlist', { category: 'eat', name: 'Fergburger', placeId: zqn, estMinor: 2000, currency: 'NZD' })
  await post('/wishlist', { category: 'buy', name: 'Merino socks' })
  await send('put', '/fx/overrides', { NZD: 0.91 })
  await post('/expenses', {
    amountMinor: 30000,
    currency: 'NZD',
    category: 'food',
    date: days[0]!.date,
    payerMemberId: gene,
    note: 'Fergburger',
    splitMethod: 'equal',
    participants: [{ memberId: gene }, { memberId: mei.member.id }],
  })
  await send('put', '/budget', { rows: [{ category: 'food', plannedMinor: 100000, perPerson: false }] })
  await post('/checklists/apply-template', { style: 'campervan', locale: 'en' })
  await post('/notes/apply-template', { destination: 'nz', locale: 'en' })

  // Two photos (the lightbox steps between them), the first one Day 1's and the trip's cover
  const photoIds: string[] = []
  for (const dayId of [days[0]!.id, days[1]!.id]) {
    const signed = await post<{ attachmentId: string; uploadUrl: string; thumbUploadUrl: string }>(
      '/attachments/sign',
      { kind: 'photo', mime: 'image/jpeg', bytes: jpeg.length, hasThumb: true, dayId },
    )
    for (const url of [signed.uploadUrl, signed.thumbUploadUrl]) {
      const put = await request.put(url, {
        headers: { ...headers, 'content-type': 'image/jpeg' },
        data: jpeg,
      })
      expect(put.status(), await put.text()).toBeLessThan(300)
    }
    await post(`/attachments/${signed.attachmentId}/complete`, {})
    photoIds.push(signed.attachmentId)
  }
  await send('patch', '', { coverAttachmentId: photoIds[0] })

  const { shareToken } = await post<{ shareToken: string }>('/shares', { options: {} })
  const { inviteToken } = await post<{ inviteToken: string }>('/invites', {})
  return { tripId: t.trip.id, memberToken: t.memberToken, shareToken, inviteToken, headers }
}

/** The member token, and the locale for both the app and the share page, before any script runs */
export async function prepare(page: Page, trip: RichTrip | null, locale: 'zh-TW' | 'en') {
  await page.addInitScript(
    ([id, token, value]) => {
      if (id) localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: token }))
      localStorage.setItem('tripfolio.locale', value!)
      localStorage.setItem('tripfolio.share.locale', value!)
    },
    [trip?.tripId ?? '', trip?.memberToken ?? '', locale],
  )
}

const catalogs = {
  en: { ...en, ...itineraryEn, ...photosEn },
  'zh-TW': { ...zhTW, ...itineraryZhTW, ...photosZhTW },
}
type Key = keyof (typeof catalogs)['zh-TW']

/** A message from the catalogs, so the specs follow copy edits; `{name}` placeholders filled in */
export function msg(
  locale: 'zh-TW' | 'en',
  key: Key,
  values: Record<string, string | number> = {},
): string {
  const text: string = catalogs[locale][key]
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
}

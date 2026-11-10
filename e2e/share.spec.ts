import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// The share page, full version (e8-t01b): a three-day trip with a lodging, two picks (one with a
// place), a photo uploaded through the media API, and two shares (everything / money and addresses
// hidden), seeded through the API. Checks the static route sketch on first paint, MapLibre only
// after a scroll (tiles requested), the picks wall and estimate on the full share only, and photos
// read with `?s=`. Needs `npm run dev` with local D1 migrated, and network for the map tiles.

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** A small JPEG drawn in the browser (thumbnails must be JPEG or WebP) */
async function tinyJpeg(browser: Browser): Promise<Buffer> {
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

interface Seeded {
  full: string
  hidden: string
  photoId: string
}

async function seed(request: APIRequestContext, JPEG: Buffer): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name: 'South Island loop',
      destination: 'New Zealand',
      startDate: inDays(30),
      endDate: inDays(32),
      tz: 'Pacific/Auckland',
      style: 'campervan',
      summary: 'Lakes, glaciers and stars',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const t = (await created.json()) as {
    trip: { id: string }
    memberToken: string
    days: { id: string; idx: number | null; date: string | null }[]
  }
  const headers = { authorization: `Bearer ${t.memberToken}` }
  const base = `/api/trips/${t.trip.id}`
  const days = t.days.filter((d) => d.idx !== null).sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  const post = async <T>(path: string, data: object): Promise<T> => {
    const res = await request.post(`${base}${path}`, { headers, data })
    expect(res.status(), `${path} ${await res.text()}`).toBeLessThan(300)
    return (await res.json()) as T
  }
  const place = async (nameLocal: string, nameEn: string, lat: number, lng: number) =>
    (await post<{ place: { id: string } }>('/places', { nameLocal, nameEn, lat, lng, address: `${nameEn} Rd` }))
      .place.id
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
  await post('/wishlist', {
    category: 'eat',
    name: 'Fergburger',
    placeId: zqn,
    estMinor: 2000,
    currency: 'NZD',
  })
  await post('/wishlist', { category: 'buy', name: 'Merino socks' })

  // A photo of Day 1 through the real upload flow, then the trip's cover
  const signed = await post<{ attachmentId: string; uploadUrl: string; thumbUploadUrl: string }>(
    '/attachments/sign',
    { kind: 'photo', mime: 'image/jpeg', bytes: JPEG.length, hasThumb: true, dayId: days[0]!.id },
  )
  for (const url of [signed.uploadUrl, signed.thumbUploadUrl]) {
    const put = await request.put(url, {
      headers: { ...headers, 'content-type': 'image/jpeg' },
      data: JPEG,
    })
    expect(put.status(), await put.text()).toBeLessThan(300)
  }
  await post(`/attachments/${signed.attachmentId}/complete`, {})
  const patched = await request.patch(base, { headers, data: { coverAttachmentId: signed.attachmentId } })
  expect(patched.status()).toBe(200)

  const share = async (options: object) =>
    (await post<{ shareToken: string }>('/shares', { options })).shareToken
  return {
    full: await share({}),
    hidden: await share({ hideMoney: true, hideAddresses: true }),
    photoId: signed.attachmentId,
  }
}

let seeded: Seeded

test.beforeAll(async ({ request, browser }) => {
  seeded = await seed(request, await tinyJpeg(browser))
})

const isMapLibre = (url: string) => /maplibre/i.test(url)
const isTile = (url: string) => /tiles\.openfreemap\.org|openfreemap\.org\/.*\.pbf/.test(url)

async function open(page: Page, token: string, locale: 'zh-TW' | 'en') {
  await page.addInitScript((value) => localStorage.setItem('tripfolio.share.locale', value), locale)
  const requests: string[] = []
  page.on('request', (r) => requests.push(r.url()))
  await page.goto(`/s/${token}`)
  await expect(page.getByRole('heading', { level: 1, name: 'South Island loop' })).toBeVisible()
  return requests
}

for (const width of [375, 1280]) {
  for (const locale of ['zh-TW', 'en'] as const) {
    test(`full share at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 812 : 900 })
      const requests = await open(page, seeded.full, locale)
      const zh = locale === 'zh-TW'

      // The sketch is there at once; MapLibre is not loaded before a scroll
      const sketch = page.getByTestId('share-map').locator('svg[role="img"]')
      await expect(sketch).toBeVisible()
      await expect(sketch.locator('line')).toHaveCount(2)
      await page.waitForTimeout(800)
      expect(requests.filter(isMapLibre), 'maplibre before scroll').toEqual([])
      await expect(page.getByTestId('share-live-map')).toHaveCount(0)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-${width}-${locale}-top.png` })

      // Day card: lodging, checkout, photo strip read with ?s=
      await expect(page.getByText(zh ? '今晚：Lakes Edge Holiday Park' : 'Tonight: Lakes Edge Holiday Park').first()).toBeVisible()
      await expect(page.getByText(zh ? '退房 10:00' : 'Check-out 10:00')).toBeVisible()
      const thumb = page.locator(`img[src*="/api/media/${seeded.photoId}/thumb?s="]`).first()
      await thumb.scrollIntoViewIfNeeded()
      await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)

      // Scroll: the live map mounts and asks for tiles
      await page.getByTestId('share-map').scrollIntoViewIfNeeded()
      await page.mouse.wheel(0, 200)
      await expect(page.getByTestId('share-live-map')).toHaveCount(1)
      await expect(page.getByTestId('share-live-map').locator('canvas')).toBeVisible({ timeout: 20_000 })
      await expect.poll(() => requests.some(isTile), { timeout: 20_000 }).toBe(true)
      expect(requests.some(isMapLibre)).toBe(true)

      // Picks wall and estimate
      const picks = page.getByTestId('share-picks')
      await expect(picks.getByRole('heading', { name: zh ? '必吃必買' : 'Must-eats and must-buys' })).toBeVisible()
      await expect(picks.locator('article')).toHaveCount(2)
      await expect(picks.getByText(/NZD|NZ\$/)).toBeVisible()
      const estimate = page.getByTestId('share-estimate')
      await expect(estimate.getByRole('heading', { name: zh ? /費用概算/ : /Estimated costs/ })).toBeVisible()
      await expect(estimate.locator('tbody tr')).not.toHaveCount(0)
      await page.waitForTimeout(1500)
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-${width}-${locale}-full.png`, fullPage: true })
    })
  }
}

test('hidden share: no estimate, no prices, still the map and picks', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await open(page, seeded.hidden, 'zh-TW')
  await expect(page.getByTestId('share-map').locator('svg[role="img"]')).toBeVisible()
  await expect(page.getByTestId('share-picks').locator('article')).toHaveCount(2)
  await expect(page.getByTestId('share-estimate')).toHaveCount(0)
  await expect(page.getByText(/NZD|NZ\$|A\$|AUD/)).toHaveCount(0)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/share-375-hidden.png`, fullPage: true })
})

test('first-screen timing', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await open(page, seeded.full, 'zh-TW')
  await page.waitForTimeout(1000)
  const timing = await page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const lcp = await new Promise<number | null>((resolve) => {
      new PerformanceObserver((list) => resolve(list.getEntries().at(-1)?.startTime ?? null)).observe({
        type: 'largest-contentful-paint',
        buffered: true,
      })
      setTimeout(() => resolve(null), 2000)
    })
    const js = performance
      .getEntriesByType('resource')
      .filter((r) => (r as PerformanceResourceTiming).initiatorType === 'script')
      .reduce((sum, r) => sum + (r as PerformanceResourceTiming).transferSize, 0)
    return {
      ttfb: Math.round(nav.responseStart),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: lcp === null ? null : Math.round(lcp),
      scriptBytes: js,
    }
  })
  console.log('share timing', JSON.stringify(timing), 'token', seeded.full)
})

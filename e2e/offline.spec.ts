import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// e10-t05 / e3-t06 walk-through. The Service Worker is only registered in production builds, so
// run against the preview build:
//   npm run build && npx vite preview --port 5406 --strictPort
//   BASE_URL=http://localhost:5406 npx playwright test e2e/offline.spec.ts
// (local D1 migrated: `npx wrangler d1 migrations apply tripfolio --local`). Offline is
// Playwright's context.setOffline(); a real phone is still needed for AC-10.4 and AC-3.5.

test.use({ locale: 'zh-TW', viewport: { width: 375, height: 812 } })

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function seed(request: APIRequestContext, name: string, startIn = -1) {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(startIn),
      endDate: inDays(startIn + 6),
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const { trip, memberToken } = (await created.json()) as {
    trip: { id: string }
    memberToken: string
  }
  const headers = { authorization: `Bearer ${memberToken}` }
  const fx = await request.put(`/api/trips/${trip.id}/fx/overrides`, {
    headers,
    data: { NZD: 0.91 },
  })
  expect(fx.ok()).toBe(true)
  return { tripId: trip.id, token: memberToken, headers }
}

async function signIn(page: Page, tripId: string, token: string) {
  await page.addInitScript(
    ([id, value]) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [tripId, token],
  )
}

/** Waits until the Service Worker is active and controls the page */
async function controlled(page: Page): Promise<string> {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false
    await navigator.serviceWorker.ready
    return Boolean(navigator.serviceWorker.controller)
  })
  return page.evaluate(() => navigator.serviceWorker.controller!.scriptURL)
}

test('the Service Worker registers, precaches the shell and opens a recent trip offline', async ({
  page,
  context,
  request,
}) => {
  const { tripId, token } = await seed(request, 'Offline shell')
  await signIn(page, tripId, token)
  await page.goto(`/trips/${tripId}`)
  await expect(page.getByRole('banner')).toContainText('Offline shell')
  expect(await controlled(page)).toMatch(/\/sw\.js$/)

  // The manifest is linked and served
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href
    return (await fetch(href)).json()
  })
  expect(manifest).toMatchObject({ short_name: 'Tripfolio', display: 'standalone' })

  // The shell cache holds index.html and the hashed assets; the trip's data is cached
  const cacheNames = await page.evaluate(() => caches.keys())
  expect(cacheNames.some((name) => name.startsWith('shell-'))).toBe(true)
  await page.reload()
  await expect(page.getByRole('banner')).toContainText('Offline shell')
  await expect
    .poll(() => page.evaluate((id) => caches.has(`data-${id}`), tripId))
    .toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('banner')).toContainText('Offline shell')
  await expect(page.getByTestId('offline-badge')).toHaveText('離線')
  await context.setOffline(false)
})

test('an expense logged offline waits in the queue and is sent when back online', async ({
  page,
  context,
  request,
}) => {
  const { tripId, token, headers } = await seed(request, 'Offline queue')
  await signIn(page, tripId, token)
  await page.goto(`/trips/${tripId}/expenses`)
  await expect(page.getByRole('heading', { name: '還沒有花費' })).toBeVisible()

  await context.setOffline(true)
  await page.getByRole('navigation', { name: '旅程導覽' }).getByRole('button', { name: '記一筆' }).click()
  const sheet = page.getByRole('dialog', { name: '記一筆' })
  await sheet.getByLabel('金額').fill('45')
  await sheet.getByRole('radio', { name: '餐飲' }).click()
  await sheet.getByRole('button', { name: '儲存' }).click()
  await expect(sheet).toBeHidden()

  const badge = page.getByTestId('offline-badge')
  await expect(badge).toHaveText('離線 · 1 筆待同步')
  // Stored in IndexedDB, nothing reached the server yet
  const list = async () =>
    ((await (await request.get(`/api/trips/${tripId}/expenses`, { headers })).json()) as {
      expenses: { amountMinor: number; currency: string }[]
    }).expenses
  expect(await list()).toHaveLength(0)
  await badge.click()
  await expect(page.getByRole('dialog', { name: '離線與同步' })).toContainText('新增花費')
  await page.keyboard.press('Escape')

  await context.setOffline(false)
  await expect(badge).toBeHidden({ timeout: 15_000 })
  await expect.poll(list).toHaveLength(1)
  expect((await list())[0]).toMatchObject({ amountMinor: 4500, currency: 'NZD' })
  // The list reloads by itself after the replay
  await expect(page.getByRole('main')).toContainText('NZ$45.00')
})

const STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const TILEJSON = 'https://tiles.openfreemap.org/planet'

test.describe('offline map', () => {
  // Without the worker, so page.route sees every request; tiles.ts writes Cache Storage itself
  test.use({ serviceWorkers: 'block' })

  test('downloads the tiles of the trip area into tiles-<tripId> and clears them', async ({
    page,
    request,
  }) => {
    const { tripId, token, headers } = await seed(request, 'Offline map')
    const place = await request.post(`/api/trips/${tripId}/places`, {
      headers,
      data: { nameLocal: 'Queenstown', lat: -45.0312, lng: 168.6626, source: 'manual', category: 'other' },
    })
    expect(place.status()).toBe(201)

    let tileRequests = 0
    await page.route('https://tiles.openfreemap.org/**', async (route) => {
      const url = route.request().url()
      if (url === STYLE) {
        return route.fulfill({
          json: {
            version: 8,
            sources: {
              openmaptiles: { type: 'vector', url: TILEJSON },
              ne2_shaded: {
                type: 'raster',
                maxzoom: 6,
                tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
              },
            },
            glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
            layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eee' } }],
          },
        })
      }
      if (url === TILEJSON) {
        return route.fulfill({
          json: {
            tilejson: '3.0.0',
            tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'],
            maxzoom: 14,
          },
        })
      }
      if (/\/\d+\/\d+\/\d+\.(pbf|png)$/.test(url)) tileRequests += 1
      return route.fulfill({ status: 200, body: '' })
    })

    await signIn(page, tripId, token)
    await page.goto(`/trips/${tripId}/map`)
    await page.getByRole('button', { name: '圖層' }).click()
    await page.getByRole('button', { name: '下載離線地圖' }).click()
    const sheet = page.getByRole('dialog', { name: '離線地圖' })
    await expect(sheet.getByTestId('offline-map-estimate')).toContainText('張圖磚')

    const before = tileRequests
    await sheet.getByRole('button', { name: '下載' }).click()
    await expect(sheet.getByTestId('offline-map-saved')).toBeVisible({ timeout: 30_000 })

    const keys = await page.evaluate(
      async (id) => (await (await caches.open(`tiles-${id}`)).keys()).map((r) => r.url),
      tripId,
    )
    const tiles = keys.filter((url) => /\/\d+\/\d+\/\d+\.(pbf|png)$/.test(url))
    // z5–z12 of one point + 20 km, plus the raster z5–z6
    const zooms = new Set(tiles.map((url) => Number(/\/(\d+)\/\d+\/\d+\.\w+$/.exec(url)![1])))
    expect([...zooms].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    expect(tiles.length).toBeGreaterThan(8)
    expect(tileRequests - before).toBeGreaterThanOrEqual(tiles.length)
    expect(keys).toContain(STYLE)
    expect(keys).toContain(TILEJSON)
    await expect(sheet.getByTestId('offline-map-saved')).toContainText(String(keys.length))

    await sheet.getByRole('button', { name: '清除' }).click()
    await expect(sheet.getByTestId('offline-map-saved')).toBeHidden()
    expect(await page.evaluate((id) => caches.has(`tiles-${id}`), tripId)).toBe(false)
  })
})

test('the install banner shows on the trip home the week before departure and can be dismissed', async ({
  page,
  request,
}) => {
  const { tripId, token } = await seed(request, 'Install soon', 3)
  await signIn(page, tripId, token)
  // Chromium only fires beforeinstallprompt for a real install candidate: simulate it
  await page.addInitScript(() => {
    window.addEventListener('load', () => {
      const event = new Event('beforeinstallprompt') as Event & Record<string, unknown>
      event.prompt = async () => undefined
      event.userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(event)
    })
  })
  await page.goto(`/trips/${tripId}`)
  const banner = page.getByTestId('install-banner')
  await expect(banner).toContainText('把旅誌加到主畫面')
  await expect(banner.getByRole('button', { name: '安裝' })).toBeVisible()
  await banner.getByRole('button', { name: '不用了' }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await expect(page.getByRole('banner')).toContainText('Install soon')
  await expect(page.getByTestId('install-banner')).toBeHidden()
})

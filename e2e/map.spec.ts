import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// The map page (e3-t04 frontend, e3-t05 layer panel): a trip with two days of three stops around
// Queenstown and one pocket place, seeded through the API; POST /geo/routes is mocked (one
// ORS-like answer per batch, the rest estimates). Needs `npm run dev` with local D1 migrated, and
// network for the OpenFreeMap style and tiles. The page exposes `window.__tripfolioMap` in dev.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

const DAY1 = [
  { name: 'Fergburger', lat: -45.0312, lng: 168.6588 },
  { name: 'Skyline Queenstown', lat: -45.0287, lng: 168.649 },
  { name: 'Arrowtown', lat: -44.9416, lng: 168.8346 },
]
const DAY2 = [
  { name: 'Glenorchy', lat: -44.8507, lng: 168.388 },
  { name: 'Cardrona Hotel', lat: -44.874, lng: 169.009 },
  { name: 'Wanaka Tree', lat: -44.6995, lng: 169.1335 },
]
const POCKET = { name: 'Lake Hayes', lat: -44.981, lng: 168.81 }

/** The bits of the MapLibre instance the test reads (MapPage sets window.__tripfolioMap in dev) */
interface DevMap {
  getStyle(): { sources: Record<string, unknown> }
  getCenter(): { lat: number; lng: number }
  getZoom(): number
  loaded(): boolean
  isMoving(): boolean
}
declare global {
  interface Window {
    __tripfolioMap?: DevMap
  }
}

interface Seeded {
  tripId: string
  token: string
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name: '皇后鎮地圖',
      destination: 'Queenstown',
      startDate: inDays(20),
      endDate: inDays(21),
      tz: 'Pacific/Auckland',
      style: 'roadtrip',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const body = (await created.json()) as {
    trip: { id: string }
    memberToken: string
    days: { id: string; idx: number | null }[]
  }
  const tripId = body.trip.id
  const headers = { authorization: `Bearer ${body.memberToken}` }
  const days = body.days.filter((d) => d.idx !== null).sort((a, b) => a.idx! - b.idx!)
  expect(days).toHaveLength(2)

  const addPlace = async (p: { name: string; lat: number; lng: number }) => {
    const res = await request.post(`/api/trips/${tripId}/places`, {
      headers,
      data: { nameLocal: p.name, lat: p.lat, lng: p.lng, source: 'coords' },
    })
    expect(res.status()).toBe(201)
    return ((await res.json()) as { place: { id: string } }).place.id
  }
  for (const [i, list] of [DAY1, DAY2].entries()) {
    for (const p of list) {
      const placeId = await addPlace(p)
      const res = await request.post(`/api/trips/${tripId}/stops`, {
        headers,
        data: { dayId: days[i]!.id, title: p.name, placeId, type: 'sight' },
      })
      expect(res.status()).toBe(201)
    }
  }
  await addPlace(POCKET)
  return { tripId, token: body.memberToken }
}

interface RouteLeg {
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
  mode: string
}

/** Mocks POST /geo/routes: the first leg of each batch ORS-like (bent line), the rest estimates */
async function mockRoutes(page: Page) {
  const calls: RouteLeg[][] = []
  await page.route('**/api/trips/*/geo/routes', async (route) => {
    const { legs } = route.request().postDataJSON() as { legs: RouteLeg[] }
    calls.push(legs)
    await route.fulfill({
      json: {
        routes: legs.map((leg, i) => ({
          distanceM: 5000,
          durationS: 600,
          geometry: {
            type: 'LineString',
            coordinates:
              i === 0
                ? [
                    [leg.from.lng, leg.from.lat],
                    [(leg.from.lng + leg.to.lng) / 2, leg.from.lat],
                    [leg.to.lng, leg.to.lat],
                  ]
                : [
                    [leg.from.lng, leg.from.lat],
                    [leg.to.lng, leg.to.lat],
                  ],
          },
          source: i === 0 ? 'ors' : 'estimate',
          cached: false,
          ...(i === 0 ? {} : { fallbackReason: 'quota' }),
        })),
      },
    })
  })
  return calls
}

const pinList = (page: Page) =>
  page.getByRole('list', { name: '地圖上的地點' }).getByRole('listitem')

/** Kinds of the lines the map draws now (route / estimate / overnight) */
const lineKinds = (page: Page) =>
  page.evaluate(() => {
    const map = window.__tripfolioMap
    const source = map?.getStyle().sources['tf-lines'] as
      { data?: { features?: { properties: { kind: string } }[] } } | undefined
    return (source?.data?.features ?? []).map((f) => f.properties.kind).sort()
  })

const center = (page: Page) =>
  page.evaluate(() => {
    const map = window.__tripfolioMap!
    const c = map.getCenter()
    return { lat: c.lat, lng: c.lng, zoom: map.getZoom() }
  })

async function mapIdle(page: Page) {
  await page.waitForFunction(() => {
    const map = window.__tripfolioMap
    return !!map && map.loaded() && !map.isMoving()
  })
}

async function pickDay(page: Page, n: number, wide: boolean) {
  if (wide) {
    await page.getByRole('combobox', { name: '選一天' }).selectOption(String(n - 1))
  } else {
    await page.getByRole('button', { name: '選一天' }).click()
    const sheet = page.getByRole('dialog', { name: '選一天' })
    await sheet.getByRole('button', { name: new RegExp(`Day ${n}`) }).click()
    await expect(sheet).toBeHidden()
  }
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: pins, day switch, routes with cache, manual pin, layer toggle`, async ({
    page,
    request,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const wide = width >= 768
    await page.setViewportSize({ width, height })
    const { tripId, token } = await seed(request)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [tripId, token],
    )
    const calls = await mockRoutes(page)

    await page.goto(`/trips/${tripId}/map`)
    // Whole trip: six stops and the pocket place; one night-to-night link; no route requests
    await expect(pinList(page)).toHaveCount(7)
    await mapIdle(page)
    await expect.poll(() => lineKinds(page)).toEqual(['overnight'])
    expect(calls).toHaveLength(0)
    // The map fills the section without scrolling the page sideways
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width)
    const region = page.getByRole('region', { name: '旅程地圖' })
    const box = (await region.boundingBox())!
    expect(box.height).toBeGreaterThan(height * 0.6)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-${label}-trip.png` })

    // Day 1: its three stops and the pocket place; one routed line and one estimate
    const tripCenter = await center(page)
    await page
      .getByRole('radiogroup', { name: '地圖範圍' })
      .getByRole('radio', { name: 'Day 1' })
      .click()
    await expect(pinList(page)).toHaveCount(4)
    await expect.poll(() => lineKinds(page)).toEqual(['estimate', 'route'])
    await expect(page.getByText('估 · 直線估算')).toBeVisible()
    await mapIdle(page)
    const day1Center = await center(page)
    expect(
      Math.abs(day1Center.lng - tripCenter.lng) + Math.abs(day1Center.lat - tripCenter.lat),
    ).toBeGreaterThan(0.01)
    const afterDay1 = calls.length
    expect(afterDay1).toBeGreaterThanOrEqual(1)
    expect(calls.at(-1)).toHaveLength(2)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-${label}-day1.png` })

    // Day 2 refits elsewhere and asks for its own legs
    await pickDay(page, 2, wide)
    await expect(page.getByRole('radio', { name: 'Day 2' })).toHaveAttribute('aria-checked', 'true')
    await expect(pinList(page)).toHaveCount(4)
    await mapIdle(page)
    const day2Center = await center(page)
    // Day 2 spans about four times the longitude of Day 1: the refit zooms out
    expect(day1Center.zoom - day2Center.zoom).toBeGreaterThan(1)
    expect(calls.length).toBeGreaterThan(afterDay1)

    // Back to Day 1: served from the session cache, no new request
    const beforeBack = calls.length
    await pickDay(page, 1, wide)
    await expect.poll(() => lineKinds(page)).toEqual(['estimate', 'route'])
    expect(calls.length).toBe(beforeBack)

    // Manual pin: right-click the map, name it, it joins the pocket list
    await mapIdle(page)
    const canvas = page.locator('.maplibregl-canvas')
    const canvasBox = (await canvas.boundingBox())!
    await page.mouse.click(
      canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height * 0.7,
      {
        button: 'right',
      },
    )
    const sheet = page.getByRole('dialog', { name: '在這裡放針' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: '放針' }).click()
    await expect(sheet.getByText('請輸入名稱')).toBeVisible()
    await sheet.getByLabel('名稱').fill('停車場')
    await sheet.getByRole('button', { name: '放針' }).click()
    await expect(sheet).toBeHidden()
    await expect(pinList(page)).toHaveCount(5)
    await expect(pinList(page).filter({ hasText: '口袋名單 · 停車場' })).toHaveCount(1)

    // Layer panel: lodging and picks are disabled for now; turning off the pocket list hides both
    await page.getByRole('button', { name: '圖層' }).click()
    const panel = page.getByRole('group', { name: '圖層' })
    await expect(panel.getByRole('checkbox', { name: '住宿' })).toBeDisabled()
    await expect(panel.getByRole('checkbox', { name: '必吃必買' })).toBeDisabled()
    await panel.getByRole('checkbox', { name: '口袋名單' }).uncheck()
    await expect(pinList(page)).toHaveCount(3)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/map-${label}-layers.png` })
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // The card's 「排進這天」 goes to the itinerary with the stop
    // (the pin list is the keyboard path: focus it and press Enter)
    await pinList(page).first().getByRole('button').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: '排進這天' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/itinerary\\?stop=`))

    expect(errors).toEqual([])
  })
}

test('empty trip: points to the itinerary', async ({ page, request }) => {
  const created = await request.post('/api/trips', {
    data: {
      name: '空的旅程',
      startDate: inDays(10),
      endDate: inDays(11),
      tz: 'Pacific/Auckland',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  const { trip, memberToken } = (await created.json()) as {
    trip: { id: string }
    memberToken: string
  }
  await page.addInitScript(
    ([id, value]) =>
      localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [trip.id, memberToken],
  )
  await page.goto(`/trips/${trip.id}/map`)
  await expect(page.getByRole('heading', { name: '還沒有地點，去日程加行程點' })).toBeVisible()
  await expect(page.getByRole('link', { name: '去日程' })).toHaveAttribute(
    'href',
    `/trips/${trip.id}/itinerary`,
  )
  await page.getByRole('button', { name: '還是開啟地圖' }).click()
  await expect(page.getByRole('region', { name: '旅程地圖' })).toBeVisible()
})

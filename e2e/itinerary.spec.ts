import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

// B1 walk-through (e2-t02, e2-t03, e3-t02): open the itinerary, add a stop through place search (the
// search is mocked so no provider is called), edit its time and type, add a second stop from pasted
// coordinates, see the leg between them marked 「估」, move a stop down, delete one — at phone and
// desktop widths. Run against `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function createTrip(request: APIRequestContext, name: string) {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(40),
      endDate: inDays(43),
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { trip: { id: string }; memberToken: string }
}

async function open(page: Page, request: APIRequestContext, name: string) {
  const { trip, memberToken } = await createTrip(request, name)
  await page.addInitScript(
    ([id, value]) =>
      localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [trip.id, memberToken],
  )
  const searches: string[] = []
  await page.route('**/api/trips/*/geo/search?*', async (route) => {
    searches.push(new URL(route.request().url()).searchParams.get('q') ?? '')
    await route.fulfill({
      json: {
        results: [
          {
            nameLocal: 'Fergburger',
            nameEn: 'Fergburger',
            lat: -45.0318,
            lng: 168.6598,
            address: '42 Shotover Street, Queenstown 9300',
            category: 'food',
            source: 'photon',
            externalId: 'osm:N336415647',
          },
        ],
        source: 'photon',
        cached: false,
      },
    })
  })
  await page.goto(`/trips/${trip.id}/itinerary`)
  return { tripId: trip.id, searches }
}

/** The editor: a Sheet on phones, the detail column on desktop */
const editor = (page: Page, desktop: boolean): Locator =>
  desktop
    ? page.getByRole('complementary', { name: '細節' })
    : page.getByRole('dialog').filter({ has: page.getByLabel('搜尋地點').or(page.getByText('更換地點')) })

const cardNames = (page: Page) =>
  page.locator('[data-stop-id] > button:first-child > span:first-child').allTextContents()

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: add, edit, move and delete stops`, async ({ page, request }) => {
    const desktop = width >= 1200
    await page.setViewportSize({ width, height })
    const { searches } = await open(page, request, `Itinerary ${label}`)

    // The skeleton: day chips, Day 1 header, lodging placeholder, the dashed add button
    const strip = page.getByRole('navigation', { name: '選擇日期' })
    await expect(strip.getByRole('button')).toHaveCount(4)
    await expect(strip.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { level: 2, name: /^Day 1/ })).toBeVisible()
    await expect(page.getByText('今晚住：—').first()).toBeVisible()
    if (!desktop) await expect(page.getByText('第 1 天，共 4 天')).toBeVisible()
    // The chip strip scrolls on its own; the page never scrolls sideways
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await shot(page, `${label}-itinerary-empty`)

    // 1. A stop from place search
    await page.getByRole('button', { name: '＋ 加行程點' }).first().click()
    const pane = editor(page, desktop)
    await pane.getByLabel('搜尋地點').fill('Fergburger')
    await pane.getByRole('button', { name: /Fergburger/ }).click()
    expect(searches).toContain('Fergburger')
    await expect(pane.getByText('42 Shotover Street, Queenstown 9300')).toBeVisible()
    // The result's category picks the type
    await expect(pane.getByRole('radio', { name: '餐廳' })).toHaveAttribute('aria-checked', 'true')
    await pane.getByLabel('開始時間').fill('12:00')
    await pane.getByLabel('結束時間').fill('13:00')
    await pane.getByRole('button', { name: '儲存' }).click()

    const ferg = page.locator('[data-stop-id]').filter({ hasText: 'Fergburger' })
    await expect(ferg).toContainText('12:00–13:00')
    await expect(ferg).toContainText('餐廳')

    // 2. Edit its time and type
    await page.getByRole('button', { name: '編輯「Fergburger」' }).click()
    await expect(pane.getByLabel('開始時間')).toHaveValue('12:00')
    await pane.getByRole('radio', { name: '休息' }).click()
    await pane.getByLabel('開始時間').fill('12:30')
    await pane.getByRole('radio', { name: '需預訂' }).click()
    await pane.getByRole('button', { name: '儲存' }).click()
    await expect(ferg).toContainText('12:30–13:00')
    await expect(ferg).toContainText('休息')
    await expect(ferg).toContainText('需預訂')

    // 3. A second stop from pasted coordinates (POST /geo/parse, no provider involved)
    await page.getByRole('button', { name: '＋ 加行程點' }).first().click()
    await pane.getByLabel('搜尋地點').fill('-44.8513, 168.3871')
    await pane.getByRole('button', { name: '使用這個座標' }).click()
    await expect(pane.getByText('-44.85130, 168.38710').first()).toBeVisible()
    await pane.getByLabel('名稱').fill('Glenorchy')
    await pane.getByRole('button', { name: '儲存' }).click()
    await expect(page.locator('[data-stop-id]').filter({ hasText: 'Glenorchy' })).toBeVisible()

    // 4. The leg between them: campervan, a time and a distance, marked as an estimate
    const leg = page.locator('[data-leg]').first()
    await expect(leg).toContainText('露營車')
    await expect(leg).toContainText('km')
    await expect(leg.getByText('估')).toBeVisible()
    await expect(page.getByText(/^駕駛 .+ · .+km$/).first()).toBeVisible()
    await shot(page, `${label}-itinerary-two-stops`)

    // 5. Move Fergburger down through the ⋯ menu
    expect(await cardNames(page)).toEqual(['Fergburger', 'Glenorchy'])
    await page.getByRole('button', { name: '「Fergburger」的更多動作' }).click()
    await page.getByRole('menuitem', { name: '下移' }).click()
    await expect.poll(() => cardNames(page)).toEqual(['Glenorchy', 'Fergburger'])
    // Survives a reload: the server has the new order
    await page.reload()
    await expect.poll(() => cardNames(page)).toEqual(['Glenorchy', 'Fergburger'])

    // 6. Delete Glenorchy
    await page.getByRole('button', { name: '編輯「Glenorchy」' }).click()
    await pane.getByRole('button', { name: '刪除行程點' }).click()
    await page
      .getByRole('dialog', { name: '刪除「Glenorchy」？' })
      .getByRole('button', { name: '刪除', exact: true })
      .click()
    await expect(page.locator('[data-stop-id]').filter({ hasText: 'Glenorchy' })).toHaveCount(0)
    await expect(page.locator('[data-leg]')).toHaveCount(0)
    await page.reload()
    await expect.poll(() => cardNames(page)).toEqual(['Fergburger'])

    // 7. Day title and colour; move to another day
    await page.getByRole('button', { name: '編輯這一天' }).first().click()
    const dayPane = desktop
      ? page.getByRole('complementary', { name: '細節' })
      : page.getByRole('dialog', { name: '編輯 Day 1' })
    await dayPane.getByLabel('這天的標題').fill('皇后鎮')
    await dayPane.getByRole('radio', { name: '靛藍' }).click()
    await dayPane.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Day 1 · 皇后鎮' })).toBeVisible()
    await expect(strip.getByRole('button').first()).toContainText('皇后鎮')

    await page.getByRole('button', { name: '「Fergburger」的更多動作' }).click()
    await page.getByRole('menuitem', { name: '移到別天…' }).click()
    await page
      .getByRole('dialog', { name: '把「Fergburger」移到哪一天？' })
      .getByRole('button', { name: /^Day 3/ })
      .click()
    await expect(page.getByText('已移到 Day 3')).toBeVisible()
    if (!desktop) {
      await expect(page.getByRole('heading', { level: 2, name: /^Day 3/ })).toBeVisible()
    }
    await expect(
      page.locator('section[data-day-id]').filter({ hasText: 'Fergburger' }).getByRole('heading'),
    ).toHaveText(/^Day 3/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await shot(page, `${label}-itinerary-moved`)
  })
}

test('English labels and the place picker errors', async ({ browser, request }) => {
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  const { trip, memberToken } = await createTrip(request, 'English itinerary')
  await page.addInitScript(
    ([id, value]) =>
      localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [trip.id, memberToken],
  )
  let calls = 0
  await page.route('**/api/trips/*/geo/search?*', async (route) => {
    calls += 1
    if (calls === 1) {
      await route.fulfill({
        status: 429,
        headers: { 'retry-after': '42' },
        json: { error: { code: 'rate_limited', message: 'slow down', details: { retryAfterS: 42 } } },
      })
    } else {
      await route.fulfill({
        status: 502,
        json: { error: { code: 'geo_unavailable', message: 'down' } },
      })
    }
  })
  await page.goto(`/trips/${trip.id}/itinerary`)
  await expect(page.getByRole('heading', { level: 2, name: /^Day 1/ })).toBeVisible()
  await page.getByRole('button', { name: '＋ Add a stop' }).first().click()
  const pane = page.getByRole('complementary', { name: 'Details' })
  await pane.getByLabel('Find a place').fill('Queenstown')
  await expect(pane.getByRole('alert')).toHaveText('Too many searches; try again in 42 s.')
  await pane.getByLabel('Find a place').fill('Queenstown gardens')
  await expect(pane.getByRole('alert')).toHaveText(
    'Place search is unavailable right now; try again later.',
  )
  // The manual pin hands over to the map
  await pane.getByRole('button', { name: 'Drop a pin' }).click()
  await expect(pane.getByRole('status')).toContainText('Long-press the map')
  await context.close()
})

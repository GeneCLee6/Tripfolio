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
    : page
        .getByRole('dialog')
        .filter({ has: page.getByLabel('搜尋地點').or(page.getByText('更換地點')) })

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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await shot(page, `${label}-itinerary-empty`)

    // 1. A stop from place search
    await page.getByRole('button', { name: '＋ 加行程點' }).first().click()
    const pane = editor(page, desktop)
    await pane.getByLabel('搜尋地點').fill('Fergburger')
    await pane.getByRole('button', { name: /Fergburger/ }).click()
    expect(searches).toContain('Fergburger')
    await expect(pane.getByText('42 Shotover Street, Queenstown 9300')).toBeVisible()
    // The result's category picks the type
    await expect(pane.getByRole('radio', { name: '餐飲' })).toHaveAttribute('aria-checked', 'true')
    await pane.getByLabel('開始時間').fill('12:00')
    await pane.getByLabel('結束時間').fill('13:00')
    await pane.getByRole('button', { name: '儲存' }).click()

    const ferg = page.locator('[data-stop-id]').filter({ hasText: 'Fergburger' })
    await expect(ferg).toContainText('12:00–13:00')
    await expect(ferg).toContainText('餐飲')

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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
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
        json: {
          error: { code: 'rate_limited', message: 'slow down', details: { retryAfterS: 42 } },
        },
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
  await page.getByRole('button', { name: '+ Add stop' }).first().click()
  const pane = page.getByRole('complementary', { name: 'Details' })
  await pane.getByLabel('Find a place').fill('Queenstown')
  await expect(pane.getByRole('alert')).toHaveText('Too many searches; try again in 42 s.')
  await pane.getByLabel('Find a place').fill('Queenstown gardens')
  await expect(pane.getByRole('alert')).toHaveText(
    'Place search is unavailable right now; try again later.',
  )
  // The manual pin hands over to the map
  await pane.getByRole('button', { name: 'Drop a pin' }).click()
  await expect(pane.getByRole('status')).toContainText('long-press the map')
  await context.close()
})

// ---- B3i (e2-t04, e2-t05, e2-t06): drag and drop, leg overrides, time checks ----

/**
 * A trip with three stops on Day 1 created through the API: Fergburger is closed on that weekday,
 * Glenorchy and Kingston have overlapping bookings
 */
async function seed(request: APIRequestContext, name: string) {
  const { trip, memberToken } = await createTrip(request, name)
  const headers = { authorization: `Bearer ${memberToken}` }
  const daysResponse = await request.get(`/api/trips/${trip.id}/days`, { headers })
  const { days } = (await daysResponse.json()) as {
    days: { id: string; date: string; idx: number | null }[]
  }
  const day1 = days[0]
  const weekday = new Date(`${day1.date}T00:00:00Z`).getUTCDay()
  // Local NZ wall clock → UTC (December: NZDT, UTC+13)
  const at = (hm: string) => {
    const [h, m] = hm.split(':').map(Number)
    const [y, mo, d] = day1.date.split('-').map(Number)
    return new Date(Date.UTC(y, mo - 1, d, h - 13, m)).toISOString().replace('.000Z', 'Z')
  }
  const place = async (nameLocal: string, lat: number, lng: number, hours: unknown = null) => {
    const response = await request.post(`/api/trips/${trip.id}/places`, {
      headers,
      data: { nameLocal, lat, lng, category: 'food', source: 'manual', hours },
    })
    expect(response.status()).toBe(201)
    return ((await response.json()) as { place: { id: string } }).place.id
  }
  const ferg = await place('Fergburger', -45.0318, 168.6598, {
    periods: [{ day: (weekday + 1) % 7, open: '09:00', close: '17:00' }],
  })
  const glen = await place('Glenorchy', -44.8513, 168.3871)
  const king = await place('Kingston', -45.3333, 168.7167)
  const ids: Record<string, string> = {}
  for (const [title, placeId, start, end, booking] of [
    ['Fergburger', ferg, '10:00', '11:00', 'none'],
    ['Glenorchy', glen, '12:00', '13:30', 'booked'],
    ['Kingston', king, '13:00', '14:00', 'todo'],
  ] as const) {
    const response = await request.post(`/api/trips/${trip.id}/stops`, {
      headers,
      data: { dayId: day1.id, title, placeId, startAt: at(start), endAt: at(end), booking },
    })
    expect(response.status()).toBe(201)
    ids[title] = ((await response.json()) as { stop: { id: string } }).stop.id
  }
  return { trip, memberToken, days, ids }
}

const dayNames = (page: Page, dayId: string) =>
  page
    .locator(
      `section[data-day-id="${dayId}"] [data-stop-id] > button:first-child > span:first-child`,
    )
    .allTextContents()

/** A key press with a pause after it (the drag library listens from the next tick on) */
async function press(page: Page, key: string) {
  await page.keyboard.press(key)
  await page.waitForTimeout(150)
}

/** Press on `from` and move to `to` in small steps (dnd-kit needs movement after the press) */
async function mouseDrag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = (await from.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 6, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.move(to.x, to.y + 1, { steps: 2 })
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: drag and drop, leg override and time checks`, async ({ page, request }) => {
    const desktop = width >= 1200
    await page.setViewportSize({ width, height })
    const { trip, memberToken, days, ids } = await seed(request, `B3i ${label}`)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, memberToken],
    )
    await page.goto(`/trips/${trip.id}/itinerary`)
    const day1 = days[0].id
    await expect.poll(() => dayNames(page, day1)).toEqual(['Fergburger', 'Glenorchy', 'Kingston'])

    // e2-t06: the two warnings under the day header, and marks on the cards
    const warnings = page.getByRole('list', { name: '時間提醒' }).first()
    await expect(warnings.getByText('「Fergburger」10:00 到達時已打烊')).toBeVisible()
    await expect(warnings.getByText('「Glenorchy」和「Kingston」的預訂時間重疊')).toBeVisible()
    await expect(page.locator(`[data-stop-id="${ids.Fergburger}"]`)).toHaveAttribute(
      'data-warned',
      'true',
    )
    await expect(page.locator(`[data-stop-id="${ids.Kingston}"]`)).toHaveAttribute(
      'data-warned',
      'true',
    )
    // Tapping a warning brings its stop into focus
    await warnings.getByRole('button', { name: /到達時已打烊/ }).click()
    await expect(
      page.getByRole('button', { name: '編輯「Fergburger」（有時間提醒）' }),
    ).toBeFocused()
    await shot(page, `${label}-b3i-warnings`)

    // e2-t05: override the first leg's time → 「手動」, the day total and the limit warning change
    const total = page.locator(`section[data-day-id="${day1}"] [data-day-total]`)
    const before = (await total.textContent()) ?? ''
    await expect(page.getByText(/每日駕駛上限 3 小時 30 分/).first()).toBeVisible()
    const firstLeg = page.locator(`[data-leg="${ids.Fergburger}>${ids.Glenorchy}"]`)
    await expect(firstLeg.getByText('手動')).toHaveCount(0)
    await firstLeg.click()
    const legPane = desktop
      ? page.getByRole('complementary', { name: '細節' })
      : page.getByRole('dialog', { name: '調整移動段' })
    await expect(legPane.getByLabel('交通方式')).toHaveValue('drive')
    await legPane.getByLabel('移動時間（分鐘）').fill('300')
    await legPane.getByRole('button', { name: '儲存' }).click()
    await expect(firstLeg.getByText('手動')).toBeVisible()
    await expect(firstLeg.getByText('估')).toHaveCount(0)
    await expect(firstLeg).toContainText('5 小時')
    await expect(total).not.toHaveText(before)
    await expect(page.getByText(/超過每日上限/).first()).toBeVisible()
    // A ferry leaves the driving total; survives a reload
    await firstLeg.click()
    await legPane.getByLabel('交通方式').selectOption('ferry')
    await legPane.getByLabel('移動時間（分鐘）').fill('')
    await legPane.getByRole('button', { name: '儲存' }).click()
    await expect(firstLeg).toContainText('渡輪')
    await expect(page.getByText(/超過每日上限/)).toHaveCount(0)
    await page.reload()
    await expect(firstLeg).toContainText('渡輪')
    await expect(firstLeg.getByText('手動')).toBeVisible()
    // Back to automatic
    await firstLeg.click()
    await legPane.getByRole('button', { name: '恢復自動' }).click()
    await expect(firstLeg).toContainText('露營車')
    await expect(firstLeg.getByText('手動')).toHaveCount(0)
    await shot(page, `${label}-b3i-legs`)

    // e2-t04 keyboard: Space picks up, ArrowDown moves, Space drops
    const handle = (name: string) => page.getByRole('button', { name: `拖曳「${name}」排序` })
    await handle('Fergburger').focus()
    await press(page, 'Space')
    await press(page, 'ArrowDown')
    await press(page, 'Space')
    await expect.poll(() => dayNames(page, day1)).toEqual(['Glenorchy', 'Fergburger', 'Kingston'])
    // Esc cancels
    await handle('Kingston').focus()
    await press(page, 'Space')
    await press(page, 'ArrowUp')
    await press(page, 'Escape')
    await expect.poll(() => dayNames(page, day1)).toEqual(['Glenorchy', 'Fergburger', 'Kingston'])

    // e2-t04 mouse: Kingston to the top
    const top = (await page.locator(`[data-stop-id="${ids.Glenorchy}"]`).boundingBox())!
    await mouseDrag(page, handle('Kingston'), { x: top.x + top.width / 2, y: top.y + 4 })
    await page.mouse.up()
    await expect.poll(() => dayNames(page, day1)).toEqual(['Kingston', 'Glenorchy', 'Fergburger'])
    await page.reload()
    await expect.poll(() => dayNames(page, day1)).toEqual(['Kingston', 'Glenorchy', 'Fergburger'])

    // Across days
    const day2 = days[1].id
    await page
      .locator(`[data-stop-id="${ids.Fergburger}"]`)
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    if (desktop) {
      // All days are on screen: drop on Day 2's empty area
      const area = page.locator(`[data-day-drop="${day2}"]`)
      const box = (await area.boundingBox())!
      await mouseDrag(page, handle('Fergburger'), {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      })
      await page.mouse.up()
    } else {
      // One day on screen: hold over the bottom edge zone until Day 2 comes in, then drop
      await mouseDrag(page, handle('Fergburger'), { x: width / 2, y: height - 140 })
      const edge = page.locator('[data-edge="bottom"]')
      await expect(edge).toBeVisible()
      const box = (await edge.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 })
      await expect(page.getByRole('heading', { level: 2, name: /^Day 2/ })).toBeVisible({
        timeout: 3000,
      })
      const area = page.locator(`[data-day-drop="${day2}"]`)
      const target = (await area.boundingBox())!
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 10,
      })
      await page.mouse.up()
    }
    await expect.poll(() => dayNames(page, day2)).toEqual(['Fergburger'])
    await page.reload()
    if (!desktop) await page.getByRole('button', { name: '後一天' }).click()
    await expect.poll(() => dayNames(page, day2)).toEqual(['Fergburger'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await shot(page, `${label}-b3i-moved`)
  })
}

// ---- e2-t07: the rainy-day group and the pocket list (e5-t05: the pick tag and done mark) ----

async function seedPocket(request: APIRequestContext, name: string) {
  const { trip, memberToken } = await createTrip(request, name)
  const headers = { authorization: `Bearer ${memberToken}` }
  const { days } = (await (
    await request.get(`/api/trips/${trip.id}/days`, { headers })
  ).json()) as {
    days: { id: string; idx: number | null }[]
  }
  const day1 = days[0].id
  const place = async (nameLocal: string, lat: number, lng: number, category = 'sight') => {
    const response = await request.post(`/api/trips/${trip.id}/places`, {
      headers,
      data: { nameLocal, lat, lng, category, source: 'manual' },
    })
    expect(response.status()).toBe(201)
    return ((await response.json()) as { place: { id: string } }).place.id
  }
  for (const [title, lat, lng] of [
    ['Queenstown', -45.0312, 168.6626],
    ['Glenorchy', -44.8513, 168.3871],
    ['Kingston', -45.3333, 168.7167],
  ] as const) {
    const placeId = await place(title, lat, lng)
    const response = await request.post(`/api/trips/${trip.id}/stops`, {
      headers,
      data: { dayId: day1, title, placeId },
    })
    expect(response.status()).toBe(201)
  }
  // The pocket list: one pick and one place nothing uses yet
  const pick = await request.post(`/api/trips/${trip.id}/wishlist`, {
    headers,
    data: { category: 'eat', name: 'Fergburger', estMinor: 1800, currency: 'NZD' },
  })
  expect(pick.status()).toBe(201)
  const itemId = ((await pick.json()) as { item: { id: string } }).item.id
  await place('Moke Lake', -45.0, 168.57, 'nature')
  return { trip, memberToken, headers, day1, itemId }
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: rainy-day group and pocket list`, async ({ page, request }) => {
    const desktop = width >= 1200
    await page.setViewportSize({ width, height })
    const s = await seedPocket(request, `Pocket ${label}`)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [s.trip.id, s.memberToken],
    )
    await page.goto(`/trips/${s.trip.id}/itinerary`)
    const section = page.locator(`section[data-day-id="${s.day1}"]`)
    const mainNames = () =>
      section
        .locator('[data-day-drop] [data-stop-id] > button:first-child > span:first-child')
        .allTextContents()
    const group = page.locator(`[data-backup-group="${s.day1}"]`)
    const backupNames = () =>
      group.locator('[data-stop-id] > button:first-child > span:first-child').allTextContents()
    await expect.poll(mainNames).toEqual(['Queenstown', 'Glenorchy', 'Kingston'])
    await expect(group).toHaveCount(0)
    const total = section.locator('[data-day-total]')
    await expect(total).toBeVisible()
    const before = (await total.textContent()) ?? ''

    // 1. Kingston to the rainy-day group through its menu: out of the rail and of the total
    await page.getByRole('button', { name: '「Kingston」的更多動作' }).click()
    await page.getByRole('menuitem', { name: '移到備案' }).click()
    await expect.poll(backupNames).toEqual(['Kingston'])
    await expect.poll(mainNames).toEqual(['Queenstown', 'Glenorchy'])
    await expect(group.getByRole('button', { name: /雨天備案/ })).toContainText('1')
    await expect(total).not.toHaveText(before)
    await shot(page, `${label}-backup`)

    // 2. 「全部換上」: Kingston takes the day, the other two become the backups (no legs left)
    await group.getByRole('button', { name: '全部換上' }).click()
    await expect.poll(mainNames).toEqual(['Kingston'])
    await expect.poll(backupNames).toEqual(['Queenstown', 'Glenorchy'])
    await expect(total).toHaveCount(0)
    await page.reload()
    await expect.poll(mainNames).toEqual(['Kingston'])
    await expect.poll(backupNames).toEqual(['Queenstown', 'Glenorchy'])

    // 3. The pocket list: the pick into Day 1 (dragged on desktop, 「排進」 on phones)
    const scheduleVia = async (name: string) => {
      if (!desktop) {
        await page.getByRole('button', { name: /^口袋名單（\d+）$/ }).click()
        const sheet = page.getByRole('dialog', { name: '口袋名單' })
        await expect(sheet.getByText(name, { exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: `把「${name}」排進某一天` }).click()
      await page
        .getByRole('dialog', { name: `把「${name}」排進哪一天？` })
        .getByRole('button', { name: /^Day 1/ })
        .click()
    }
    const panel = page.locator('[data-pocket-panel]')
    if (desktop) {
      await expect(panel.getByText('Fergburger', { exact: true })).toBeVisible()
      await expect(panel.getByText('Moke Lake', { exact: true })).toBeVisible()
      const target = (await section
        .locator('[data-day-drop] [data-stop-id]')
        .first()
        .boundingBox())!
      await mouseDrag(page, page.getByRole('button', { name: '拖曳「Fergburger」到某一天' }), {
        x: target.x + target.width / 2,
        y: target.y + target.height - 6,
      })
      await page.mouse.up()
    } else {
      await scheduleVia('Fergburger')
    }
    await expect.poll(mainNames).toEqual(['Kingston', 'Fergburger'])
    const ferg = section.locator('[data-stop-id]').filter({ hasText: 'Fergburger' })
    await expect(ferg.getByRole('link', { name: '到必吃必買看「Fergburger」' })).toBeVisible()
    await expect
      .poll(async () => {
        const response = await request.get(`/api/trips/${s.trip.id}/wishlist`, {
          headers: s.headers,
        })
        const { items } = (await response.json()) as { items: { id: string; status: string }[] }
        return items.find((item) => item.id === s.itemId)?.status
      })
      .toBe('scheduled')
    if (desktop) await expect(panel.getByText('Fergburger', { exact: true })).toHaveCount(0)

    // The place: its stop takes the type from the place's category (nature → 景點)
    await scheduleVia('Moke Lake')
    await expect.poll(mainNames).toEqual(['Kingston', 'Fergburger', 'Moke Lake'])
    await expect(section.locator('[data-stop-id]').filter({ hasText: 'Moke Lake' })).toContainText(
      '景點',
    )
    if (desktop) await expect(panel.getByText(/口袋名單是空的/)).toBeVisible()
    await shot(page, `${label}-pocket-scheduled`)

    // 4. The pick done (elsewhere): a check mark on its stop; the tag leads to the pick
    const done = await request.patch(`/api/trips/${s.trip.id}/wishlist/${s.itemId}`, {
      headers: s.headers,
      data: { status: 'done' },
    })
    expect(done.status()).toBe(200)
    await page.reload()
    await expect(ferg).toHaveAttribute('data-pick-done', 'true')
    await ferg.getByRole('link', { name: '到必吃必買看「Fergburger」（已完成）' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${s.trip.id}/picks`))
    const detail = desktop
      ? page.getByRole('complementary', { name: '細節' })
      : page.getByRole('dialog', { name: '必吃必買' })
    await expect(detail.getByRole('heading', { name: 'Fergburger' })).toBeVisible()
    // Not done after all (the picks page's undo): a done pick stays done when its stop goes
    const undone = await request.patch(`/api/trips/${s.trip.id}/wishlist/${s.itemId}`, {
      headers: s.headers,
      data: { status: 'scheduled' },
    })
    expect(undone.status()).toBe(200)
    await page.goto(`/trips/${s.trip.id}/itinerary`)
    await expect(ferg).not.toHaveAttribute('data-pick-done', 'true')

    // 5. Deleting the stop puts the pick back in the pocket list
    await page.getByRole('button', { name: '編輯「Fergburger」' }).click()
    const pane = desktop
      ? page.getByRole('complementary', { name: '細節' })
      : page.getByRole('dialog').filter({ has: page.getByRole('button', { name: '刪除行程點' }) })
    await pane.getByRole('button', { name: '刪除行程點' }).click()
    await page
      .getByRole('dialog', { name: '刪除「Fergburger」？' })
      .getByRole('button', { name: '刪除' })
      .click()
    await expect.poll(mainNames).toEqual(['Kingston', 'Moke Lake'])
    await expect
      .poll(async () => {
        const response = await request.get(`/api/trips/${s.trip.id}/pocket`, {
          headers: s.headers,
        })
        const { items } = (await response.json()) as { items: { id: string }[] }
        return items.map((item) => item.id)
      })
      .toEqual([s.itemId])
    if (desktop) {
      await expect(panel.getByText('Fergburger', { exact: true })).toBeVisible()
    } else {
      await page.getByRole('button', { name: /^口袋名單（\d+）$/ }).click()
      await expect(
        page.getByRole('dialog', { name: '口袋名單' }).getByText('Fergburger', { exact: true }),
      ).toBeVisible()
    }
    // 6. Dragging a stop from the rail into the rainy-day group flips it (desktop: mouse)
    if (desktop) {
      const into = (await group.locator('[data-stop-id]').last().boundingBox())!
      await mouseDrag(page, page.getByRole('button', { name: '拖曳「Moke Lake」排序' }), {
        x: into.x + into.width / 2,
        y: into.y + into.height - 4,
      })
      await page.mouse.up()
      await expect.poll(mainNames).toEqual(['Kingston'])
      await expect.poll(backupNames).toEqual(['Queenstown', 'Glenorchy', 'Moke Lake'])
      await page.reload()
      await expect.poll(backupNames).toEqual(['Queenstown', 'Glenorchy', 'Moke Lake'])
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await shot(page, `${label}-pocket-back`)
  })
}

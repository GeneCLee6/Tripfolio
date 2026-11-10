import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// e3-t05 walk-through against a real Worker and local D1: a trip with three places (two
// near-duplicates, one unused) and two stops → the library lists them with ref counts → 「找出重複」
// → merge one duplicate into the other → the stop now points at the kept place (API) → edit the
// kept place's hours to Monday 09:00–17:00 → the itinerary warns 「打烊」 for the stop arriving at
// 18:00 on that Monday → a used place cannot be deleted, the unused one can. Phone (375) and
// desktop (1440). Run with `npm run dev` and `wrangler d1 migrations apply tripfolio --local`, or
// BASE_URL.

test.use({ locale: 'zh-TW', timezoneId: 'Pacific/Auckland' })

const SHOTS = process.env.SHOTS_DIR
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const TZ = 'Pacific/Auckland'

/** The first Monday at least 30 days from now (YYYY-MM-DD) */
function nextMonday(): string {
  const d = new Date(Date.now() + 30 * 86_400_000)
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Local wall clock in Auckland on `date` → UTC ISO */
function atLocal(date: string, hm: string): string {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, m] = hm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, m)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return new Date(guess - (shown - guess)).toISOString().replace('.000Z', 'Z')
}

async function seed(request: APIRequestContext, name: string) {
  const monday = nextMonday()
  const end = new Date(Date.parse(`${monday}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10)
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Queenstown',
      startDate: monday,
      endDate: end,
      tz: TZ,
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
  const place = async (data: Record<string, unknown>) => {
    const response = await request.post(`/api/trips/${trip.id}/places`, { headers, data })
    expect(response.status()).toBe(201)
    return ((await response.json()) as { place: { id: string } }).place.id
  }
  // Kept: from search (has an externalId); duplicate: same name 30 m north; unused: far away
  const kept = await place({
    nameLocal: 'Fergburger',
    lat: -45.0318,
    lng: 168.6598,
    category: 'food',
    source: 'photon',
    address: '42 Shotover Street',
    externalId: 'osm:N900001',
  })
  const dupe = await place({
    nameLocal: 'Fergburger',
    lat: -45.03153,
    lng: 168.6598,
    category: 'food',
    source: 'manual',
  })
  const unused = await place({ nameLocal: 'Lonely Hut', lat: -44.5, lng: 168.2, category: 'other' })
  const daysResponse = await request.get(`/api/trips/${trip.id}/days`, { headers })
  const { days } = (await daysResponse.json()) as { days: { id: string; date: string }[] }
  const day1 = days.find((d) => d.date === monday)!
  const stop = async (title: string, placeId: string, start: string, finish: string) => {
    const response = await request.post(`/api/trips/${trip.id}/stops`, {
      headers,
      data: {
        dayId: day1.id,
        title,
        placeId,
        startAt: atLocal(monday, start),
        endAt: atLocal(monday, finish),
      },
    })
    expect(response.status()).toBe(201)
    return ((await response.json()) as { stop: { id: string } }).stop.id
  }
  const lunch = await stop('Burger lunch', kept, '12:00', '13:00')
  const dinner = await stop('Burger dinner', dupe, '18:00', '19:00')
  return { trip, memberToken, headers, kept, dupe, unused, lunch, dinner, day1 }
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: list, merge duplicates, edit hours, delete`, async ({ page, request }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height })
    const s = await seed(request, `地點庫 ${label}`)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [s.trip.id, s.memberToken],
    )

    // The settings page links here
    await page.goto(`/trips/${s.trip.id}/settings`)
    await page.getByRole('button', { name: '地點庫' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${s.trip.id}/places$`))
    await expect(page.getByRole('heading', { level: 1, name: '地點庫' })).toBeVisible()

    const row = (id: string) => page.locator(`[data-testid="place-list"] [data-place-id="${id}"]`)
    await expect(page.locator('[data-testid="place-list"] > li')).toHaveCount(3)
    await expect(row(s.kept)).toContainText('被 1 個項目引用')
    await expect(row(s.kept)).toContainText('42 Shotover Street')
    await expect(row(s.kept)).toContainText('Photon')
    await expect(row(s.dupe)).toContainText('被 1 個項目引用')
    await expect(row(s.unused)).toContainText('未使用')
    await expect(row(s.unused)).toContainText('-44.50000, 168.20000')

    // Search and sort
    await page.getByLabel('搜尋地點').fill('lonely')
    await expect(page.locator('[data-testid="place-list"] > li')).toHaveCount(1)
    await page.getByLabel('搜尋地點').fill('')
    await page.getByLabel('排序').selectOption('unused')
    await expect(page.locator('[data-testid="place-list"] > li').first()).toHaveAttribute(
      'data-place-id',
      s.unused,
    )
    await shot(page, `${label}-places-list`)

    // Find duplicates → one group, the place with a search id is suggested to keep
    await page.getByRole('button', { name: '找出重複' }).click()
    const sheet = page.getByRole('dialog', { name: '可能重複的地點' })
    await expect(sheet.getByTestId('dupe-group')).toHaveCount(1)
    const group = sheet.getByTestId('dupe-group')
    await expect(group.locator(`[data-place-id="${s.kept}"]`)).toContainText('建議保留')
    await expect(group).toContainText('同名且很近')
    await shot(page, `${label}-places-dupes`)
    await group
      .locator(`[data-place-id="${s.dupe}"]`)
      .getByRole('button', { name: '把「Fergburger」合併到…' })
      .click()

    const confirm = page.getByRole('dialog', { name: '把「Fergburger」合併到哪裡？' })
    await expect(confirm.getByTestId('ref-list')).toContainText('行程點：Burger dinner')
    await expect(confirm.getByLabel('保留的地點')).toHaveValue(s.kept)
    await shot(page, `${label}-places-merge-confirm`)
    await confirm.getByRole('button', { name: '合併', exact: true }).click()
    await expect(sheet.getByTestId('merge-result')).toContainText('改指 1 個行程點')
    await expect(sheet.getByText('沒有找到重複的地點。')).toBeVisible()
    await shot(page, `${label}-places-merged`)
    await sheet.getByRole('button', { name: '關閉' }).click()

    // The stop now points at the kept place
    const days = (await (
      await request.get(`/api/trips/${s.trip.id}/days`, { headers: s.headers })
    ).json()) as { days: { stops: { id: string; placeId: string | null }[] }[] }
    const stops = days.days.flatMap((d) => d.stops)
    expect(stops.find((x) => x.id === s.dinner)?.placeId).toBe(s.kept)
    await expect(page.locator('[data-testid="place-list"] > li')).toHaveCount(2)
    await expect(row(s.kept)).toContainText('被 2 個項目引用')

    // Edit hours: Monday 09:00–17:00
    await row(s.kept).getByRole('button', { name: '「Fergburger」的更多動作' }).click()
    await row(s.kept).getByRole('menuitem', { name: '編輯' }).click()
    const editor = page.getByRole('dialog', { name: '編輯「Fergburger」' })
    await editor.getByRole('button', { name: '週一 加一個時段' }).click()
    await expect(editor.getByLabel('週一 開門')).toHaveValue('09:00')
    await expect(editor.getByLabel('週一 打烊')).toHaveValue('17:00')
    await shot(page, `${label}-places-hours`)
    await editor.getByRole('button', { name: '儲存' }).click()
    await expect(editor).toBeHidden()
    await expect(page.getByText('已儲存「Fergburger」')).toBeVisible()
    const placesNow = (await (
      await request.get(`/api/trips/${s.trip.id}/places`, { headers: s.headers })
    ).json()) as { places: { id: string; hours: unknown }[] }
    expect(placesNow.places.find((p) => p.id === s.kept)?.hours).toEqual({
      periods: [{ day: 1, open: '09:00', close: '17:00' }],
    })

    // A used place cannot be deleted
    await row(s.kept).getByRole('button', { name: '「Fergburger」的更多動作' }).click()
    await row(s.kept).getByRole('menuitem', { name: '刪除' }).click()
    const refused = page.getByRole('dialog', { name: '「Fergburger」還在使用中' })
    await expect(refused.getByTestId('ref-list')).toContainText('行程點：Burger lunch')
    await expect(refused.getByRole('button', { name: '刪除' })).toHaveCount(0)
    await refused.getByRole('button', { name: '知道了' }).click()

    // The unused one can
    await row(s.unused).getByRole('button', { name: '「Lonely Hut」的更多動作' }).click()
    await row(s.unused).getByRole('menuitem', { name: '刪除' }).click()
    const del = page.getByRole('dialog', { name: '刪除「Lonely Hut」？' })
    await del.getByRole('button', { name: '刪除' }).click()
    await expect(page.getByText('已刪除「Lonely Hut」')).toBeVisible()
    await expect(page.locator('[data-testid="place-list"] > li')).toHaveCount(1)
    const left = (await (
      await request.get(`/api/trips/${s.trip.id}/places`, { headers: s.headers })
    ).json()) as { places: { id: string }[] }
    expect(left.places.map((p) => p.id)).toEqual([s.kept])
    await shot(page, `${label}-places-after-delete`)

    // The itinerary now warns: closed at 18:00 on Monday; lunch at 12:00 is fine
    await page.goto(`/trips/${s.trip.id}/itinerary`)
    const warnings = page.getByRole('list', { name: '時間提醒' }).first()
    await expect(warnings.getByText(/18:00 到達時已打烊/)).toBeVisible()
    await expect(warnings.getByText(/12:00 到達時已打烊/)).toHaveCount(0)
    await shot(page, `${label}-places-itinerary-closed`)
  })
}

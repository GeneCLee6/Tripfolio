import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// The trip home's phase card (e9-t06, AC-9.5) and the statistics page's budget card (AC-9.1):
// a trip three days out shows the countdown, the 出發前 card with the pre-trip progress and the four
// prep links; a trip running today (dates around today in its own zone) shows the 今日卡 with
// today's stops in order and times, tonight's lodging, the drive total and the to-do due today,
// and its 記一筆 opens the expense sheet; the stats page shows planned vs actual once a budget is
// set through the API — at phone and desktop widths. Needs `npm run dev` with local D1 migrated, or
// BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const TZ = 'Pacific/Auckland'

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

/** Today's date in the trip's zone, shifted by `days` */
function tripDate(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** `HH:mm` on `date` in Auckland as UTC (finds the offset with Intl, so NZST and NZDT both work) */
function nzInstant(date: string, hm: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [h, min] = hm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, min)
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

interface Seeded {
  tripId: string
  memberId: string
  token: string
  headers: { authorization: string }
}

async function seed(
  request: APIRequestContext,
  name: string,
  startDate: string,
  endDate: string,
): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate,
      endDate,
      tz: TZ,
      baseCurrency: 'AUD',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const body = (await created.json()) as {
    trip: { id: string; ownerMemberId: string }
    memberToken: string
  }
  return {
    tripId: body.trip.id,
    memberId: body.trip.ownerMemberId,
    token: body.memberToken,
    headers: { authorization: `Bearer ${body.memberToken}` },
  }
}

async function login(page: Page, s: Seeded) {
  await page.addInitScript(
    ([id, value]) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [s.tripId, s.token],
  )
}

async function ok(response: Promise<{ status: () => number; json: () => Promise<unknown> }>) {
  const r = await response
  expect(r.status(), await r.json().then((b) => JSON.stringify(b))).toBeLessThan(300)
  return r.json()
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: three days out shows the countdown, 出發前 and the prep links`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height })
    const s = await seed(request, `Soon ${label}`, tripDate(3), tripDate(7))
    const api = (path: string) => `/api/trips/${s.tripId}${path}`
    const list = (await ok(
      request.post(api('/checklists'), {
        headers: s.headers,
        data: { kind: 'pretrip', title: '行前' },
      }),
    )) as { checklist: { id: string } }
    for (const [text, done] of [
      ['確認 NZeTA', true],
      ['確認保險', false],
      ['確認國際駕照', false],
    ] as const)
      await ok(
        request.post(api(`/checklists/${list.checklist.id}/items`), {
          headers: s.headers,
          data: { text, done },
        }),
      )
    await login(page, s)
    await page.goto(`/trips/${s.tripId}`)

    const card = page.locator('[data-phase-card="before"]')
    await expect(card.getByRole('heading', { name: '出發前' })).toBeVisible()
    await expect(card.getByText('還有 3 天')).toBeVisible()
    await expect(card.getByText('行前清單完成 1／3')).toBeVisible()
    for (const path of ['checklists', 'budget', 'documents', 'notes'])
      await expect(card.locator(`[data-prep-link="${path}"]`)).toBeVisible()
    await expect(page.locator('[data-phase-card="today"]')).toHaveCount(0)
    await expect(page.locator('main').getByText('已結束')).toHaveCount(0)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, `home-before-${label}`)

    await card.locator('[data-prep-link="checklists"]').click()
    await expect(page).toHaveURL(new RegExp(`/trips/${s.tripId}/checklists$`))
  })

  test(`${label}: an ongoing trip shows the today card`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    const today = tripDate(0)
    const s = await seed(request, `Now ${label}`, tripDate(-1), tripDate(2))
    const api = (path: string) => `/api/trips/${s.tripId}${path}`
    const { days } = (await ok(request.get(api('/days'), { headers: s.headers }))) as {
      days: { id: string; date: string; idx: number | null }[]
    }
    const day = days.find((d) => d.idx !== null && d.date === today)!
    const yesterday = days.find((d) => d.idx === 1)!
    await ok(request.patch(api(`/days/${day.id}`), { headers: s.headers, data: { title: '峽灣日' } }))

    const place = async (nameLocal: string, lat: number, lng: number) =>
      ((await ok(
        request.post(api('/places'), {
          headers: s.headers,
          data: { nameLocal, lat, lng, category: 'sight', source: 'manual' },
        }),
      )) as { place: { id: string } }).place.id
    const te = await place('Te Anau', -45.4145, 167.7181)
    const milford = await place('Milford Sound', -44.6414, 167.8974)
    for (const [title, placeId, hm, type] of [
      ['Te Anau breakfast', te, '08:15', 'food'],
      ['Milford Sound cruise', milford, '11:30', 'sight'],
    ] as const)
      await ok(
        request.post(api('/stops'), {
          headers: s.headers,
          data: { dayId: day.id, title, placeId, type, startAt: nzInstant(today, hm) },
        }),
      )
    // A stop on another day must not show
    await ok(
      request.post(api('/stops'), {
        headers: s.headers,
        data: { dayId: yesterday.id, title: 'Queenstown gondola' },
      }),
    )
    await ok(
      request.post(api('/lodgings'), {
        headers: s.headers,
        data: { name: 'Milford Lodge', checkIn: today, checkOut: tripDate(1) },
      }),
    )
    const list = (await ok(
      request.post(api('/checklists'), {
        headers: s.headers,
        data: { kind: 'pretrip', title: '行前' },
      }),
    )) as { checklist: { id: string } }
    for (const [text, dueAt] of [
      ['確認渡輪船票', today],
      ['確認明天的露營地', tripDate(1)],
    ] as const)
      await ok(
        request.post(api(`/checklists/${list.checklist.id}/items`), {
          headers: s.headers,
          data: { text, dueAt },
        }),
      )

    await login(page, s)
    await page.goto(`/trips/${s.tripId}`)
    const card = page.locator('[data-phase-card="today"]')
    await expect(card.getByRole('heading', { name: '今天 · 第 2 天 · 峽灣日' })).toBeVisible()
    await expect(page.locator('[data-countdown="ongoing"]')).toHaveText('第 2 天／共 4 天')
    const stops = card.locator('[data-today-stops] li')
    await expect(stops).toHaveCount(2)
    await expect(stops.nth(0)).toContainText('08:15')
    await expect(stops.nth(0)).toContainText('Te Anau breakfast')
    await expect(stops.nth(1)).toContainText('11:30')
    await expect(stops.nth(1)).toContainText('Milford Sound cruise')
    await expect(card.getByText('Queenstown gondola')).toHaveCount(0)
    await expect(card.locator('[data-lodging-line="tonight"]')).toContainText('Milford Lodge')
    await expect(card.locator('[data-today-drive]')).toContainText('開車約')
    const todos = card.locator('[data-today-todos]')
    await expect(todos).toContainText('確認渡輪船票')
    await expect(todos).not.toContainText('確認明天的露營地')
    const weather = card.locator('[data-today-weather]')
    await expect(weather).toHaveAttribute('href', /^https:\/\/www\.windy\.com\/\?-45\.41/)
    await expect(weather).toHaveAttribute('target', '_blank')
    await expect(page.locator('[data-phase-card="before"]')).toHaveCount(0)
    // The prep links stay on the home during the trip (documents, notes)
    await expect(page.locator('[data-prep-link="documents"]')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, `home-today-${label}`)

    await card.getByRole('button', { name: '記一筆' }).click()
    await expect(page.getByRole('dialog', { name: '記一筆' })).toBeVisible()
  })

  test(`${label}: the stats page shows the budget card once a budget is set`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height })
    const s = await seed(request, `Budget ${label}`, tripDate(-1), tripDate(3))
    const api = (path: string) => `/api/trips/${s.tripId}${path}`
    await login(page, s)
    await page.goto(`/trips/${s.tripId}/expenses/stats`)
    await expect(page.locator('[data-budget-card="none"]')).toContainText('尚未設定預算')

    await ok(
      request.put(api('/budget'), {
        headers: s.headers,
        data: {
          rows: [
            { category: 'lodging', plannedMinor: 100000, perPerson: false },
            { category: 'food', plannedMinor: 50000, perPerson: false },
            { category: 'flights', plannedMinor: 200000, perPerson: false },
          ],
        },
      }),
    )
    for (const [amountMinor, category] of [
      [120000, 'lodging'],
      [10000, 'food'],
    ] as const)
      await ok(
        request.post(api('/expenses'), {
          headers: s.headers,
          data: {
            amountMinor,
            currency: 'AUD',
            category,
            date: tripDate(0),
            payerMemberId: s.memberId,
            splitMethod: 'equal',
            participants: [{ memberId: s.memberId }],
          },
        }),
      )
    await page.reload()
    const card = page.locator('[data-budget-card="set"]')
    await expect(card.locator('[data-budget-planned]')).toHaveAttribute(
      'data-budget-planned',
      '350000',
    )
    await expect(card.locator('[data-budget-actual]')).toHaveAttribute('data-budget-actual', '130000')
    await expect(card.getByRole('meter', { name: '已用預算' })).toBeVisible()
    const gaps = card.locator('[data-budget-gaps] li')
    await expect(gaps).toHaveCount(2)
    await expect(gaps.nth(0)).toHaveAttribute('data-category', 'food')
    await expect(gaps.nth(0)).toContainText('剩')
    await expect(gaps.nth(1)).toHaveAttribute('data-category', 'lodging')
    await expect(gaps.nth(1)).toContainText('超支')
    await expect(card.getByText('機票、保險通常行前付清')).toBeVisible()
    await shot(page, `stats-budget-${label}`)
    await card.getByRole('link', { name: '看預算' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${s.tripId}/budget$`))
  })
}

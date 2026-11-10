import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

// E4 walk-through (e4-t02, e4-t03, e4-t05): a campervan trip; from Day 1's 「還沒安排住宿」 add a
// two-night holiday park with power → Days 1–2 say 今晚住, Day 3 says 退房; on the bookings page add
// an overnight TPE→AKL flight (each end in its own zone) → transport stops on Days 1 and 2; a
// two-day driver → two stops; the trip home lists the lodging's cancel-by; deleting the flight
// while keeping its stops leaves them in the itinerary — at phone and desktop widths. Run against
// `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'zh-TW', timezoneId: 'Asia/Taipei' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const START = 10

async function createTrip(request: APIRequestContext, name: string) {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(START),
      endDate: inDays(START + 3),
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { trip: { id: string }; memberToken: string }
}

/** Day n's block; phones show one day at a time, so pick it in the chip strip first */
async function dayBlock(page: Page, n: number, desktop: boolean): Promise<Locator> {
  if (!desktop) {
    await page.getByRole('navigation', { name: '選擇日期' }).getByRole('button').nth(n - 1).click()
  }
  return page
    .locator('section[data-day-id]')
    .filter({ has: page.getByRole('heading', { level: 2, name: new RegExp(`^Day ${n}( |$)`) }) })
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: lodging line, flight and driver bookings, deadlines`, async ({ page, request }) => {
    const desktop = width >= 1200
    await page.setViewportSize({ width, height })
    const { trip, memberToken } = await createTrip(request, `Bookings ${label}`)
    const auth = { authorization: `Bearer ${memberToken}` }
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, memberToken],
    )
    await page.goto(`/trips/${trip.id}/itinerary`)

    // 1. Day 1 has no lodging yet: tap the line and add a 2-night holiday park with power
    let day1 = await dayBlock(page, 1, desktop)
    await expect(day1.getByText('今晚住：—')).toBeVisible()
    await day1.getByRole('button', { name: /還沒安排住宿/ }).click()
    let sheet = page.getByRole('dialog', { name: '新增住宿' })
    await expect(sheet.getByLabel('入住日')).toHaveValue(inDays(START))
    await sheet.getByLabel('住宿名稱').fill('Punakaiki Holiday Park')
    await sheet.getByLabel('退房日').fill(inDays(START + 2))
    await sheet.getByLabel('入住時間').fill('14:00')
    await sheet.getByLabel('退房時間').fill('10:00')
    await sheet.getByLabel('營地類型').selectOption('holiday-park')
    await sheet.getByLabel('有電').check()
    await sheet.getByLabel('取消期限（日期）').fill(inDays(3))
    await sheet.getByLabel('取消期限（時間）').fill('18:00')
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByText('已儲存住宿「Punakaiki Holiday Park」')).toBeVisible()
    await expect(sheet).toBeHidden()

    day1 = await dayBlock(page, 1, desktop)
    const line1 = day1.locator('[data-lodging-line="tonight"]')
    await expect(line1).toContainText('今晚住：Punakaiki Holiday Park')
    await expect(line1).toContainText('入住 14:00 起')
    await expect(line1).toContainText('假日公園')
    await expect(line1).toContainText('有電')
    await shot(page, `${label}-day1-lodging`)
    const day2 = await dayBlock(page, 2, desktop)
    await expect(day2.locator('[data-lodging-line="tonight"]')).toContainText('今晚住：Punakaiki Holiday Park')
    await expect(day2.locator('[data-lodging-line="tonight"]')).toContainText('第 2／2 晚')
    const day3 = await dayBlock(page, 3, desktop)
    await expect(day3.locator('[data-lodging-line="checkout"]')).toContainText('退房 10:00')
    await expect(day3.getByText('今晚住：—')).toBeVisible()

    // 2. The bookings page: an overnight flight TPE → AKL, each time in its own airport's zone
    await page.goto(`/trips/${trip.id}/bookings`)
    await expect(page.getByRole('heading', { level: 1, name: '預訂總覽' })).toBeVisible()
    await expect(page.locator('[data-booking-row]').filter({ hasText: 'Punakaiki Holiday Park' })).toContainText('未付')
    await page.getByRole('button', { name: '＋ 新增預訂' }).click()
    sheet = page.getByRole('dialog', { name: '新增預訂' })
    await expect(sheet.getByRole('radio', { name: '航班' })).toHaveAttribute('aria-checked', 'true')
    await sheet.getByLabel('航空公司').fill('China Airlines')
    await sheet.getByLabel('班號').fill('CI 53')
    await sheet.getByLabel('出發機場').fill('TPE')
    await sheet.getByLabel('抵達機場').fill('AKL')
    await sheet.getByLabel('出發日期').fill(inDays(START))
    await sheet.getByLabel('出發時間（當地）').fill('13:00')
    await sheet.getByLabel('出發地時區').selectOption('Asia/Taipei')
    await sheet.getByLabel('抵達日期').fill(inDays(START + 1))
    await sheet.getByLabel('抵達時間（當地）').fill('05:00')
    await sheet.getByLabel('抵達地時區').selectOption('Pacific/Auckland')
    await expect(sheet.getByText('抵達是出發的 1 天後')).toBeVisible()
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByText('已儲存「CI 53 TPE→AKL」')).toBeVisible()
    await expect(page.getByText('日程裡的行程點：出發和抵達')).toBeVisible()
    const flightRow = page.locator('[data-booking-row]').filter({ hasText: 'CI 53 TPE→AKL' })
    await expect(flightRow.locator('[data-booking-times]')).toContainText('13:00 GMT+8')
    await expect(flightRow.locator('[data-booking-times]')).toContainText('05:00 (+1 天) GMT+13')
    await expect(flightRow).toContainText('自動行程點：出發和抵達')

    // The stored instants: 13:00 in Taipei and 05:00 the next morning in Auckland
    const listed = await request.get(`/api/trips/${trip.id}/bookings`, { headers: auth })
    const flight = ((await listed.json()) as { bookings: { title: string; startAt: string; endAt: string; startTz: string; endTz: string }[] }).bookings.find((b) => b.title === 'CI 53 TPE→AKL')!
    expect(flight).toMatchObject({ startTz: 'Asia/Taipei', endTz: 'Pacific/Auckland' })
    expect(flight.startAt).toBe(`${inDays(START)}T05:00:00Z`)
    expect(Date.parse(flight.endAt) - Date.parse(flight.startAt)).toBe(11 * 3_600_000)

    // 3. A driver for two days → two stops
    await page.getByRole('button', { name: '＋ 新增預訂' }).click()
    sheet = page.getByRole('dialog', { name: '新增預訂' })
    await sheet.getByRole('radio', { name: '包車' }).click()
    await sheet.getByLabel('司機姓名').fill('Mr Kim')
    await sheet.getByLabel('包車第一天').fill(inDays(START + 2))
    await sheet.getByLabel('包車最後一天').fill(inDays(START + 3))
    await sheet.getByLabel('每日接送時間').fill('08:30')
    await sheet.getByLabel('油資').check()
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(page.getByText('已儲存「Mr Kim」')).toBeVisible()
    const driverRow = page.locator('[data-booking-row]').filter({ hasText: 'Mr Kim' })
    await expect(driverRow).toContainText('自動行程點：')
    const bookings = (await (await request.get(`/api/trips/${trip.id}/bookings`, { headers: auth })).json()) as {
      bookings: { title: string; stops: unknown[] }[]
    }
    expect(bookings.bookings.find((b) => b.title === 'Mr Kim')!.stops).toHaveLength(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await shot(page, `${label}-bookings`)

    // 4. The itinerary has the flight on Days 1 and 2 and the driver on Days 3 and 4
    await page.goto(`/trips/${trip.id}/itinerary`)
    for (const [n, title] of [
      [1, 'CI 53 TPE→AKL'],
      [2, 'CI 53 TPE→AKL'],
      [3, 'Mr Kim'],
      [4, 'Mr Kim'],
    ] as const) {
      const block = await dayBlock(page, n, desktop)
      await expect(block.locator('[data-stop-id]').filter({ hasText: title })).toHaveCount(1)
    }

    // 5. The trip home lists the lodging's cancel-by among the deadlines
    await page.goto(`/trips/${trip.id}`)
    const deadlines = page.getByRole('list', { name: '即將到期' })
    const cancel = deadlines.locator('[data-deadline="cancel"]').filter({ hasText: 'Punakaiki Holiday Park' })
    await expect(cancel).toContainText('取消期限')
    await expect(cancel).toContainText(/\d+ 天後/)
    await shot(page, `${label}-home`)
    await cancel.click()
    await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}/bookings$`))

    // 6. Delete the flight but keep its stops
    await page.getByRole('button', { name: '刪除「CI 53 TPE→AKL」' }).click()
    const dialog = page.getByRole('dialog', { name: '刪除「CI 53 TPE→AKL」？' })
    await expect(dialog).toContainText('保留自動建立的行程點？')
    await dialog.getByRole('button', { name: '保留行程點' }).click()
    await expect(page.getByText('已刪除「CI 53 TPE→AKL」')).toBeVisible()
    await expect(page.locator('[data-booking-row]').filter({ hasText: 'CI 53' })).toHaveCount(0)
    await page.goto(`/trips/${trip.id}/itinerary`)
    for (const n of [1, 2]) {
      const block = await dayBlock(page, n, desktop)
      await expect(block.locator('[data-stop-id]').filter({ hasText: 'CI 53 TPE→AKL' })).toHaveCount(1)
    }
  })
}

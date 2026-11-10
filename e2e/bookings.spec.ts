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

// A minimal one-page PDF, so the upload needs no fixture file
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

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

// e4-t06, e4-t04, AC-4.2: 誰先付 → 記帳 on a rental (Mei paid) and a lodging (the pool paid) →
// expenses linked by bookingId and 「已記帳」 badges; editing the rental's dates moves its stops; a
// confirmation PDF on the lodging is listed, opens in a new tab, and is absent from the share
// payload — at phone and desktop widths.
for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: who paid → expense, rental dates move stops, lodging attachment`, async ({
    page,
    request,
    context,
  }) => {
    await page.setViewportSize({ width, height })
    const created = await request.post('/api/trips', {
      data: {
        name: `Booking money ${label}`,
        destination: 'New Zealand',
        startDate: inDays(START),
        endDate: inDays(START + 3),
        tz: 'Pacific/Auckland',
        localCurrencies: ['NZD'],
        style: 'campervan',
        owner: { name: 'Gene', color: '#0F6E74' },
      },
    })
    expect(created.status()).toBe(201)
    const { trip, memberToken, days } = (await created.json()) as {
      trip: { id: string }
      memberToken: string
      days: { id: string; idx: number | null }[]
    }
    const dayId = (n: number) => days.find((day) => day.idx === n)!.id
    const headers = { authorization: `Bearer ${memberToken}` }
    const api = (path: string) => `/api/trips/${trip.id}${path}`
    const mei = await request.post(api('/members'), {
      headers,
      data: { name: 'Mei', color: '#B5654A' },
    })
    const meiId = ((await mei.json()) as { member: { id: string } }).member.id
    const fx = await request.put(api('/fx/overrides'), { headers, data: { NZD: 0.91 } })
    expect(fx.ok()).toBe(true)
    const rentalRes = await request.post(api('/bookings'), {
      headers,
      data: {
        type: 'rental',
        title: 'Jucy Condo',
        details: { company: 'Jucy', vehicle: 'Condo' },
        startLocal: `${inDays(START)}T10:00`,
        endLocal: `${inDays(START + 2)}T16:00`,
        priceMinor: 60000,
        currency: 'NZD',
        payerMemberId: meiId,
      },
    })
    expect(rentalRes.status()).toBe(201)
    const rental = ((await rentalRes.json()) as { booking: { id: string } }).booking
    const lodgingRes = await request.post(api('/lodgings'), {
      headers,
      data: {
        name: 'Lake Tekapo Motels',
        checkIn: inDays(START),
        checkOut: inDays(START + 2),
        priceMinor: 32000,
        currency: 'NZD',
      },
    })
    expect(lodgingRes.status()).toBe(201)
    const lodging = ((await lodgingRes.json()) as { lodging: { id: string } }).lodging
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, memberToken],
    )
    await page.goto(`/trips/${trip.id}/bookings`)
    const rentalRow = page.locator(`[data-booking-row="${rental.id}"]`)
    const lodgingRow = page.locator(`[data-booking-row="${lodging.id}"]`)
    await expect(rentalRow).toContainText('Mei 先付')
    await expect(rentalRow.locator('[data-expense-logged]')).toHaveCount(0)
    const expenseSheet = page.getByRole('dialog', { name: '記一筆' })

    // 1. The rental: Mei is preselected (the booking's payer) → the sheet is prefilled → save
    await rentalRow.getByRole('button', { name: '「Jucy Condo」誰先付 → 記帳' }).click()
    let who = page.getByRole('dialog', { name: '「Jucy Condo」誰先付？' })
    await expect(who.getByRole('radio', { name: 'Mei' })).toHaveAttribute('aria-checked', 'true')
    await who.getByRole('button', { name: '下一步：記一筆' }).click()
    await expect(expenseSheet).toBeVisible()
    await expect(expenseSheet.getByLabel('金額')).toHaveValue('600.00')
    await expect(expenseSheet.getByLabel('幣別')).toHaveValue('NZD')
    await expect(expenseSheet.getByLabel('說明')).toHaveValue('Jucy Condo')
    await expect(expenseSheet.getByRole('radio', { name: '交通' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await shot(page, `${label}-booking-expense`)
    await expenseSheet.getByRole('button', { name: '儲存' }).click()
    await expect(expenseSheet).toBeHidden()
    await expect(rentalRow.locator('[data-expense-logged]')).toContainText('已記帳')

    // 2. The lodging: the pool paid
    await lodgingRow.getByRole('button', { name: '「Lake Tekapo Motels」誰先付 → 記帳' }).click()
    who = page.getByRole('dialog', { name: '「Lake Tekapo Motels」誰先付？' })
    await expect(who.getByRole('radio', { name: 'Gene' })).toHaveAttribute('aria-checked', 'true')
    await who.getByRole('radio', { name: '公基金' }).click()
    await who.getByRole('button', { name: '下一步：記一筆' }).click()
    await expect(expenseSheet.getByLabel('金額')).toHaveValue('320.00')
    await expect(expenseSheet.getByRole('radio', { name: '住宿' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expenseSheet.getByRole('button', { name: '儲存' }).click()
    await expect(expenseSheet).toBeHidden()
    await expect(lodgingRow.locator('[data-expense-logged]')).toContainText('已記帳')

    const { expenses } = (await (await request.get(api('/expenses'), { headers })).json()) as {
      expenses: {
        bookingId: string | null
        amountMinor: number
        category: string
        pool: boolean
        payerMemberId: string | null
        date: string
      }[]
    }
    expect(expenses.find((e) => e.bookingId === rental.id)).toMatchObject({
      amountMinor: 60000,
      category: 'transport',
      pool: false,
      payerMemberId: meiId,
      date: inDays(START),
    })
    expect(expenses.find((e) => e.bookingId === lodging.id)).toMatchObject({
      amountMinor: 32000,
      category: 'lodging',
      pool: true,
    })
    // The badge comes from the server too, after a reload
    await page.reload()
    await expect(rentalRow.locator('[data-expense-logged]')).toContainText('已記帳')
    await expect(lodgingRow.locator('[data-expense-logged]')).toContainText('已記帳')
    await shot(page, `${label}-bookings-logged`)

    // 3. AC-4.2: edit the rental's dates one day later → its pickup and drop-off stops move
    const stopDays = async () => {
      const res = await request.get(api('/bookings'), { headers })
      const body = (await res.json()) as {
        bookings: { id: string; stops: { slot: string; dayId: string }[] }[]
      }
      const found = body.bookings.find((b) => b.id === rental.id)!
      return Object.fromEntries(found.stops.map((stop) => [stop.slot, stop.dayId]))
    }
    expect(await stopDays()).toEqual({ pickup: dayId(1), dropoff: dayId(3) })
    await page.getByRole('button', { name: '編輯「Jucy Condo」' }).click()
    let sheet = page.getByRole('dialog', { name: '編輯預訂' })
    await sheet.getByLabel('取車日期').fill(inDays(START + 1))
    await sheet.getByLabel('還車日期').fill(inDays(START + 3))
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet).toBeHidden()
    await expect.poll(stopDays).toEqual({ pickup: dayId(2), dropoff: dayId(4) })

    // 4. e4-t04: a confirmation PDF on the lodging
    await page.getByRole('button', { name: '編輯「Lake Tekapo Motels」' }).click()
    sheet = page.getByRole('dialog', { name: '編輯住宿' })
    const section = sheet.locator('[data-booking-attachments]')
    await expect(section).toContainText('不會出現在分享頁')
    await expect(section).toContainText('還沒有附件。')
    await section.locator('input[type="file"]').setInputFiles({
      name: 'confirmation.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    })
    const rows = section.locator('[data-attachment-id]')
    await expect(rows).toHaveCount(1, { timeout: 15_000 })
    await expect(rows.first()).toContainText('PDF 文件 1')
    await expect(rows.first()).toContainText(/PDF · \d+/)
    if (SHOTS) await section.screenshot({ path: `${SHOTS}/${label}-lodging-attachment.png` })
    const attachmentId = (await rows.first().getAttribute('data-attachment-id'))!
    // It opens in a new tab from an object URL; headless Chromium has no PDF viewer, so the tab
    // turns the blob into a download instead of showing it
    const opened = new Promise<string>((resolve) => {
      context.once('page', (tab) => {
        tab.once('download', (download) => resolve(download.url()))
        tab.on('framenavigated', (frame) => {
          if (frame.url().startsWith('blob:')) resolve(frame.url())
        })
      })
    })
    await rows.first().getByRole('button', { name: '開啟「PDF 文件 1」' }).click()
    expect(await opened).toMatch(/^blob:http/)
    for (const other of context.pages()) if (other !== page) await other.close()
    const listed = await request.get(api(`/attachments?lodgingId=${lodging.id}`), { headers })
    const { attachments } = (await listed.json()) as {
      attachments: { id: string; kind: string; visibility: string }[]
    }
    expect(attachments).toEqual([
      expect.objectContaining({ id: attachmentId, kind: 'document', visibility: 'members-only' }),
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )

    // Never on the share page: the public payload does not carry it, nor can the token read it
    const share = await request.post(api('/shares'), { headers, data: {} })
    expect(share.status()).toBe(201)
    const { shareToken } = (await share.json()) as { shareToken: string }
    const payload = await request.get(`/api/share/${shareToken}`)
    expect(payload.status()).toBe(200)
    const text = JSON.stringify(await payload.json())
    expect(text).toContain('Lake Tekapo Motels')
    expect(text).not.toContain(attachmentId)
    expect((await request.get(`/api/media/${attachmentId}?s=${shareToken}`)).status()).not.toBe(
      200,
    )

    // Deleting it from the list
    await rows.first().getByRole('button', { name: '刪除「PDF 文件 1」' }).click()
    await expect(rows).toHaveCount(0)
    await expect(section).toContainText('還沒有附件。')
  })
}

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// The share page's print layout (e8-t02, AC-8.2): a three-day trip with a lodging and a flight
// booking (both with a reference and a price) and two shares (everything / money and addresses
// hidden), seeded through the API. 「列印／存成 PDF」 renders the print-only parts (window.print is
// stubbed), then in print media: controls hidden, the cover shown, every day breaking before itself
// with its static map, the bookings table at the end. Chromium headless then prints an A4 PDF; its
// page count must be cover + one per day + the bookings page, so no day ran over a page. Needs
// `npm run dev` with local D1 migrated. A headless PDF, not a check of a real printer.

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Seeded {
  full: string
  hidden: string
  days: number
}

async function seed(request: APIRequestContext): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name: 'South Island print test',
      destination: 'New Zealand',
      startDate: inDays(40),
      endDate: inDays(42),
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
  const ger = await place('傑拉爾丁', 'Geraldine', -44.0921, 171.2436)
  const tek = await place('蒂卡波湖', 'Lake Tekapo', -44.0046, 170.4771)
  const cook = await place('庫克山', 'Aoraki Mount Cook', -43.7342, 170.0966)
  const zqn = await place('皇后鎮', 'Queenstown', -45.0312, 168.6626)
  const stop = (dayId: string, fields: object) => post('/stops', { dayId, ...fields })
  await stop(days[0]!.id, { placeId: chc, type: 'transport', note: 'Pick up the campervan' })
  await stop(days[0]!.id, { placeId: ger, type: 'food', costMinor: 2500, currency: 'NZD' })
  await stop(days[0]!.id, { placeId: tek, type: 'sight', costMinor: 1500, currency: 'NZD' })
  await stop(days[0]!.id, { title: 'Cinema', type: 'other', isBackup: true })
  await stop(days[1]!.id, { placeId: cook, type: 'sight', title: 'Hooker Valley Track' })
  await stop(days[1]!.id, { placeId: tek, type: 'rest', title: 'Hot pools' })
  await stop(days[2]!.id, { placeId: zqn, type: 'food', costMinor: 3000, currency: 'AUD' })
  await post('/lodgings', {
    placeId: tek,
    name: 'Lakes Edge Holiday Park',
    checkIn: days[0]!.date,
    checkOut: days[2]!.date,
    checkInTime: '15:00',
    checkOutTime: '10:00',
    campType: 'holiday-park',
    ref: 'LEHP-4417',
    priceMinor: 30000,
    currency: 'NZD',
    payStatus: 'deposit',
  })
  await post('/bookings', {
    type: 'flight',
    title: 'NZ 102 Sydney – Christchurch',
    details: { airline: 'Air NZ', flightNo: 'NZ102', fromAirport: 'SYD', toAirport: 'CHC' },
    startLocal: `${days[0]!.date}T07:05`,
    startTz: 'Australia/Sydney',
    endLocal: `${days[0]!.date}T12:20`,
    endTz: 'Pacific/Auckland',
    ref: 'X7Q2PL',
    priceMinor: 45900,
    currency: 'AUD',
    payStatus: 'paid',
  })
  const share = async (options: object) =>
    (await post<{ shareToken: string }>('/shares', { options })).shareToken
  return {
    full: await share({}),
    hidden: await share({ hideMoney: true, hideAddresses: true }),
    days: days.length,
  }
}

let seeded: Seeded

test.beforeAll(async ({ request }) => {
  seeded = await seed(request)
})

/** Opens the share, presses 「列印／存成 PDF」 (window.print stubbed) and switches to print media */
async function preparePrint(page: Page, token: string) {
  await page.addInitScript(() => {
    localStorage.setItem('tripfolio.share.locale', 'zh-TW')
    const w = window as unknown as { printed: number; print: () => void }
    w.printed = 0
    w.print = () => {
      w.printed += 1
    }
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/s/${token}`)
  await expect(
    page.getByRole('heading', { level: 1, name: 'South Island print test' }),
  ).toBeVisible()
  const button = page.getByTestId('share-print')
  await expect(button).toHaveText('列印／存成 PDF')
  // Print-only parts are not drawn before printing
  await expect(page.getByTestId('print-day-map')).toHaveCount(0)
  await button.click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  // Rendered, but not on screen
  await expect(page.getByTestId('print-day-map')).toHaveCount(seeded.days)
  await expect(page.getByTestId('print-day-map').first()).toBeHidden()
  await expect(page.getByTestId('share-bookings')).toBeHidden()
  await page.emulateMedia({ media: 'print' })
}

/** Pages in a PDF: its /Type /Page objects (not /Pages) */
const pdfPageCount = (pdf: Buffer) =>
  pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g)?.length ?? 0

/** A4 printable height in CSS px: (297 - 2 x 14) mm at 96 dpi */
const PRINTABLE_PX = ((297 - 28) / 25.4) * 96

test('full share prints a cover, a page per day with its map, and the bookings', async ({
  page,
}) => {
  await preparePrint(page, seeded.full)

  // Controls, the language switch, the footer and the picks wall stay off paper
  await expect(page.getByTestId('share-print')).toBeHidden()
  await expect(page.getByRole('radiogroup')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '看完整行程' })).toHaveCount(0)
  await expect(page.getByText('用 Tripfolio 規劃')).toBeHidden()

  // Cover and route overview
  await expect(
    page.getByRole('heading', { level: 1, name: 'South Island print test' }),
  ).toBeVisible()
  await expect(page.getByTestId('share-map').locator('svg[role="img"]').first()).toBeVisible()

  // A page per day: breaks before itself, map with numbered pins, stops table
  const days = page.getByTestId('share-day')
  await expect(days).toHaveCount(seeded.days)
  for (let i = 0; i < seeded.days; i++) {
    const day = days.nth(i)
    expect(await day.evaluate((el) => getComputedStyle(el).breakBefore)).toBe('page')
    const map = day.getByTestId('print-day-map')
    await expect(map).toBeVisible()
    await expect(map.locator('circle')).not.toHaveCount(0)
    await expect(day.locator('table')).toBeVisible()
    const height = await day.evaluate((el) => el.getBoundingClientRect().height)
    expect(height, `Day ${i + 1} fits one page`).toBeLessThan(PRINTABLE_PX)
  }
  const day1 = days.nth(0)
  await expect(day1.getByText('今晚：Lakes Edge Holiday Park')).toBeVisible()
  await expect(day1.locator('tbody')).toContainText('Cinema')
  await expect(day1.locator('tbody')).toContainText('雨天備案')
  await expect(day1.locator('tbody')).toContainText('Christchurch Rd')
  await expect(day1.locator('p', { hasText: '當日預訂' })).toContainText('X7Q2PL')

  // Bookings on the last page, with references and prices
  const bookings = page.getByTestId('share-bookings')
  await expect(bookings).toBeVisible()
  expect(
    await bookings.locator('xpath=..').evaluate((el) => getComputedStyle(el).breakBefore),
  ).toBe('page')
  await expect(bookings.locator('tbody tr')).toHaveCount(2)
  await expect(bookings.getByRole('columnheader', { name: '訂位代號' })).toBeVisible()
  await expect(bookings).toContainText('X7Q2PL')
  await expect(bookings).toContainText('LEHP-4417')
  await expect(bookings).toContainText('已付訂金')
  await expect(bookings.getByText(/AU\$|AUD/)).toBeVisible()
  await expect(page.getByTestId('share-estimate')).toBeVisible()

  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true })
  const pages = pdfPageCount(pdf)
  console.log('full share PDF pages', pages, 'bytes', pdf.length)
  if (SHOTS) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${SHOTS}/share-print-full.pdf`, pdf)
    await page.screenshot({ path: `${SHOTS}/share-print-full.png`, fullPage: true })
  }
  // Cover + one page per day + bookings and estimate: no day ran over a page
  expect(pages).toBe(1 + seeded.days + 1)
})

test('hidden share prints no references and no prices', async ({ page }) => {
  await preparePrint(page, seeded.hidden)
  const bookings = page.getByTestId('share-bookings')
  await expect(bookings).toBeVisible()
  await expect(bookings.locator('tbody tr')).toHaveCount(2)
  await expect(bookings.getByRole('columnheader', { name: '訂位代號' })).toHaveCount(0)
  await expect(bookings.getByRole('columnheader', { name: '金額' })).toHaveCount(0)
  await expect(page.getByTestId('share-estimate')).toHaveCount(0)
  const text = (await page.locator('main').innerText()) ?? ''
  for (const secret of ['X7Q2PL', 'LEHP-4417', 'AU$', 'A$', 'NZ$', 'Rd']) {
    expect(text, secret).not.toContain(secret)
  }
  // Payment status is not money: it stays
  await expect(bookings).toContainText('已付清')
  const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true })
  const pages = pdfPageCount(pdf)
  console.log('hidden share PDF pages', pages)
  if (SHOTS) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${SHOTS}/share-print-hidden.pdf`, pdf)
  }
  expect(pages).toBe(1 + seeded.days + 1)
})

import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Recap mode (e8-t04) against a real Worker, local D1 and local R2: a trip that ended last week
// (2 days) with priced stops, three photos uploaded through the media API, expenses and a budget,
// seeded through the API. The recap page shows totals, each day's photos and 「預估 vs 實際」; an
// editor writes Day 1's recap; a share with showRecap shows the recap section and photos, and with
// hideMoney not a single amount. Phone (375) and desktop (1440). Needs `npm run dev` with local D1
// migrated (0012_recap.sql), or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

/** A small JPEG drawn in the browser (thumbnails must be JPEG or WebP) */
async function tinyJpeg(browser: Browser, fill: string): Promise<Buffer> {
  const page = await browser.newPage()
  const dataUrl = await page.evaluate((colour) => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, 40, 30)
    ctx.fillStyle = '#E7B86B'
    ctx.fillRect(10, 8, 20, 14)
    return canvas.toDataURL('image/jpeg', 0.8)
  }, fill)
  await page.close()
  return Buffer.from(dataUrl.split(',')[1]!, 'base64')
}

interface Seeded {
  tripId: string
  token: string
  photoIds: string[]
}

/** A share link of the trip (each test brings its own request context) */
async function share(request: APIRequestContext, options: object): Promise<string> {
  const res = await request.post(`/api/trips/${seeded.tripId}/shares`, {
    headers: { authorization: `Bearer ${seeded.token}` },
    data: { options },
  })
  expect(res.status(), await res.text()).toBe(201)
  return ((await res.json()) as { shareToken: string }).shareToken
}

async function seed(request: APIRequestContext, jpegs: Buffer[]): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name: 'Blue Mountains weekend',
      destination: 'Australia',
      startDate: inDays(-9),
      endDate: inDays(-8),
      tz: 'Australia/Sydney',
      baseCurrency: 'AUD',
      style: 'roadtrip',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status(), await created.text()).toBe(201)
  const t = (await created.json()) as {
    trip: { id: string }
    member: { id: string }
    memberToken: string
    days: { id: string; idx: number | null; date: string | null }[]
  }
  const headers = { authorization: `Bearer ${t.memberToken}` }
  const base = `/api/trips/${t.trip.id}`
  const days = t.days.filter((d) => d.idx !== null).sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
  const send = async <T>(method: 'post' | 'put', path: string, data: object): Promise<T> => {
    const res = await request[method](`${base}${path}`, { headers, data })
    expect(res.status(), `${path} ${await res.text()}`).toBeLessThan(300)
    return (await res.json()) as T
  }
  await send('post', '/stops', {
    dayId: days[0]!.id,
    title: 'Scenic World',
    type: 'sight',
    costMinor: 5000,
    currency: 'AUD',
  })
  await send('post', '/stops', {
    dayId: days[1]!.id,
    title: 'Leura cafe',
    type: 'food',
    costMinor: 3000,
    currency: 'AUD',
  })

  // Photos through the real upload flow: two on Day 1, one on Day 2
  const photoIds: string[] = []
  for (const [i, jpeg] of jpegs.entries()) {
    const dayId = (i < 2 ? days[0] : days[1])!.id
    const signed = await send<{ attachmentId: string; uploadUrl: string; thumbUploadUrl: string }>(
      'post',
      '/attachments/sign',
      { kind: 'photo', mime: 'image/jpeg', bytes: jpeg.length, hasThumb: true, dayId },
    )
    for (const url of [signed.uploadUrl, signed.thumbUploadUrl]) {
      const put = await request.put(url, {
        headers: { ...headers, 'content-type': 'image/jpeg' },
        data: jpeg,
      })
      expect(put.status(), await put.text()).toBeLessThan(300)
    }
    await send('post', `/attachments/${signed.attachmentId}/complete`, {})
    photoIds.push(signed.attachmentId)
  }

  const me = [{ memberId: t.member.id }]
  const spend = (date: string | null, amountMinor: number, note: string) =>
    send('post', '/expenses', {
      currency: 'AUD',
      splitMethod: 'equal',
      date,
      category: 'food',
      amountMinor,
      payerMemberId: t.member.id,
      note,
      participants: me,
    })
  await spend(days[0]!.date, 6000, 'Cable car')
  await spend(days[1]!.date, 1000, 'Flat white')
  await send('put', '/budget', { rows: [{ category: 'food', plannedMinor: 20000, perPerson: true }] })

  return {
    tripId: t.trip.id,
    token: t.memberToken,
    photoIds,
  }
}

let seeded: Seeded

test.beforeAll(async ({ request, browser }) => {
  const jpegs = [
    await tinyJpeg(browser, '#0F6E74'),
    await tinyJpeg(browser, '#B5654A'),
    await tinyJpeg(browser, '#5B7B4A'),
  ]
  seeded = await seed(request, jpegs)
})

for (const width of [375, 1440]) {
  test(`recap page and share recap at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 })
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [seeded.tripId, seeded.token],
    )
    await page.goto(`/trips/${seeded.tripId}/recap`)
    await expect(page.getByRole('heading', { level: 1, name: '回顧' })).toBeVisible()

    // Totals: estimate 80.00 (stops), actual 70.00 (expenses), 10.00 under
    const totals = page.getByTestId('recap-totals')
    await expect(totals).toContainText(/預估\s*AU?\$80\.00/)
    await expect(totals).toContainText(/實際\s*AU?\$70\.00/)
    await expect(totals).toContainText(/省下\s*AU?\$10\.00/)

    const dayPanels = page.getByTestId('recap-day')
    await expect(dayPanels).toHaveCount(2)
    const day1 = dayPanels.nth(0)
    const day2 = dayPanels.nth(1)
    await expect(day1.getByText('Day 1', { exact: true })).toBeVisible()
    await expect(day1.getByTestId('recap-money')).toContainText(/超出\s*AU?\$10\.00/)
    await expect(day2.getByTestId('recap-money')).toContainText(/省下\s*AU?\$20\.00/)

    // Photo wall: two on Day 1, one on Day 2; the lightbox opens and closes
    await expect(day1.getByTestId('recap-photos').locator('li')).toHaveCount(2)
    await expect(day2.getByTestId('recap-photos').locator('li')).toHaveCount(1)
    const firstThumb = day1.getByTestId('recap-photos').locator('img').first()
    await firstThumb.scrollIntoViewIfNeeded()
    await expect.poll(() => firstThumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)
    await day1.getByRole('button', { name: '查看照片 1' }).click()
    const viewer = page.getByRole('dialog')
    await expect(viewer).toBeVisible()
    await expect(viewer).toContainText('第 1／2 張')
    await page.keyboard.press('Escape')
    await expect(viewer).toBeHidden()

    // Write Day 1's recap
    const text = `Cable car over the valley (${width}).\n\nPies at Leura after.`
    const area = day1.getByTestId('recap-text')
    await area.fill(text)
    await day1.getByTestId('recap-save').click()
    await expect(page.getByText('已儲存 Day 1 的回顧')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('recap-day').nth(0).getByTestId('recap-text')).toHaveValue(text)
    await shot(page, `recap-${width}`)

    // Share with the recap and hidden money: recap text and photos, no amounts at all
    const hidden = await share(request, { showRecap: true, hideMoney: true })
    await page.addInitScript(() => localStorage.setItem('tripfolio.share.locale', 'zh-TW'))
    await page.goto(`/s/${hidden}`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Blue Mountains weekend' }),
    ).toBeVisible()
    const recap = page.getByTestId('share-recap')
    await expect(recap.getByRole('heading', { name: '回顧' })).toBeVisible()
    await expect(recap.getByTestId('share-recap-day')).toHaveCount(2)
    await expect(recap.getByText(`Cable car over the valley (${width}).`)).toBeVisible()
    await expect(recap.getByText('Pies at Leura after.')).toBeVisible()
    const shared = recap.locator(`img[src*="/api/media/${seeded.photoIds[0]}/thumb?s="]`)
    await shared.scrollIntoViewIfNeeded()
    await expect.poll(() => shared.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40)
    await expect(recap.locator('img')).toHaveCount(3)
    await expect(page.getByTestId('share-estimate')).toHaveCount(0)
    await expect(page.getByText(/AU?\$|AUD/)).toHaveCount(0)
    await shot(page, `share-recap-${width}`)

    // Without hideMoney the estimate's per-person row comes from the budget (200.00)
    const full = await share(request, { showRecap: true })
    await page.goto(`/s/${full}`)
    await expect(page.getByTestId('share-recap')).toBeVisible()
    await expect(page.getByTestId('share-estimate-budget')).toContainText(/AU?\$200\.00/)
    await expect(page.getByTestId('share-recap')).not.toContainText(/AU?\$/)
  })
}

test('a share without showRecap has no recap section', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const plain = await share(request, {})
  await page.goto(`/s/${plain}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Blue Mountains weekend' })).toBeVisible()
  await expect(page.getByTestId('share-recap')).toHaveCount(0)
})

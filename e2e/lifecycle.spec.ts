import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Trip lifecycle (e1-t07, e8-t03, e8-t05, e11-t06) against a real Worker and local D1: export the
// trip file from settings (download, parse, check the format), download the calendar, copy the trip
// as a template with a new start date (lands on the copy, dates shifted), import the exported file
// from the trip list (a broken file shows the server's error path), delete a trip (it shows under
// 已刪除的旅程 with its purge date), restore it, see the calendar subscription URL when a share link
// is created, and read /privacy in both languages. Phone and desktop.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Created {
  trip: { id: string }
  memberToken: string
  days: { id: string; idx: number | null }[]
}

async function createTripWithStops(request: APIRequestContext, name: string): Promise<Created> {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Queenstown',
      startDate: inDays(20),
      endDate: inDays(23),
      tz: 'Pacific/Auckland',
      coverColor: '#0F6E74',
      style: 'roadtrip',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  const created = (await response.json()) as Created
  const headers = { authorization: `Bearer ${created.memberToken}` }
  const [day1, day2] = created.days.filter((d) => d.idx !== null)
  for (const [dayId, title] of [
    [day1.id, 'Skyline Gondola'],
    [day1.id, 'Fergburger'],
    [day2.id, 'Milford Sound'],
  ]) {
    const stop = await request.post(`/api/trips/${created.trip.id}/stops`, {
      headers,
      data: { dayId, title },
    })
    expect(stop.status()).toBe(201)
  }
  return created
}

async function newPage(browser: Browser, width: number, tokens: Record<string, string>, locale = 'zh-TW') {
  const context = await browser.newContext({
    locale,
    viewport: { width, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  })
  await context.addInitScript((value) => {
    if (!localStorage.getItem('tripfolio.memberTokens'))
      localStorage.setItem('tripfolio.memberTokens', JSON.stringify(value))
  }, tokens)
  return { context, page: await context.newPage() }
}

const tokensOf = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('tripfolio.memberTokens') ?? '{}') as Record<string, string>,
  )

for (const width of [375, 1440]) {
  test(`${width}px: export, calendar, clone, import, delete and restore, webcal URL`, async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000)
    const tripName = `生命週期 ${width}`
    const created = await createTripWithStops(request, tripName)
    const { context, page } = await newPage(browser, width, {
      [created.trip.id]: created.memberToken,
    })
    const section = page.getByRole('region', { name: '旅程檔案' })

    // ---- export the trip file (with expenses) ----
    await page.goto(`/trips/${created.trip.id}/settings`)
    await expect(section.getByRole('heading', { name: '匯出旅程檔' })).toBeVisible()
    await section.getByRole('checkbox', { name: /含花費/ }).check()
    await shot(page, `${width}-lifecycle-settings`)
    const [exported] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: '匯出旅程檔' }).click(),
    ])
    expect(exported.suggestedFilename()).toMatch(/\.tripfolio\.json$/)
    const exportPath = join(tmpdir(), `lifecycle-${width}-${Date.now()}.json`)
    await exported.saveAs(exportPath)
    const file = JSON.parse(await readFile(exportPath, 'utf8')) as {
      format: string
      version: number
      includes: { expenses: boolean; photos: boolean }
      trip: { name: string; startDate: string }
      stops: { title: string }[]
      expenses?: unknown[]
    }
    expect(file.format).toBe('tripfolio.trip')
    expect(file.version).toBe(1)
    expect(file.includes).toEqual({ expenses: true, photos: false })
    expect(file.trip.name).toBe(tripName)
    expect(file.stops.map((s) => s.title).sort()).toEqual(
      ['Fergburger', 'Milford Sound', 'Skyline Gondola'].sort(),
    )
    expect(Array.isArray(file.expenses)).toBe(true)
    expect(JSON.stringify(file)).not.toContain(created.memberToken)

    // ---- calendar download ----
    const [ics] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: '下載行事曆 (.ics)' }).click(),
    ])
    expect(ics.suggestedFilename()).toMatch(/\.ics$/)
    const icsText = await readFile(await ics.path(), 'utf8')
    expect(icsText).toContain('BEGIN:VCALENDAR')
    expect(icsText).toContain('Day 1')

    // ---- clone as template with a new start date ----
    await section.getByRole('button', { name: '複製為範本' }).click()
    const clone = page.getByRole('dialog', { name: '複製為範本' })
    await expect(clone.getByLabel('新旅程名稱')).toHaveValue(`${tripName}（副本）`)
    await clone.getByLabel('新旅程名稱').fill(`範本 ${width}`)
    await clone.getByLabel('新的出發日').fill(inDays(60))
    await expect(clone.getByRole('checkbox', { name: /保留旅伴/ })).not.toBeChecked()
    await shot(page, `${width}-lifecycle-clone`)
    await clone.getByRole('button', { name: '建立副本' }).click()
    await page.waitForURL((url) => /\/trips\/[^/]+$/.test(url.pathname) && !url.pathname.includes(created.trip.id))
    const copyId = new URL(page.url()).pathname.split('/')[2]
    const copyToken = (await tokensOf(page))[copyId]
    expect(copyToken).toBeTruthy()
    const copy = (await (
      await request.get(`/api/trips/${copyId}`, { headers: { authorization: `Bearer ${copyToken}` } })
    ).json()) as { trip: { name: string; startDate: string; endDate: string }; members: unknown[] }
    expect(copy.trip.name).toBe(`範本 ${width}`)
    expect(copy.trip.startDate).toBe(inDays(60))
    expect(copy.trip.endDate).toBe(inDays(63))
    expect(copy.members).toHaveLength(1)
    const copyDays = (await (
      await request.get(`/api/trips/${copyId}/days`, {
        headers: { authorization: `Bearer ${copyToken}` },
      })
    ).json()) as { days: { idx: number | null; stops: unknown[] }[] }
    expect(copyDays.days.reduce((n, d) => n + d.stops.length, 0)).toBe(3)

    // ---- import: a broken file shows the server's error path, the real one becomes a trip ----
    await page.goto('/')
    await expect(page.getByRole('link', { name: new RegExp(tripName) })).toBeVisible()
    await page.getByRole('button', { name: '匯入旅程檔' }).click()
    const importer = page.getByRole('dialog', { name: '匯入旅程檔' })
    const brokenPath = join(tmpdir(), `lifecycle-broken-${width}-${Date.now()}.json`)
    const broken = JSON.parse(await readFile(exportPath, 'utf8')) as { stops: { day: number }[] }
    broken.stops[0].day = 999
    await writeFile(brokenPath, JSON.stringify(broken))
    await importer.getByLabel('旅程檔 (.json)').setInputFiles(brokenPath)
    await importer.getByLabel('你的名字').fill('Lee')
    await importer.getByRole('button', { name: '匯入', exact: true }).click()
    await expect(importer.getByRole('alert')).toContainText('伺服器拒絕這個檔案')
    await expect(importer.getByRole('alert')).toContainText('stops[0]')

    await importer.getByLabel('旅程檔 (.json)').setInputFiles(exportPath)
    const summary = importer.getByRole('region', { name: '檔案內容' })
    await expect(summary).toContainText(tripName)
    await expect(summary).toContainText('行程點')
    await importer.getByLabel('新旅程名稱').fill(`匯入 ${width}`)
    await shot(page, `${width}-lifecycle-import`)
    await importer.getByRole('button', { name: '匯入', exact: true }).click()
    await page.waitForURL((url) => /\/trips\/[^/]+$/.test(url.pathname))
    const importedId = new URL(page.url()).pathname.split('/')[2]
    expect([created.trip.id, copyId]).not.toContain(importedId)
    await page.goto('/')
    const importedCard = page.getByRole('link', { name: new RegExp(`匯入 ${width}`) })
    await expect(importedCard).toBeVisible()

    // ---- delete the imported trip, see it under 已刪除的旅程, restore it ----
    await page.goto(`/trips/${importedId}/settings`)
    await section.getByRole('button', { name: '刪除旅程' }).click()
    const confirm = page.getByRole('dialog', { name: `刪除「匯入 ${width}」？` })
    await expect(confirm).toContainText('30 天')
    await confirm.getByRole('button', { name: '刪除', exact: true }).click()
    await page.waitForURL((url) => url.pathname === '/')
    await expect(importedCard).toHaveCount(0)
    const deleted = page.getByRole('region', { name: /已刪除的旅程/ })
    await expect(deleted).toContainText(`匯入 ${width}`)
    await expect(deleted).toContainText('永久刪除')
    await expect(deleted).toContainText(/剩 (29|30) 天/)
    await shot(page, `${width}-lifecycle-deleted`)
    // The list survives a reload (the token was kept aside although GET /api/trips dropped it)
    await page.reload()
    await expect(deleted).toContainText(`匯入 ${width}`)
    await deleted.getByRole('button', { name: `還原「匯入 ${width}」` }).click()
    await expect(importedCard).toBeVisible()
    await expect(deleted).toHaveCount(0)

    // ---- the share dialog shows the calendar subscription URL ----
    await page.goto(`/trips/${created.trip.id}/settings`)
    const shares = page.getByRole('region', { name: '分享連結' })
    await shares.getByRole('button', { name: '建立分享連結' }).click()
    await page.getByRole('dialog', { name: '建立分享連結' }).getByRole('button', { name: '建立分享連結' }).click()
    const done = page.getByRole('dialog', { name: '分享連結已建立' })
    const feed = done.getByLabel('行事曆訂閱網址')
    await expect(feed).toHaveValue(/^webcal:\/\/[^/]+\/api\/share\/[^/]+\/calendar\.ics$/)
    await shot(page, `${width}-lifecycle-webcal`)
    const feedUrl = (await feed.inputValue()).replace(/^webcal:\/\/[^/]+/, '')
    const feedResponse = await request.get(feedUrl)
    expect(feedResponse.status()).toBe(200)
    expect(await feedResponse.text()).toContain('BEGIN:VCALENDAR')
    await done.getByRole('button', { name: '完成' }).click()

    // ---- the privacy page, from the list footer ----
    await page.goto('/')
    await page.getByRole('link', { name: '隱私說明' }).click()
    await page.waitForURL('**/privacy')
    await expect(page.getByRole('heading', { level: 1, name: '隱私說明' })).toBeVisible()
    for (const heading of ['我們存什麼', '誰看得到', '照片與文件', '分享連結', '刪除與保留 30 天', '外部服務', '聯絡'])
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
    await shot(page, `${width}-privacy-zh`)
    await context.close()

    const english = await newPage(browser, width, {}, 'en-US')
    await english.page.goto('/privacy')
    await expect(english.page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
    await expect(english.page.getByRole('heading', { name: 'What we store' })).toBeVisible()
    await expect(english.page.getByRole('heading', { name: 'Deleting, and the 30 days' })).toBeVisible()
    await expect(english.page.getByText('open.er-api.com', { exact: false })).toBeVisible()
    const scrollWidth = await english.page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(width)
    await shot(english.page, `${width}-privacy-en`)
    await english.context.close()
  })
}

test('a viewer gets the calendar but no export, clone or delete', async ({ browser, request }) => {
  const created = await createTripWithStops(request, '生命週期 viewer')
  const headers = { authorization: `Bearer ${created.memberToken}` }
  const invite = await request.post(`/api/trips/${created.trip.id}/invites`, { headers })
  const { inviteToken } = (await invite.json()) as { inviteToken: string }
  const kid = await request.post(`/api/trips/${created.trip.id}/members`, {
    headers,
    data: { name: 'Kid', color: '#B5654A', role: 'viewer' },
  })
  const kidId = ((await kid.json()) as { member: { id: string } }).member.id
  const joined = await request.post(`/api/join/${inviteToken}`, { data: { memberId: kidId } })
  expect(joined.ok()).toBe(true)
  const viewerToken = ((await joined.json()) as { memberToken: string }).memberToken
  const { context, page } = await newPage(browser, 375, { [created.trip.id]: viewerToken })
  await page.goto(`/trips/${created.trip.id}/settings`)
  const section = page.getByRole('region', { name: '旅程檔案' })
  await expect(section.getByRole('button', { name: '下載行事曆 (.ics)' })).toBeVisible()
  await expect(section.getByRole('button', { name: '匯出旅程檔' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: '複製為範本' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: '刪除旅程' })).toHaveCount(0)
  await expect(section).toContainText('只有擁有者可以刪除旅程')
  await context.close()
})

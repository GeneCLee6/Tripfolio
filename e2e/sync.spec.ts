import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

// Live itinerary sync (e2-t08b) with two members in two browser contexts on the same trip, against
// a real Worker, TripDO and local D1 (`npm run dev`, or BASE_URL): A adds a stop and B sees it
// without reloading; B edits a stop's title while A changes its time and both changes survive;
// A goes offline, adds and moves stops, comes back, and B sees them in A's order; A's 「即時」
// dot goes 離線 → 即時. Two contexts on one machine are not two devices: AC-2.6 still needs the
// two-phone check (CLAUDE.md rule 11).

test.use({ locale: 'zh-TW', viewport: { width: 1440, height: 900 } })

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Member {
  context: BrowserContext
  page: Page
  token: string
}

async function setup(browser: Browser, request: APIRequestContext, name: string) {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(30),
      endDate: inDays(32),
      tz: 'Pacific/Auckland',
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
  const invite = await request.post(`/api/trips/${trip.id}/invites`, {
    headers: { authorization: `Bearer ${memberToken}` },
  })
  expect(invite.status()).toBe(201)
  const { inviteToken } = (await invite.json()) as { inviteToken: string }
  const joined = await request.post(`/api/join/${inviteToken}`, {
    data: { name: 'Mia', color: '#B4532A' },
  })
  expect(joined.status()).toBe(201)
  const mia = (await joined.json()) as { memberToken: string }

  const open = async (token: string): Promise<Member> => {
    const context = await browser.newContext()
    await context.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [trip.id, token],
    )
    const page = await context.newPage()
    await page.goto(`/trips/${trip.id}/itinerary`)
    await expect(dot(page)).toHaveText('即時', { timeout: 15_000 })
    return { context, page, token }
  }
  const a = await open(memberToken)
  const b = await open(mia.memberToken)
  return { tripId: trip.id, a, b }
}

/** The sync dot that is on screen (the side column at this width) */
const dot = (page: Page) => page.getByTestId('sync-status').filter({ visible: true })
const pane = (page: Page) => page.getByRole('complementary', { name: '細節' })
const cardNames = (page: Page) =>
  page.locator('[data-stop-id] > button:first-child > span:first-child').allTextContents()

async function addStop(page: Page, title: string, start?: string) {
  await page.getByRole('button', { name: '＋ 加行程點' }).first().click()
  await pane(page).getByLabel('名稱').fill(title)
  if (start) await pane(page).getByLabel('開始時間').fill(start)
  await pane(page).getByRole('button', { name: '儲存' }).click()
  await expect(page.locator('[data-stop-id]').filter({ hasText: title })).toBeVisible()
}

async function daysOf(request: APIRequestContext, tripId: string, token: string) {
  const response = await request.get(`/api/trips/${tripId}/days`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(response.ok()).toBe(true)
  return (await response.json()) as {
    days: { idx: number | null; stops: { id: string; title: string; startAt: string | null }[] }[]
  }
}

test('A adds a stop and B sees it within 3 seconds, without reloading', async ({
  browser,
  request,
}) => {
  const { a, b } = await setup(browser, request, 'Sync add')
  await a.page.getByRole('button', { name: '＋ 加行程點' }).first().click()
  await pane(a.page).getByLabel('名稱').fill('Lake Tekapo')
  const saved = Date.now()
  await pane(a.page).getByRole('button', { name: '儲存' }).click()
  await expect(b.page.locator('[data-stop-id]').filter({ hasText: 'Lake Tekapo' })).toBeVisible({
    timeout: 3_000,
  })
  const latency = Date.now() - saved
  console.log(`[sync] A save → B sees the stop: ${latency} ms`)
  expect(latency).toBeLessThan(3_000)
  await a.context.close()
  await b.context.close()
})

test('B edits the title while A changes the time: both changes are kept', async ({
  browser,
  request,
}) => {
  const { tripId, a, b } = await setup(browser, request, 'Sync merge')
  await addStop(a.page, 'Hooker Valley', '09:00')
  const card = (page: Page) => page.locator('[data-stop-id]').filter({ hasText: 'Hooker Valley' })
  await expect(card(b.page)).toBeVisible()

  // B opens the editor and starts typing a new title (not saved yet)
  await b.page.getByRole('button', { name: '編輯「Hooker Valley」' }).click()
  await pane(b.page).getByLabel('名稱').fill('Hooker Valley Track')

  // A changes the time and saves
  await a.page.getByRole('button', { name: '編輯「Hooker Valley」' }).click()
  await pane(a.page).getByLabel('開始時間').fill('10:30')
  await pane(a.page).getByRole('button', { name: '儲存' }).click()
  await expect(card(a.page)).toContainText('10:30')

  // B's open editor took A's time silently and kept B's title
  await expect(pane(b.page).getByLabel('開始時間')).toHaveValue('10:30', { timeout: 3_000 })
  await expect(pane(b.page).getByLabel('名稱')).toHaveValue('Hooker Valley Track')
  await expect(pane(b.page).getByTestId('stop-conflict')).toHaveCount(0)
  await pane(b.page).getByRole('button', { name: '儲存' }).click()

  const merged = (page: Page) =>
    page.locator('[data-stop-id]').filter({ hasText: 'Hooker Valley Track' })
  await expect(merged(b.page)).toContainText('10:30')
  await expect(merged(a.page)).toContainText('10:30', { timeout: 3_000 })
  const { days } = await daysOf(request, tripId, a.token)
  const stop = days.flatMap((day) => day.stops).find((s) => s.title === 'Hooker Valley Track')
  expect(stop?.startAt).toBeTruthy()

  // The same field on both sides: B keeps its own value and is told, then takes theirs
  await b.page.getByRole('button', { name: '編輯「Hooker Valley Track」' }).click()
  await pane(b.page).getByLabel('名稱').fill('B title')
  await a.page.getByRole('button', { name: '編輯「Hooker Valley Track」' }).click()
  await pane(a.page).getByLabel('名稱').fill('A title')
  await pane(a.page).getByRole('button', { name: '儲存' }).click()
  const conflict = pane(b.page).getByTestId('stop-conflict')
  await expect(conflict).toContainText('其他人剛改了這個欄位', { timeout: 3_000 })
  await expect(pane(b.page).getByLabel('名稱')).toHaveValue('B title')
  await conflict.getByRole('button', { name: '使用他們的版本' }).click()
  await expect(pane(b.page).getByLabel('名稱')).toHaveValue('A title')
  await expect(conflict).toHaveCount(0)
  await a.context.close()
  await b.context.close()
})

test('A edits offline, comes back, and B sees the stops in A’s order', async ({
  browser,
  request,
}) => {
  const { tripId, a, b } = await setup(browser, request, 'Sync offline')
  await addStop(a.page, 'Mt Cook Village')
  await expect(
    b.page.locator('[data-stop-id]').filter({ hasText: 'Mt Cook Village' }),
  ).toBeVisible()

  await a.context.setOffline(true)
  await expect(dot(a.page)).toHaveText('離線')
  await addStop(a.page, 'Offline one')
  await addStop(a.page, 'Offline two')
  // Move 「Offline one」 below 「Offline two」: the move names a stop the server has not seen yet
  await a.page.getByRole('button', { name: '「Offline one」的更多動作' }).click()
  await a.page.getByRole('menuitem', { name: '下移' }).click()
  await expect
    .poll(() => cardNames(a.page))
    .toEqual(['Mt Cook Village', 'Offline two', 'Offline one'])
  await expect(a.page.getByTestId('offline-badge')).toContainText('3')
  // Nothing reached B
  await b.page.waitForTimeout(1_000)
  expect(await cardNames(b.page)).toEqual(['Mt Cook Village'])

  const back = Date.now()
  await a.context.setOffline(false)
  await expect(dot(a.page)).toHaveText('即時', { timeout: 15_000 })
  await expect
    .poll(() => cardNames(b.page), { timeout: 15_000 })
    .toEqual(['Mt Cook Village', 'Offline two', 'Offline one'])
  console.log(`[sync] A back online → B shows the offline edits: ${Date.now() - back} ms`)
  await expect(a.page.getByTestId('offline-badge')).toHaveCount(0)
  const { days } = await daysOf(request, tripId, a.token)
  expect(days[0].stops.map((s) => s.title)).toEqual([
    'Mt Cook Village',
    'Offline two',
    'Offline one',
  ])
  expect(days[0].stops.every((s) => !s.id.startsWith('pending-'))).toBe(true)
  // A's own page has the real ids after the replay too
  await expect.poll(() => a.page.locator('[data-stop-id^="pending-"]').count()).toBe(0)
  await a.context.close()
  await b.context.close()
})

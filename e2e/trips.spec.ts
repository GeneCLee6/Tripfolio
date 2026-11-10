import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// The A3 walk-through (e10-t03, e1-t02): the app shell at phone, tablet and desktop widths, and the
// trip list → create → trip home → edit → archive flow against a real Worker and local D1. Run with
// `npm run dev` (and `wrangler d1 migrations apply tripfolio --local`) or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

/** YYYY-MM-DD, `days` from today (UTC is close enough for test data) */
// Dates are computed in the trip's own time zone: the app counts down in trip tz, so a UTC date
// would be off by one whenever UTC and the trip zone are on different calendar days
const inDays = (days: number, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

async function createTripViaApi(request: APIRequestContext, name: string) {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Bali',
      startDate: inDays(20, 'Asia/Makassar'),
      endDate: inDays(25, 'Asia/Makassar'),
      tz: 'Asia/Makassar',
      coverColor: '#B5654A',
      style: 'private-driver',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { trip: { id: string }; memberToken: string }
}

async function rememberToken(page: Page, tripId: string, token: string) {
  await page.addInitScript(
    ([id, value]) =>
      localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [tripId, token],
  )
}

const visibleNav = (page: Page) =>
  page.getByRole('navigation', { name: '旅程導覽' }).filter({ visible: true })

test('phone: create a trip, find it in the list, edit it, archive it', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '還沒有旅程' })).toBeVisible()
  await shot(page, 'phone-empty')

  await page.getByRole('button', { name: '建立旅程' }).click()
  await expect(page).toHaveURL(/\/trips\/new$/)
  await page.getByLabel('旅程名稱').fill('南島露營車')
  await page.getByRole('textbox', { name: /^目的地/ }).fill('紐西蘭南島')
  // The destination fills in the zone and the local currency
  await expect(page.getByLabel('目的地時區')).toHaveValue('Pacific/Auckland')
  await expect(page.getByRole('button', { name: 'NZD' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByLabel('出發日').fill(inDays(30, 'Pacific/Auckland'))
  await page.getByLabel('回程日').fill(inDays(37, 'Pacific/Auckland'))
  await page.getByLabel('旅行型態').selectOption('campervan')
  await page
    .getByRole('radiogroup', { name: '封面色' })
    .getByRole('radio', { name: '靛藍' })
    .click()
  await page.getByLabel('你的名字').fill('Gene')

  // An empty name is caught before the request
  await page.getByLabel('旅程名稱').fill('')
  await page.getByRole('button', { name: '建立旅程' }).click()
  await expect(page.getByText('請輸入旅程名稱（最多 120 字）')).toBeVisible()
  await shot(page, 'phone-form-error')
  await page.getByLabel('旅程名稱').fill('南島露營車')
  await page.getByRole('button', { name: '建立旅程' }).click()

  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
  await expect(page.getByRole('heading', { level: 1, name: '南島露營車' })).toBeVisible()
  await expect(page.getByText('還有 30 天')).toBeVisible()
  await expect(page.getByRole('heading', { name: '沒有快到期的事' })).toBeVisible()
  // Phone layout: bottom navigation with five tabs and the floating button; no side column
  const nav = visibleNav(page)
  await expect(nav).toHaveCount(1)
  await expect(nav.getByRole('link')).toHaveCount(5)
  await expect(page.getByRole('button', { name: '記一筆' })).toBeVisible()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 375)
  await shot(page, 'phone-trip-home')

  await nav.getByRole('link', { name: '地圖' }).click()
  await expect(page.getByText('還沒有地點，去日程加行程點')).toBeVisible()
  await nav.getByRole('link', { name: '總覽' }).click()

  // The list: the new trip is coming up
  await page.getByRole('link', { name: '回到旅程列表' }).click()
  const upcoming = page.getByRole('region', { name: /即將出發/ })
  await expect(upcoming.getByRole('link', { name: '打開 南島露營車' })).toBeVisible()
  await expect(upcoming.getByText('還有 30 天')).toBeVisible()
  await expect(upcoming.getByText('8 天')).toBeVisible()
  await expect(upcoming.getByText('1 人')).toBeVisible()
  await shot(page, 'phone-list')

  // Edit (a page on phones)
  await upcoming.getByRole('link', { name: '打開 南島露營車' }).click()
  await page.getByRole('button', { name: '編輯旅程' }).click()
  await expect(page).toHaveURL(/\/edit$/)
  await expect(page.getByLabel('目的地時區')).toHaveValue('Pacific/Auckland')
  await page.getByLabel('旅程名稱').fill('南島露營車 2.0')
  await page.getByRole('button', { name: '儲存' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '南島露營車 2.0' })).toBeVisible()

  // Archive from settings (the top bar's settings link on phones)
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Gene' })).toContainText('擁有者')
  await expect(page.getByRole('button', { name: '建立邀請連結' })).toBeEnabled()
  await page.getByRole('button', { name: '封存旅程' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '封存旅程' }).click()
  await expect(page.getByRole('button', { name: '取消封存' })).toBeVisible()
  await shot(page, 'phone-settings-archived')

  await page.getByRole('link', { name: '回到旅程列表' }).click()
  const past = page.getByRole('region', { name: /過去的旅程/ })
  await expect(past.getByRole('link', { name: '打開 南島露營車 2.0' })).toBeVisible()
  await expect(past.getByText('已封存')).toBeVisible()
  await expect(page.getByRole('region', { name: /即將出發/ })).toHaveCount(0)

  // And back
  await past.getByRole('link', { name: '打開 南島露營車 2.0' }).click()
  await page.getByRole('link', { name: '設定', exact: true }).click()
  await page.getByRole('button', { name: '取消封存' }).click()
  await expect(page.getByRole('button', { name: '封存旅程' })).toBeVisible()
})

test('tablet: two columns, side navigation, the form in a dialog', async ({ page, request }) => {
  const { trip, memberToken } = await createTripViaApi(request, '峇里島包車')
  await rememberToken(page, trip.id, memberToken)
  await page.setViewportSize({ width: 900, height: 1000 })
  await page.goto(`/trips/${trip.id}`)
  await expect(page.getByRole('heading', { level: 1, name: '峇里島包車' })).toBeVisible()
  const nav = visibleNav(page)
  await expect(nav).toHaveCount(1)
  await expect(nav.getByRole('link')).toHaveCount(6)
  await expect(page.getByRole('button', { name: '記一筆' })).toBeHidden()
  const side = await nav.boundingBox()
  const main = await page.locator('#main').boundingBox()
  expect(side && main && side.x + side.width <= main.x).toBe(true)
  await expect(page.getByRole('complementary', { name: '細節' })).toBeHidden()
  await shot(page, 'tablet-trip-home')

  await page.getByRole('button', { name: '編輯旅程' }).click()
  const dialog = page.getByRole('dialog', { name: '編輯旅程' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('目的地時區')).toHaveValue('Asia/Makassar')
  await shot(page, 'tablet-edit-dialog')
  await dialog.getByLabel('一句話簡介').fill('烏布、海神廟、金巴蘭海灘')
  await dialog.getByRole('button', { name: '儲存' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('烏布、海神廟、金巴蘭海灘')).toBeVisible()
})

test('desktop: three columns of 360 / flexible / 400 px', async ({ page, request }) => {
  const { trip, memberToken } = await createTripViaApi(request, '峇里島三欄')
  await rememberToken(page, trip.id, memberToken)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/trips/${trip.id}`)
  await expect(page.getByRole('heading', { level: 1, name: '峇里島三欄' })).toBeVisible()
  const side = await page.locator('aside').first().boundingBox()
  const main = await page.locator('#main').boundingBox()
  const detail = await page.getByRole('complementary', { name: '細節' }).boundingBox()
  expect(side?.width).toBe(360)
  expect(detail?.width).toBe(400)
  expect(
    main && side && detail && side.x + side.width < main.x && main.x + main.width < detail.x,
  ).toBe(true)
  await expect(page.getByRole('button', { name: '記一筆' })).toBeHidden()
  await shot(page, 'desktop-trip-home')

  // From the list on desktop, a new trip opens in a dialog
  await page.goto('/')
  await page.getByRole('button', { name: '建立旅程' }).click()
  await expect(page.getByRole('dialog', { name: '建立旅程' })).toBeVisible()
  await shot(page, 'desktop-create-dialog')
})

test('join: pick "I am not on the list", land in the trip', async ({ page, request }) => {
  const { trip, memberToken } = await createTripViaApi(request, '邀請測試')
  const invite = await request.post(`/api/trips/${trip.id}/invites`, {
    headers: { authorization: `Bearer ${memberToken}` },
  })
  expect(invite.status()).toBe(201)
  const { inviteToken } = (await invite.json()) as { inviteToken: string }

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/join/${inviteToken}`)
  await expect(page.getByRole('heading', { name: '你是哪一位？' })).toBeVisible()
  await expect(page.getByText('邀請測試')).toBeVisible()
  await page.getByRole('radio', { name: '我不在名單上' }).click()
  await page.getByLabel('你的名字').fill('Mia')
  await shot(page, 'phone-join')
  await page.getByRole('button', { name: '加入旅程' }).click()
  await expect(page).toHaveURL(new RegExp(`/trips/${trip.id}$`))
  await expect(page.getByText('Mia').first()).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '邀請測試' })).toBeVisible()

  await page.goto('/join/not-a-real-token')
  await expect(page.getByRole('heading', { name: '邀請連結無效' })).toBeVisible()
})

test('unknown routes and trips this device has not joined', async ({ page }) => {
  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { name: '這裡什麼都沒有' })).toBeVisible()
  await page.goto('/trips/not-mine')
  await expect(page.getByRole('heading', { name: '打不開這趟旅程' })).toBeVisible()
})

test('English', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' })
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your trips' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New trip' })).toBeVisible()
  await context.close()
})

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

// The picks page (e5-t02..t04): a trip with one pick seeded through the API, then in the browser:
// add a must-buy from a pasted link (POST /og is mocked: title + image), vote, claim it twice for
// someone, put it into Day 1 (the itinerary API shows the stop), pull it back (the stop is gone),
// then sort, filter and group — at phone and desktop widths. Needs `npm run dev` with local D1
// migrated, or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

const SOURCE = 'https://www.example-honey.co.nz/manuka-umf-10'
const OG_IMAGE = 'https://img.example-honey.co.nz/jar.png'
// A 1×1 PNG, so the og image loads without the network
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

interface Seeded {
  tripId: string
  headers: { authorization: string }
  day1: string
}

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
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
  const body = (await created.json()) as {
    trip: { id: string }
    memberToken: string
    days: { id: string; idx: number | null }[]
  }
  const headers = { authorization: `Bearer ${body.memberToken}` }
  const tripId = body.trip.id
  // An older, cheaper must-eat
  const pick = await request.post(`/api/trips/${tripId}/wishlist`, {
    headers,
    data: { category: 'eat', name: 'Fergburger', estMinor: 1800, currency: 'NZD', note: '避開中午' },
  })
  expect(pick.status()).toBe(201)
  return { tripId, headers, day1: body.days.find((day) => day.idx === 1)!.id }
}

async function open(page: Page, request: APIRequestContext, name: string) {
  const seeded = await seed(request, name)
  await page.addInitScript(
    ([id, value]) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [seeded.tripId, seeded.headers.authorization.slice('Bearer '.length)],
  )
  const ogCalls: string[] = []
  await page.route('**/api/trips/*/og', async (route) => {
    ogCalls.push((route.request().postDataJSON() as { url: string }).url)
    await route.fulfill({
      json: { url: SOURCE, title: 'Manuka Honey UMF 10+', imageUrl: OG_IMAGE, siteName: 'Honey Co' },
    })
  })
  await page.route(OG_IMAGE, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }))
  await page.goto(`/trips/${seeded.tripId}/picks`)
  return { ...seeded, ogCalls }
}

/** The detail pane on desktop, the Sheet below */
const pane = (page: Page, desktop: boolean, title: string): Locator =>
  desktop
    ? page.getByRole('complementary', { name: '細節' })
    : page.getByRole('dialog', { name: title })

const card = (page: Page, name: string) => page.locator('article[data-pick-id]').filter({ hasText: name })
const cardNames = (page: Page) => page.locator('article[data-pick-id] h3').allTextContents()

async function wishlist(request: APIRequestContext, s: Seeded) {
  const res = await request.get(`/api/trips/${s.tripId}/wishlist`, { headers: s.headers })
  return (
    (await res.json()) as {
      items: {
        name: string
        status: string
        stopId: string | null
        votes: string[]
        sourceImageUrl: string | null
        photoAttachmentId: string | null
        claims: { qty: number; forName: string; buyerMemberId: string | null }[]
      }[]
    }
  ).items
}

async function dayOneStops(request: APIRequestContext, s: Seeded) {
  const res = await request.get(`/api/trips/${s.tripId}/days`, { headers: s.headers })
  const body = (await res.json()) as {
    days: { id: string; stops: { title: string; wishlistItemId: string | null; type: string }[] }[]
  }
  return body.days.find((day) => day.id === s.day1)!.stops
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: add from a link, vote, claim, schedule, sort and filter`, async ({ page, request }) => {
    const desktop = width >= 1200
    await page.setViewportSize({ width, height })
    const s = await open(page, request, `Picks ${label}`)

    await expect(page.getByRole('heading', { level: 1, name: '必吃必買' })).toBeVisible()
    await expect(card(page, 'Fergburger')).toContainText('NZ$18.00')
    await expect(card(page, 'Fergburger')).toContainText('口袋名單')

    // 1. Add a must-buy from a link: the og title fills the name, 「用這張圖」 keeps the image
    await page.getByRole('button', { name: '＋ 新增' }).first().click()
    const editor = pane(page, desktop, '新增必吃必買')
    await editor.getByRole('radio', { name: '必買' }).click()
    await editor.getByLabel('來源連結').fill(SOURCE)
    await editor.getByLabel('來源連結').blur()
    await expect(editor.getByLabel('名稱')).toHaveValue('Manuka Honey UMF 10+')
    expect(s.ogCalls).toEqual([SOURCE])
    await expect(editor.getByTestId('og-preview')).toContainText('Honey Co')
    await editor.getByRole('button', { name: '用這張圖' }).click()
    await expect(editor.getByText('已使用這張圖')).toBeVisible()
    await editor.getByLabel('預估價格').fill('45')
    await expect(editor.getByLabel('推薦人')).toHaveValue(/.+/)
    await shot(page, `${label}-picks-editor`)
    await editor.getByRole('button', { name: '儲存' }).click()

    const honey = card(page, 'Manuka Honey')
    await expect(honey).toContainText('NZ$45.00')
    await expect(honey.locator('img')).toHaveAttribute('src', OG_IMAGE)
    await expect(honey.getByRole('img', { name: 'Gene' })).toBeVisible()
    expect(await cardNames(page)).toEqual(['Manuka Honey UMF 10+', 'Fergburger'])

    // 2. Vote: 「想去」 toggles and counts
    const vote = honey.getByRole('button', { name: /想去「Manuka Honey UMF 10\+」/ })
    await expect(vote).toHaveAttribute('aria-pressed', 'false')
    await vote.click()
    await expect(vote).toHaveAttribute('aria-pressed', 'true')
    await expect(vote).toContainText('1 人想去')
    await expect(vote).toHaveAttribute('title', '想去的人：Gene')
    await expect.poll(async () => (await wishlist(request, s))[1]?.votes.length).toBe(1)

    // 3. Claim it in the detail pane: Gene buys 2 for Mum
    await honey.getByRole('button', { name: 'Manuka Honey UMF 10+', exact: true }).click()
    const detail = pane(page, desktop, '必吃必買')
    await expect(detail.getByRole('heading', { name: 'Manuka Honey UMF 10+' })).toBeVisible()
    await expect(detail.getByText('還沒有人認領')).toBeVisible()
    await detail.getByRole('button', { name: '認領', exact: true }).click()
    const claim = detail.locator('[data-claim-id]')
    await expect(claim).toHaveCount(1)
    await expect(claim.getByLabel('誰買')).toHaveValue(/.+/)
    await claim.getByRole('button', { name: '多一個' }).click()
    await expect(claim.locator('output')).toHaveText('2')
    await claim.getByLabel('幫誰帶').fill('媽媽')
    await claim.getByLabel('幫誰帶').blur()
    await expect(honey).toContainText('購物 · 2 個')
    await expect(honey).toContainText('誰買：Gene')
    await expect
      .poll(async () => (await wishlist(request, s))[1]?.claims)
      .toEqual([expect.objectContaining({ qty: 2, forName: '媽媽' })])
    await shot(page, `${label}-picks-detail`)
    if (!desktop) await detail.getByRole('button', { name: '關閉' }).click()

    // 4. Into Day 1 from the card menu: a shopping stop appears in the itinerary
    await honey.getByRole('button', { name: '「Manuka Honey UMF 10+」的更多動作' }).click()
    await page.getByRole('menuitem', { name: '排進這天' }).click()
    const days = page.getByRole('dialog', { name: '把「Manuka Honey UMF 10+」排進哪一天？' })
    await days.getByRole('button', { name: /Day 1/ }).click()
    await expect(honey).toContainText('Day 1')
    await expect(honey).not.toContainText('口袋名單')
    await expect
      .poll(async () => (await dayOneStops(request, s)).map((stop) => [stop.title, stop.type]))
      .toEqual([['Manuka Honey UMF 10+', 'shopping']])
    expect((await wishlist(request, s))[1]).toMatchObject({ status: 'scheduled' })

    // Grouped by day: Day 1, then the pocket list
    await page.getByRole('radio', { name: '依日程' }).click()
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText([/^Day 1/, /^口袋名單/])
    await shot(page, `${label}-picks-by-day`)
    await page.getByRole('radio', { name: '不分組' }).click()

    // 5. Back to the pocket list (with a confirmation): the stop is deleted
    await honey.getByRole('button', { name: '「Manuka Honey UMF 10+」的更多動作' }).click()
    await page.getByRole('menuitem', { name: '拉回口袋名單' }).click()
    await page
      .getByRole('dialog', { name: '把「Manuka Honey UMF 10+」拉回口袋名單？' })
      .getByRole('button', { name: '拉回' })
      .click()
    await expect(honey).toContainText('口袋名單')
    await expect(honey).not.toContainText('Day 1')
    await expect.poll(async () => (await dayOneStops(request, s)).length).toBe(0)
    expect((await wishlist(request, s))[1]).toMatchObject({ status: 'wish', stopId: null })

    // 6. Sort: newest (honey), price (Fergburger NZ$18 first), votes (honey has one)
    await page.getByRole('radio', { name: '價格' }).click()
    expect(await cardNames(page)).toEqual(['Fergburger', 'Manuka Honey UMF 10+'])
    await page.getByRole('radio', { name: '票數' }).click()
    expect(await cardNames(page)).toEqual(['Manuka Honey UMF 10+', 'Fergburger'])

    // 7. Filter: category and status chips
    await page.getByRole('radio', { name: '必吃' }).click()
    expect(await cardNames(page)).toEqual(['Fergburger'])
    await page.getByRole('radio', { name: '全部' }).click()
    const statusChips = page.getByRole('group', { name: '狀態' })
    await statusChips.getByRole('button', { name: '已排入' }).click()
    await expect(page.getByText('沒有符合篩選的項目。')).toBeVisible()
    await page.getByRole('button', { name: '清除篩選' }).click()
    await expect(page.locator('article[data-pick-id]')).toHaveCount(2)

    // The wall never scrolls sideways; columns follow the wall's width
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const lefts = await page
      .locator('article[data-pick-id]')
      .evaluateAll((list) => list.map((el) => Math.round(el.getBoundingClientRect().left)))
    expect(new Set(lefts).size).toBe(desktop ? 2 : 1)
    await shot(page, `${label}-picks-wall`)

    // 8. Edit: a photo through the media pipeline becomes the card's picture
    const ferg = card(page, 'Fergburger')
    const fergMenu = ferg.getByRole('button', { name: '「Fergburger」的更多動作' })
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '編輯' }).click()
    const edit = pane(page, desktop, '編輯必吃必買')
    await expect(edit.getByLabel('名稱')).toHaveValue('Fergburger')
    await edit
      .getByLabel('照片')
      .setInputFiles({ name: 'burger.png', mimeType: 'image/png', buffer: PNG })
    await expect(edit.getByRole('button', { name: '移除照片' })).toBeVisible({ timeout: 15_000 })
    await edit.getByRole('button', { name: '儲存' }).click()
    await expect(ferg.locator('img')).toHaveAttribute('src', /^blob:/)
    const withPhoto = (await wishlist(request, s)).find((i) => i.name === 'Fergburger')
    expect(withPhoto?.photoAttachmentId).toEqual(expect.any(String))

    // 9. Status: done and back, dropped and restored
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '標記完成（不記帳）' }).click()
    await expect(ferg).toContainText('已完成')
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '改回未完成' }).click()
    await expect(ferg).toContainText('口袋名單')
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '放棄' }).click()
    await expect(ferg).toContainText('放棄')
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '恢復' }).click()
    await expect(ferg).toContainText('口袋名單')
    expect((await wishlist(request, s)).find((i) => i.name === 'Fergburger')?.status).toBe('wish')

    // 10. 完成並記帳 (e5-t05): the 記一筆 form opens prefilled; cancelling leaves the status alone,
    // saving logs the expense (linked by wishlistItemId) and marks the pick done
    const fx = await request.put(`/api/trips/${s.tripId}/fx/overrides`, {
      headers: s.headers,
      data: { NZD: 0.91 },
    })
    expect(fx.ok()).toBe(true)
    const expenseSheet = page.getByRole('dialog', { name: '記一筆' })
    await fergMenu.click()
    await page.getByRole('menuitem', { name: '完成並記帳' }).click()
    await expect(expenseSheet).toBeVisible()
    await expect(expenseSheet.getByLabel('金額')).toHaveValue('18.00')
    await expenseSheet.getByRole('button', { name: '取消' }).click()
    await expect(expenseSheet).toBeHidden()
    await expect(ferg).toContainText('口袋名單')
    expect((await wishlist(request, s)).find((i) => i.name === 'Fergburger')?.status).toBe('wish')

    await ferg.getByRole('button', { name: 'Fergburger', exact: true }).click()
    const pickPane = pane(page, desktop, '必吃必買')
    await pickPane.getByRole('button', { name: '完成並記帳' }).click()
    await expect(expenseSheet).toBeVisible()
    await expect(expenseSheet.getByLabel('金額')).toHaveValue('18.00')
    await expect(expenseSheet.getByLabel('幣別')).toHaveValue('NZD')
    await expect(expenseSheet.getByLabel('說明')).toHaveValue('Fergburger')
    await expect(expenseSheet.getByRole('radio', { name: '餐飲' })).toHaveAttribute('aria-checked', 'true')
    await shot(page, `${label}-picks-done-expense`)
    await expenseSheet.getByRole('button', { name: '儲存' }).click()
    await expect(expenseSheet).toBeHidden()
    await expect(page.getByRole('status').filter({ hasText: '已記一筆 NZ$18.00' })).toBeVisible()
    await expect(ferg).toContainText('已完成')
    await expect
      .poll(async () => (await wishlist(request, s)).find((i) => i.name === 'Fergburger')?.status)
      .toBe('done')
    const listed = await request.get(`/api/trips/${s.tripId}/expenses`, { headers: s.headers })
    const { expenses } = (await listed.json()) as {
      expenses: { amountMinor: number; currency: string; category: string; note: string; wishlistItemId: string | null }[]
    }
    const fergId = (
      (await (await request.get(`/api/trips/${s.tripId}/wishlist`, { headers: s.headers })).json()) as {
        items: { id: string; name: string }[]
      }
    ).items.find((i) => i.name === 'Fergburger')!.id
    expect(expenses).toEqual([
      expect.objectContaining({
        amountMinor: 1800,
        currency: 'NZD',
        category: 'food',
        note: 'Fergburger',
        wishlistItemId: fergId,
      }),
    ])
  })
}

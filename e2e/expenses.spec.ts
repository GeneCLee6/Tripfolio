import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

// e7-t02 / e7-t08 walk-through: a trip with two members and a trip default rate NZD 0.91 → log
// NZD 45 for food in as few interactions as possible (counted) → the row shows NZ$45.00 and
// ≈ A$40.95 → log IDR 150000 split by shares (Mei 2) after typing the rate the server does not
// know → check the shares through the API → edit the note → delete → undo. Phone and desktop.
// Run against `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Seeded {
  tripId: string
  token: string
  geneId: string
  meiId: string
}

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(-1),
      endDate: inDays(5),
      tz: 'Pacific/Auckland',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const { trip, memberToken, member } = (await created.json()) as {
    trip: { id: string }
    memberToken: string
    member: { id: string }
  }
  const headers = { authorization: `Bearer ${memberToken}` }
  const mei = await request.post(`/api/trips/${trip.id}/members`, {
    headers,
    data: { name: 'Mei', color: '#B5654A' },
  })
  expect(mei.status()).toBe(201)
  const meiId = ((await mei.json()) as { member: { id: string } }).member.id
  const fx = await request.put(`/api/trips/${trip.id}/fx/overrides`, {
    headers,
    data: { NZD: 0.91 },
  })
  expect(fx.ok()).toBe(true)
  return { tripId: trip.id, token: memberToken, geneId: member.id, meiId }
}

/** Counts what a person would do: taps and one fill per field */
function counter() {
  let count = 0
  return {
    tap: async (locator: Locator) => {
      count += 1
      await locator.click()
    },
    fill: async (locator: Locator, value: string) => {
      count += 1
      await locator.fill(value)
    },
    get count() {
      return count
    },
  }
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`log, list, edit, delete and undo expenses (${label})`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    const { tripId, token, meiId } = await seed(request, `Expenses ${label}`)
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [tripId, token],
    )
    await page.goto(`/trips/${tripId}/expenses`)
    await expect(page.getByRole('heading', { name: '還沒有花費' })).toBeVisible()
    await shot(page, `expenses-empty-${label}`)

    const desktop = label === 'desktop'
    const addButton = desktop
      ? page.getByRole('main').getByRole('button', { name: '記一筆' }).first()
      : page.getByRole('navigation', { name: '旅程導覽' }).getByRole('button', { name: '記一筆' })
    const sheet = page.getByRole('dialog', { name: '記一筆' })

    // 1. NZD 45, food, save: the defaults (NZD, I paid, everyone equally) are right
    const steps = counter()
    await steps.tap(addButton)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByLabel('幣別')).toHaveValue('NZD')
    await expect(sheet.getByLabel('金額')).toBeFocused()
    await steps.fill(sheet.getByLabel('金額'), '45')
    await expect(sheet.getByText(/≈ AU?\$40\.95/)).toBeVisible()
    await expect(sheet.getByText('匯率 0.91 · 旅程預設')).toBeVisible()
    await steps.tap(sheet.getByRole('radio', { name: '餐飲' }))
    await shot(page, `expenses-sheet-${label}`)
    await steps.tap(sheet.getByRole('button', { name: '儲存' }))
    await expect(sheet).toBeHidden()
    expect(steps.count).toBeLessThanOrEqual(6)
    test.info().annotations.push({ type: 'interactions', description: String(steps.count) })
    await expect(page.getByRole('status').filter({ hasText: '已記一筆 NZ$45.00' })).toBeVisible()

    const rows = page.locator('[data-expense-id]')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('NZ$45.00')
    await expect(rows.first()).toContainText(/≈ AU?\$40\.95/)
    await expect(rows.first()).toContainText('Gene 付 · 全員平分')

    // 2. IDR 150000 for shopping, split by shares with Mei counting twice; no IDR rate is known
    await addButton.click()
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('幣別').selectOption('IDR')
    await sheet.getByLabel('金額').fill('150000')
    await sheet.getByRole('radio', { name: '購物' }).click()
    await expect(sheet.getByText('找不到這天的 IDR 匯率')).toBeVisible()
    await sheet.getByLabel('匯率（1 IDR ＝ ? AUD）').fill('0.000095')
    await sheet.getByRole('button', { name: '改分法' }).click()
    await sheet.getByRole('radio', { name: '份數' }).click()
    await sheet.getByLabel('Mei 的份數').fill('2')
    await expect(sheet.getByRole('list', { name: '每人分到' })).toContainText('100,000')
    await shot(page, `expenses-shares-${label}`)
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(sheet).toBeHidden()
    await expect(rows).toHaveCount(2)

    const listed = await request.get(`/api/trips/${tripId}/expenses`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const { expenses } = (await listed.json()) as {
      expenses: {
        id: string
        currency: string
        baseMinor: number
        fxSource: string
        splitMethod: string
        shares: { memberId: string; weight: number | null; shareMinor: number }[]
      }[]
    }
    const idr = expenses.find((e) => e.currency === 'IDR')!
    expect(idr).toMatchObject({ baseMinor: 1425, fxSource: 'manual', splitMethod: 'shares' })
    expect(idr.shares.map((s) => s.shareMinor).sort((a, b) => a - b)).toEqual([475, 950])
    expect(idr.shares.find((s) => s.memberId === meiId)).toMatchObject({
      weight: 2,
      shareMinor: 950,
    })
    const nzd = expenses.find((e) => e.currency === 'NZD')!
    expect(nzd).toMatchObject({ baseMinor: 4095, fxSource: 'trip' })

    // 3. Edit the note
    const idrRow = page.locator(`[data-expense-id="${idr.id}"]`)
    await expect(idrRow).toContainText('Gene 付 · 2 人 · 份數')
    await idrRow.click()
    const editor = page.getByRole('dialog', { name: '修改花費' })
    await expect(editor).toBeVisible()
    await editor.getByLabel('說明').fill('Warung dinner')
    await editor.getByRole('button', { name: '儲存' }).click()
    await expect(editor).toBeHidden()
    await expect(idrRow).toContainText('Warung dinner')

    // 4. Delete (confirmed), then undo from the bar
    await idrRow.click()
    await editor.getByRole('button', { name: '刪除' }).click()
    const confirm = page.getByRole('dialog', { name: '刪除這筆花費？' })
    await confirm.getByRole('button', { name: '刪除' }).click()
    await expect(idrRow).toHaveCount(0)
    const bar = page.getByRole('status').filter({ hasText: '已刪除一筆花費' })
    await bar.getByRole('button', { name: '復原' }).click()
    await expect(idrRow).toContainText('Warung dinner')
    await shot(page, `expenses-list-${label}`)
  })
}

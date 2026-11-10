import { readFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// e7-t06 / e7-t07 walk-through: a trip with three members and five AUD expenses over three days
// (seeded through the API) → the statistics page's totals match GET /expenses/summary in all three
// views → the CSV download parses back into the same rows (BOM, quoted fields, CRLF), with the
// pool and settlement blocks when asked → edit one expense twice → the change log shows two edits
// → restore the first version → the amount goes back → delete it → it is listed under 已刪除 →
// undelete. Phone and desktop. Run against `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'zh-TW', acceptDownloads: true })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Seeded {
  tripId: string
  token: string
  ids: { gene: string; mei: string; lin: string }
  expenseIds: string[]
}

/** A tiny RFC 4180 reader (CRLF rows, quoted fields) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += ch
  }
  return rows
}

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Australia',
      startDate: inDays(-2),
      endDate: inDays(2),
      tz: 'UTC',
      style: 'city',
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
  const add = async (memberName: string, color: string) => {
    const res = await request.post(`/api/trips/${trip.id}/members`, {
      headers,
      data: { name: memberName, color },
    })
    expect(res.status()).toBe(201)
    return ((await res.json()) as { member: { id: string } }).member.id
  }
  const mei = await add('Mei', '#B5654A')
  const lin = await add('Lin', '#5B7B4A')
  const ids = { gene: member.id, mei, lin }
  const everyone = [{ memberId: ids.gene }, { memberId: mei }, { memberId: lin }]
  const expenses = [
    { date: inDays(-2), category: 'food', amountMinor: 3000, payerMemberId: ids.gene, note: 'Breakfast', participants: everyone },
    { date: inDays(-2), category: 'fuel', amountMinor: 6000, payerMemberId: mei, note: 'Fuel', participants: everyone },
    { date: inDays(-1), category: 'tickets', amountMinor: 4500, payerMemberId: lin, note: 'Museum', participants: [{ memberId: ids.gene }, { memberId: lin }] },
    { date: inDays(0), category: 'food', amountMinor: 1500, payerMemberId: ids.gene, note: 'Pie, "hot"', participants: everyone },
    { date: inDays(0), category: 'shopping', amountMinor: 2000, payerMemberId: mei, note: 'Gifts', participants: [{ memberId: mei }] },
  ]
  const expenseIds: string[] = []
  for (const body of expenses) {
    const res = await request.post(`/api/trips/${trip.id}/expenses`, {
      headers,
      data: { currency: 'AUD', splitMethod: 'equal', ...body },
    })
    expect(res.status()).toBe(201)
    expenseIds.push(((await res.json()) as { expense: { id: string } }).expense.id)
  }
  const pool = await request.post(`/api/trips/${trip.id}/pool/contributions`, {
    headers,
    data: { memberId: lin, amountMinor: 5000, currency: 'AUD', date: inDays(-2), note: 'kitty' },
  })
  expect(pool.status()).toBe(201)
  return { tripId: trip.id, token: memberToken, ids, expenseIds }
}

interface Summary {
  rows: { key: string; baseMinor: number; count: number; paidMinor?: number; shareMinor?: number }[]
  totalMinor: number
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`statistics, CSV export, change log and restore (${label})`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    const seeded = await seed(request, `Stats ${label}`)
    const { tripId, token, ids } = seeded
    const headers = { authorization: `Bearer ${token}` }
    const summary = async (by: string): Promise<Summary> => {
      const res = await request.get(`/api/trips/${tripId}/expenses/summary?by=${by}`, { headers })
      expect(res.ok()).toBe(true)
      return (await res.json()) as Summary
    }
    await page.addInitScript(
      ([id, value]) =>
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
      [tripId, token],
    )

    // 0. The list page links to both new pages
    await page.goto(`/trips/${tripId}/expenses`)
    await page.getByRole('main').getByRole('link', { name: '統計' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/expenses/stats$`))
    await expect(page.getByRole('heading', { level: 1, name: '統計' })).toBeVisible()

    // 1. Key numbers and the day view match the server's summary
    const byDay = await summary('day')
    expect(byDay.totalMinor).toBe(17000)
    const kpis = page.locator('[data-kpis]')
    await expect(kpis).toContainText(/總花費\s*AU?\$170\.00/)
    await expect(kpis).toContainText(/每人平均\s*AU?\$56\.67/)
    await expect(page.getByText('尚未設定預算')).toBeVisible()
    const bars = page.locator('[data-day]')
    await expect(bars).toHaveCount(5) // the trip's five days, two of them without expenses
    for (const row of byDay.rows)
      await expect(page.locator(`[data-day="${row.key}"]`)).toHaveAttribute(
        'data-amount',
        String(row.baseMinor),
      )
    await page.locator(`[data-day="${inDays(-2)}"]`).hover()
    await expect(page.getByText(/AU?\$90\.00 · 2 筆/)).toBeVisible()
    await shot(page, `stats-day-${label}`)

    // 2. By category: largest first, percentages adding up to 100
    await page.getByRole('radio', { name: '依類別' }).click()
    const categories = page.locator('[data-bar]')
    await expect(categories).toHaveCount(4)
    const byCategory = await summary('category')
    expect(await categories.evaluateAll((els) => els.map((el) => el.getAttribute('data-bar')))).toEqual(
      [...byCategory.rows]
        .sort((a, b) => b.baseMinor - a.baseMinor || a.key.localeCompare(b.key))
        .map((r) => r.key),
    )
    await expect(categories.first()).toContainText(/加油\s*AU?\$60\.00\s*35%/)
    const percents = await categories.evaluateAll((els) =>
      els.map((el) => Number(/(\d+)%/.exec(el.textContent ?? '')?.[1] ?? 0)),
    )
    expect(percents.reduce((a, b) => a + b, 0)).toBe(100)
    await shot(page, `stats-category-${label}`)

    // 3. By person: paid vs share straight from the summary
    await page.getByRole('radio', { name: '依人' }).click()
    const byMember = await summary('member')
    for (const row of byMember.rows) {
      const tr = page.locator(`[data-member="${row.key}"]`)
      await expect(tr.locator('[data-paid]')).toHaveAttribute('data-paid', String(row.paidMinor))
      await expect(tr.locator('[data-share]')).toHaveAttribute('data-share', String(row.shareMinor))
    }
    await expect(page.locator(`[data-member="${ids.mei}"]`)).toContainText(/Mei\s*AU?\$80\.00/)
    await expect(page.getByRole('figure', { name: '分攤比例' })).toContainText('Lin')
    await shot(page, `stats-member-${label}`)

    // 4. CSV: BOM, header, five rows oldest first, quotes and commas intact
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '匯出 CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe(`Stats ${label}.csv`)
    const bytes = await readFile((await download.path())!)
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = bytes.toString('utf8').slice(1)
    expect(text).toContain('\r\n')
    const rows = parseCsv(text)
    expect(rows[0]).toEqual([
      '日期', '類別', '說明', '付款人', '金額', '幣別', '匯率', '主幣金額', '主幣別', '分給誰', '每人分攤', '行程點', '收據',
    ])
    expect(rows).toHaveLength(6)
    expect(rows.slice(1).map((r) => r[0])).toEqual([inDays(-2), inDays(-2), inDays(-1), inDays(0), inDays(0)])
    const pie = rows.find((r) => r[2] === 'Pie, "hot"')!
    expect(pie.slice(3, 11)).toEqual(['Gene', '15.00', 'AUD', '1', '15.00', 'AUD', 'Gene; Mei; Lin', 'Gene 5.00; Mei 5.00; Lin 5.00'])
    expect(rows.slice(1).reduce((sum, r) => sum + Math.round(Number(r[7]) * 100), 0)).toBe(byDay.totalMinor)

    await page.getByLabel('含公基金與結算').check()
    const [withExtras] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: '匯出 CSV' }).click(),
    ])
    const extra = parseCsv((await readFile((await withExtras.path())!)).toString('utf8').slice(1))
    const poolAt = extra.findIndex((r) => r[0] === '公基金出資')
    expect(poolAt).toBe(7)
    expect(extra[poolAt + 2]).toEqual([inDays(-2), 'Lin', '50.00', 'AUD', '1', '50.00', 'AUD', 'kitty'])
    expect(extra.some((r) => r[0] === '結算紀錄')).toBe(true)

    // 5. Edit the breakfast twice, then see two edits in the change log
    const breakfast = seeded.expenseIds[0]
    for (const amountMinor of [3600, 4200]) {
      const res = await request.patch(`/api/trips/${tripId}/expenses/${breakfast}`, {
        headers,
        data: { amountMinor },
      })
      expect(res.ok()).toBe(true)
    }
    await page.getByRole('main').getByRole('link', { name: '修改紀錄' }).click()
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/expenses/history$`))
    await expect(page.locator('[data-action="update"]')).toHaveCount(2)
    await expect(page.locator('[data-action="update"]').first()).toContainText(
      /金額：AU?\$36\.00 → AU?\$42\.00/,
    )
    await expect(page.locator('[data-action="create"]')).toHaveCount(6) // five expenses, one contribution
    await shot(page, `history-log-${label}`)

    // 6. Restore the first version from the expense's version sheet
    await page.getByRole('button', { name: '看「Breakfast」的版本' }).first().click()
    const sheet = page.getByRole('dialog', { name: '這筆的修改紀錄' })
    await expect(sheet.locator('[data-version]')).toHaveCount(3)
    await sheet.getByRole('button', { name: '還原到第 1 版' }).click()
    const confirm = page.getByRole('dialog', { name: '還原到第 1 版？' })
    await expect(confirm).toContainText(/AU?\$30\.00/)
    await shot(page, `history-restore-${label}`)
    await confirm.getByRole('button', { name: '還原到這個版本' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已還原到第 1 版' })).toBeVisible()
    await expect(sheet.locator('[data-version]')).toHaveCount(4)
    const restored = await request.get(`/api/trips/${tripId}/expenses/${breakfast}`, { headers })
    expect(((await restored.json()) as { expense: { amountMinor: number } }).expense.amountMinor).toBe(3000)
    await sheet.getByRole('button', { name: '關閉' }).click()
    await expect(page.locator('[data-action="restore"]')).toHaveCount(1)

    // 7. Delete it from the list (the row menu also offers the change log), then undelete
    await page.goto(`/trips/${tripId}/expenses`)
    const row = page.locator(`[data-expense-id="${breakfast}"]`)
    await row.click({ button: 'right' })
    const menu = page.getByRole('dialog', { name: '刪除這筆花費？' })
    await expect(menu.getByRole('button', { name: '查看修改紀錄' })).toBeVisible()
    await menu.getByRole('button', { name: '刪除' }).click()
    await expect(row).toHaveCount(0)
    await page.goto(`/trips/${tripId}/expenses/history`)
    const deleted = page.getByRole('region', { name: '已刪除的花費' })
    await expect(deleted.locator(`[data-deleted-id="${breakfast}"]`)).toContainText('Breakfast')
    await expect(page.locator('[data-action="delete"]')).toHaveCount(1)
    await shot(page, `history-deleted-${label}`)
    await deleted.getByRole('button', { name: '取消刪除「Breakfast」' }).click()
    await expect(page.getByRole('status').filter({ hasText: '已取消刪除' })).toBeVisible()
    await expect(deleted.locator('[data-deleted-id]')).toHaveCount(0)
    const back = await request.get(`/api/trips/${tripId}/expenses/${breakfast}`, { headers })
    expect(((await back.json()) as { expense: { deletedAt: string | null } }).expense.deletedAt).toBeNull()
  })
}

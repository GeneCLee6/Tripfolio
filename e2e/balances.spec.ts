import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import type { BalancesResponse } from '../shared/api/expenses.ts'
import { formatMoney } from '../shared/i18n/format.ts'

// Balances, settlements and the shared pool (e7-t04, e7-t05) against a real Worker and local D1.
// A trip in AUD with three members, trip default rates for NZD and TWD, three expenses (one paid by
// the pool) and two pool contributions, all through the API. The page must show exactly what
// GET /balances says; a partial settlement shrinks the suggestion and appears in the log; switching
// the refund mode changes the refunds; deleting the settlement puts everything back. The page is
// mounted at /trips/:id/expenses/balances (the coordinator wires the route). Phone and desktop.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const BASE = 'AUD'

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
const money = (minor: number) => formatMoney(minor, BASE, 'zh-TW')
const signed = (minor: number) =>
  minor > 0 ? `+${money(minor)}` : minor < 0 ? `−${money(-minor)}` : money(0)

async function seed(request: APIRequestContext, name: string) {
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate: inDays(-2),
      endDate: inDays(8),
      tz: 'Pacific/Auckland',
      baseCurrency: BASE,
      secondaryCurrency: 'TWD',
      localCurrencies: ['NZD'],
      coverColor: '#0F6E74',
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const { trip, memberToken, member } = (await created.json()) as {
    trip: { id: string }
    memberToken: string
    member?: { id: string }
  }
  const headers = { authorization: `Bearer ${memberToken}` }
  const api = (path: string) => `/api/trips/${trip.id}${path}`
  const ok = async (response: Promise<import('@playwright/test').APIResponse>) => {
    const r = await response
    expect(r.ok(), `${r.url()} ${r.status()} ${await r.text()}`).toBe(true)
    return r.json()
  }

  const detail = await ok(request.get(api(''), { headers }))
  const geneId: string = member?.id ?? detail.me.id
  const mei = (await ok(
    request.post(api('/members'), { headers, data: { name: 'Mei', color: '#B5654A' } }),
  )) as { member: { id: string } }
  const jo = (await ok(
    request.post(api('/members'), { headers, data: { name: 'Jo', color: '#4C6A92' } }),
  )) as { member: { id: string } }
  const ids = { gene: geneId, mei: mei.member.id, jo: jo.member.id }
  const everyone = [ids.gene, ids.mei, ids.jo].map((memberId) => ({ memberId }))

  await ok(request.put(api('/fx/overrides'), { headers, data: { NZD: 0.91, TWD: 0.048 } }))
  const expense = (data: Record<string, unknown>) =>
    ok(
      request.post(api('/expenses'), {
        headers,
        data: { splitMethod: 'equal', participants: everyone, date: inDays(0), ...data },
      }),
    )
  await expense({ amountMinor: 30000, currency: 'NZD', category: 'food', payerMemberId: ids.gene, note: 'Fergburger' })
  await expense({ amountMinor: 9000, currency: 'AUD', category: 'lodging', payerMemberId: ids.mei, note: 'Camp' })
  await expense({ amountMinor: 15000, currency: 'NZD', category: 'fuel', pool: true, note: 'Fuel' })
  await ok(
    request.post(api('/pool/contributions'), {
      headers,
      data: { memberId: ids.gene, amountMinor: 20000, currency: 'NZD' },
    }),
  )
  await ok(
    request.post(api('/pool/contributions'), {
      headers,
      data: { memberId: ids.jo, amountMinor: 10000, currency: 'NZD' },
    }),
  )

  const balances = async () => (await ok(request.get(api('/balances'), { headers }))) as BalancesResponse
  return { tripId: trip.id, memberToken, ids, balances }
}

for (const width of [375, 1440]) {
  test(`${width}px: balances, partial settle, refund mode, delete`, async ({ browser, request }) => {
    const { tripId, memberToken, ids, balances } = await seed(request, `結算測試 ${width}`)
    const names: Record<string, string> = { [ids.gene]: 'Gene', [ids.mei]: 'Mei', [ids.jo]: 'Jo' }
    const context = await browser.newContext({ locale: 'zh-TW', viewport: { width, height: 900 } })
    await context.addInitScript(
      (value) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify(value)),
      { [tripId]: memberToken },
    )
    const page = await context.newPage()
    await page.goto(`/trips/${tripId}/expenses/balances`)
    await expect(page.getByRole('heading', { level: 1, name: '餘額與結算' })).toBeVisible()

    const people = page.getByRole('list', { name: '每個人' })
    const suggestions = page.getByRole('list', { name: '結算建議' })
    const log = page.getByRole('list', { name: '結算紀錄' })
    const refunds = page.getByRole('list', { name: '預估退還' })

    /** Every figure on the page equals GET /balances */
    const matchesApi = async (data: BalancesResponse) => {
      await expect(people.getByRole('listitem')).toHaveCount(data.balances.length)
      for (const row of data.balances) {
        const item = people.getByRole('listitem').filter({ hasText: names[row.memberId] })
        await expect(item).toContainText(signed(row.netMinor))
        await expect(item).toContainText(`付了 ${money(row.paidMinor)} · 應分攤 ${money(row.owedMinor)}`)
        await expect(item).toContainText(row.netMinor > 0 ? '應收' : row.netMinor < 0 ? '應付' : '已打平')
      }
      const mine = data.balances.find((row) => row.memberId === ids.gene)!
      await expect(page.getByRole('region', { name: '我的餘額' })).toContainText(signed(mine.netMinor))
      await expect(page.getByRole('region', { name: '公基金結餘' })).toContainText(money(data.poolBalanceMinor))
      await expect(suggestions.getByRole('listitem')).toHaveCount(data.suggested.length)
      for (const transfer of data.suggested) {
        await expect(
          suggestions.getByRole('listitem', {
            name: `${names[transfer.from]} 付給 ${names[transfer.to]} ${money(transfer.amountMinor)}`,
          }),
        ).toBeVisible()
      }
      for (const row of data.balances.filter((r) => r.poolInMinor > 0)) {
        await expect(refunds.getByRole('listitem').filter({ hasText: names[row.memberId] })).toContainText(
          money(Math.abs(row.poolBackMinor)),
        )
      }
    }

    const before = await balances()
    expect(before.suggested.length).toBeGreaterThan(0)
    expect(before.poolBalanceMinor).toBeGreaterThan(0)
    await matchesApi(before)
    // The secondary currency line (trip default rate for TWD)
    await expect(page.getByRole('region', { name: '我的餘額' })).toContainText('≈')
    await expect(page.getByText('還沒有結算紀錄。')).toBeVisible()
    await shot(page, `${width}-balances`)

    // Settle the first suggestion partially: half of it, in cash
    const first = before.suggested[0]
    const half = Math.floor(first.amountMinor / 2)
    await suggestions
      .getByRole('button', { name: `記錄 ${names[first.from]} 付給 ${names[first.to]}` })
      .click()
    const sheet = page.getByRole('dialog', { name: '記錄結清' })
    await expect(sheet).toBeVisible()
    const amount = sheet.getByLabel('結清金額')
    await expect(amount).toHaveValue((first.amountMinor / 100).toFixed(2))
    // More than suggested is refused
    await amount.fill(((first.amountMinor + 100) / 100).toFixed(2))
    await sheet.getByRole('button', { name: '記為已結清' }).click()
    await expect(sheet).toContainText('不能超過建議的')
    await amount.fill((half / 100).toFixed(2))
    await sheet.getByRole('radio', { name: '現金' }).click()
    await sheet.getByLabel('備註').fill('ATM')
    await shot(page, `${width}-settle-sheet`)
    await sheet.getByRole('button', { name: '記為已結清' }).click()
    await expect(sheet).toBeHidden()
    await expect(page.getByText(`已記錄 ${names[first.from]} 付給 ${names[first.to]} ${money(half)}`)).toBeVisible()

    await expect(log.getByRole('listitem')).toHaveCount(1)
    await expect(log.getByRole('listitem').first()).toContainText('現金')
    await expect(log.getByRole('listitem').first()).toContainText('ATM')
    const afterSettle = await balances()
    const same = afterSettle.suggested.find((s) => s.from === first.from && s.to === first.to)
    expect(same?.amountMinor).toBe(first.amountMinor - half)
    await matchesApi(afterSettle)
    await shot(page, `${width}-after-settle`)

    // Refund mode: by contribution → equally; the refunds change and still match the API
    const pool = page.getByRole('region', { name: '公基金結餘' })
    await expect(pool.getByRole('radio', { name: '按出資比例' })).toHaveAttribute('aria-checked', 'true')
    const backBefore = afterSettle.balances.map((row) => row.poolBackMinor)
    await pool.getByRole('radio', { name: '平均' }).click()
    await expect(page.getByText('結餘改為「平均」退還')).toBeVisible()
    await expect(pool.getByRole('radio', { name: '平均' })).toHaveAttribute('aria-checked', 'true')
    const equal = await balances()
    expect(equal.refundMode).toBe('equal')
    expect(equal.balances.map((row) => row.poolBackMinor)).not.toEqual(backBefore)
    await matchesApi(equal)
    await expect(pool).toContainText('平均分回')
    await shot(page, `${width}-equal-refund`)

    // Delete the settlement (with a confirmation): the log empties and the balances go back
    await log
      .getByRole('button', { name: `刪除 ${names[first.from]} 付給 ${names[first.to]} 的結算` })
      .click()
    const confirm = page.getByRole('dialog', { name: '刪除這筆結算？' })
    await confirm.getByRole('button', { name: '刪除' }).click()
    await expect(page.getByText('已刪除結算紀錄')).toBeVisible()
    await expect(page.getByText('還沒有結算紀錄。')).toBeVisible()
    const restored = await balances()
    expect(restored.balances.map((row) => row.netMinor)).not.toEqual(equal.balances.map((row) => row.netMinor))
    await matchesApi(restored)

    // A contribution through the sheet: add (Mei, A$50), edit (A$60), delete
    const contributions = pool.getByRole('list', { name: '出資紀錄' })
    await expect(contributions.getByRole('listitem')).toHaveCount(2)
    await pool.getByRole('button', { name: '加一筆出資' }).click()
    const add = page.getByRole('dialog', { name: '加一筆出資' })
    await add.getByLabel('出資的人').selectOption({ label: 'Mei' })
    await add.getByLabel('幣別').selectOption('AUD')
    await add.getByLabel('金額').fill('50')
    await add.getByRole('button', { name: '儲存' }).click()
    await expect(add).toBeHidden()
    await expect(contributions.getByRole('listitem')).toHaveCount(3)
    await expect(pool).toContainText(money(restored.poolBalanceMinor + 5000))
    await matchesApi(await balances())
    await pool.getByRole('button', { name: '編輯 Mei 的出資' }).click()
    const edit = page.getByRole('dialog', { name: '編輯出資' })
    await expect(edit.getByLabel('金額')).toHaveValue('50.00')
    await edit.getByLabel('金額').fill('60')
    await edit.getByRole('button', { name: '儲存' }).click()
    await expect(edit).toBeHidden()
    await expect(pool).toContainText(money(restored.poolBalanceMinor + 6000))
    await pool.getByRole('button', { name: '刪除 Mei 的出資' }).click()
    await page.getByRole('dialog', { name: '刪除這筆出資？' }).getByRole('button', { name: '刪除' }).click()
    await expect(contributions.getByRole('listitem')).toHaveCount(2)
    await matchesApi(await balances())

    // No horizontal scroll at this width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await context.close()
  })
}

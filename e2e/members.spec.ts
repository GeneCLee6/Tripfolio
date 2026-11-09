import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Members, invite links and roles (e1-t03, e1-t04) against a real Worker and local D1: the owner
// creates an invite (the link is shown once), a second browser joins as Mia, the owner makes her a
// viewer, her editing controls go away and the API refuses her writes; the owner adds, renames and
// removes a member by hand, then revokes the invite and the link stops working. Phone and desktop.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function createTripViaApi(request: APIRequestContext, name: string) {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Bali',
      startDate: inDays(20),
      endDate: inDays(25),
      tz: 'Asia/Makassar',
      coverColor: '#B5654A',
      style: 'private-driver',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as { trip: { id: string }; memberToken: string }
}

async function newPage(browser: Browser, width: number, tokens?: Record<string, string>) {
  const context = await browser.newContext({
    locale: 'zh-TW',
    viewport: { width, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  if (tokens) {
    await context.addInitScript(
      (value) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify(value)),
      tokens,
    )
  }
  return { context, page: await context.newPage() }
}

const memberRow = (page: Page, name: string) =>
  page.getByRole('list', { name: '旅伴' }).getByRole('listitem').filter({ hasText: name })

for (const width of [375, 1440]) {
  test(`${width}px: invite, join, roles, rename, remove, revoke`, async ({ browser, request }) => {
    const tripName = `成員測試 ${width}`
    const { trip, memberToken } = await createTripViaApi(request, tripName)
    const owner = await newPage(browser, width, { [trip.id]: memberToken })
    const o = owner.page

    // The owner creates an invite: the link is in a dialog, once
    await o.goto(`/trips/${trip.id}/settings`)
    await expect(memberRow(o, 'Gene')).toContainText('擁有者')
    await expect(o.getByText('目前沒有有效的邀請連結。')).toBeVisible()
    await o.getByRole('button', { name: '產生邀請連結' }).click()
    const created = o.getByRole('dialog', { name: '邀請連結已產生' })
    await expect(created).toBeVisible()
    await expect(created).toContainText('只會顯示這一次')
    const link = await created.getByLabel('邀請連結').inputValue()
    expect(link).toMatch(/\/join\/[A-Za-z0-9_-]{22}$/)
    const inviteToken = link.split('/join/')[1]
    await created.getByRole('button', { name: '複製連結' }).click()
    await expect(o.getByText(/已複製邀請連結|已選取連結/)).toBeVisible()
    await shot(o, `${width}-invite-created`)
    await created.getByRole('button', { name: '完成' }).click()
    await expect(created).toBeHidden()
    // Closed, the token is nowhere on the page; the list only says when it was made
    expect(await o.content()).not.toContain(inviteToken)
    await expect(o.getByRole('list', { name: '邀請連結' }).getByRole('listitem')).toHaveCount(1)

    // Mia opens the link in another browser and creates herself
    const guest = await newPage(browser, width)
    const m = guest.page
    await m.goto(`/join/${inviteToken}`)
    await expect(m.getByRole('heading', { name: '你是哪一位？' })).toBeVisible()
    await expect(m.getByText(tripName)).toBeVisible()
    await m.getByRole('radio', { name: '我不在名單上' }).click()
    await m.getByLabel('你的名字').fill('Mia')
    await shot(m, `${width}-join`)
    await m.getByRole('button', { name: '加入旅程' }).click()
    await expect(m).toHaveURL(new RegExp(`/trips/${trip.id}$`))
    await expect(m.getByRole('heading', { level: 1, name: tripName })).toBeVisible()
    await expect(m.getByText('2 位旅伴')).toBeVisible()
    const miaToken = await m.evaluate(
      (id) => JSON.parse(localStorage.getItem('tripfolio.memberTokens') ?? '{}')[id] as string,
      trip.id,
    )
    expect(miaToken).toMatch(/^[A-Za-z0-9_-]{22}$/)
    await expect(m.getByRole('button', { name: '編輯旅程' })).toBeVisible()

    // 「這不是我」 offers the link this tab joined with
    await m.getByRole('link', { name: /Gene.*Mia|2 位旅伴/ }).click()
    await expect(m).toHaveURL(/\/settings$/)
    await expect(memberRow(m, 'Mia')).toContainText('你')
    await m.getByRole('button', { name: '這不是我' }).click()
    const identity = m.getByRole('dialog', { name: '換成另一位旅伴' })
    await identity.getByRole('button', { name: '用加入時的邀請連結重新選' }).click()
    await expect(m).toHaveURL(new RegExp(`/join/${inviteToken}$`))
    await expect(m.getByText('這台裝置已經加入過這趟旅程。')).toBeVisible()
    await expect(m.getByRole('radio', { name: /Mia/ })).toBeVisible()
    await m.getByRole('link', { name: '打開旅程' }).click()
    await expect(m.getByRole('heading', { level: 1, name: tripName })).toBeVisible()

    // The owner sees Mia and makes her a viewer
    await o.reload()
    await expect(memberRow(o, 'Mia')).toContainText('編輯者')
    await o.getByRole('button', { name: '編輯 Mia' }).click()
    const edit = o.getByRole('dialog', { name: '編輯旅伴' })
    await edit.getByLabel('角色').selectOption('viewer')
    await shot(o, `${width}-member-edit`)
    await edit.getByRole('button', { name: '儲存' }).click()
    await expect(o.getByText('已更新 Mia')).toBeVisible()
    await expect(memberRow(o, 'Mia')).toContainText('檢視者')

    // Mia's page still thinks she is an editor: the API refuses the write
    await m.getByRole('button', { name: '編輯旅程' }).click()
    await m.getByLabel('旅程名稱').fill('Mia 改的名字')
    await m.getByRole('button', { name: '儲存' }).click()
    await expect(m.getByText('你沒有權限做這件事。')).toBeVisible()
    await shot(m, `${width}-viewer-refused`)
    const refused = await request.patch(`/api/trips/${trip.id}`, {
      headers: { authorization: `Bearer ${miaToken}` },
      data: { name: 'nope' },
    })
    expect(refused.status()).toBe(403)

    // Once reloaded, the editing controls are gone
    await m.goto(`/trips/${trip.id}`)
    await expect(m.getByRole('heading', { level: 1, name: tripName })).toBeVisible()
    await expect(m.getByRole('button', { name: '編輯旅程' })).toHaveCount(0)
    await m.goto(`/trips/${trip.id}/settings`)
    await expect(m.getByText('你是檢視者，只能查看這趟旅程。')).toBeVisible()
    await expect(m.getByRole('button', { name: '編輯旅程' })).toHaveCount(0)
    await expect(m.getByRole('button', { name: '新增旅伴' })).toHaveCount(0)
    await expect(m.getByRole('button', { name: '產生邀請連結' })).toHaveCount(0)
    await expect(m.getByRole('button', { name: '編輯 Gene' })).toHaveCount(0)
    await expect(m.locator('body')).toHaveJSProperty('scrollWidth', width)
    await shot(m, `${width}-viewer-settings`)

    // The owner adds someone by hand, renames and removes them
    await o.getByRole('button', { name: '新增旅伴' }).click()
    const add = o.getByRole('dialog', { name: '新增旅伴' })
    await add.getByLabel('名字').fill('Leo')
    await add.getByRole('button', { name: '新增旅伴' }).click()
    await expect(memberRow(o, 'Leo')).toContainText('編輯者')
    await o.getByRole('button', { name: '編輯 Leo' }).click()
    await o.getByRole('dialog', { name: '編輯旅伴' }).getByLabel('名字').fill('Leon')
    await o.getByRole('dialog', { name: '編輯旅伴' }).getByRole('button', { name: '儲存' }).click()
    await expect(memberRow(o, 'Leon')).toBeVisible()
    await o.getByRole('button', { name: '編輯 Leon' }).click()
    await o.getByRole('dialog', { name: '編輯旅伴' }).getByRole('button', { name: '移除' }).click()
    await o.getByRole('dialog', { name: '移除 Leon？' }).getByRole('button', { name: '移除' }).click()
    await expect(o.getByText('已移除 Leon')).toBeVisible()
    await expect(memberRow(o, 'Leon')).toHaveCount(0)
    // Nobody can remove the owner: no remove button on the owner's own dialog
    await o.getByRole('button', { name: '編輯 Gene' }).click()
    const self = o.getByRole('dialog', { name: '編輯旅伴' })
    await expect(self.getByRole('button', { name: '移除' })).toHaveCount(0)
    await expect(self.getByText('擁有者的角色不能更改。')).toBeVisible()
    await self.getByRole('button', { name: '取消' }).click()
    await expect(o.locator('body')).toHaveJSProperty('scrollWidth', width)
    await shot(o, `${width}-owner-settings`)

    // Revoking the invite kills the link
    await o.getByRole('button', { name: /^撤銷 .* 建立的邀請連結$/ }).click()
    await expect(o.getByText('邀請連結已撤銷')).toBeVisible()
    await expect(o.getByText('目前沒有有效的邀請連結。')).toBeVisible()
    await m.goto(`/join/${inviteToken}`)
    await expect(m.getByRole('heading', { name: '邀請連結無效' })).toBeVisible()

    await guest.context.close()
    await owner.context.close()
  })
}

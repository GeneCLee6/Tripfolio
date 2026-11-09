import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'

// Share links (e1-t05) against a real Worker and local D1: the owner creates a link with money
// hidden (the URL is shown once), a fresh browser opens /s/<token> and sees the trip, the owner
// revokes it and the page says the link is no longer valid. An editor who joined through an invite
// gets no share controls. Phone and desktop.

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

/** An editor: an invite from the owner, joined as a new member */
async function joinAsEditor(request: APIRequestContext, tripId: string, ownerToken: string) {
  const invite = await request.post(`/api/trips/${tripId}/invites`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  expect(invite.status()).toBe(201)
  const { inviteToken } = (await invite.json()) as { inviteToken: string }
  const joined = await request.post(`/api/join/${inviteToken}`, {
    data: { name: 'Mia', color: '#B5654A' },
  })
  expect(joined.ok()).toBe(true)
  return ((await joined.json()) as { memberToken: string }).memberToken
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

for (const width of [375, 1440]) {
  test(`${width}px: create a share link, open it, revoke it; editors cannot`, async ({
    browser,
    request,
  }) => {
    const tripName = `分享測試 ${width}`
    const { trip, memberToken } = await createTripViaApi(request, tripName)
    const owner = await newPage(browser, width, { [trip.id]: memberToken })
    const o = owner.page
    const section = o.getByRole('region', { name: '分享連結' })

    await o.goto(`/trips/${trip.id}/settings`)
    await expect(section.getByText('目前沒有有效的分享連結。')).toBeVisible()

    // The create dialog starts with money and addresses hidden, recap off
    await section.getByRole('button', { name: '建立分享連結' }).click()
    const create = o.getByRole('dialog', { name: '建立分享連結' })
    await expect(create.getByRole('checkbox', { name: /隱藏金額/ })).toBeChecked()
    await expect(create.getByRole('checkbox', { name: /隱藏地址/ })).toBeChecked()
    await expect(create.getByRole('checkbox', { name: /顯示回顧/ })).not.toBeChecked()
    await expect(create).toContainText('回顧功能之後才會開放')
    // Only money hidden for this link
    await create.getByRole('checkbox', { name: /隱藏地址/ }).uncheck()
    await shot(o, `${width}-share-options`)
    await create.getByRole('button', { name: '建立分享連結' }).click()

    // The URL is shown once, with copy and open-in-a-new-tab
    const created = o.getByRole('dialog', { name: '分享連結已建立' })
    await expect(created).toBeVisible()
    await expect(created).toContainText('只會顯示這一次')
    const url = await created.getByLabel('分享連結').inputValue()
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/)
    const token = url.split('/s/')[1]
    const open = created.getByRole('link', { name: '在新分頁開啟' })
    await expect(open).toHaveAttribute('href', url)
    await expect(open).toHaveAttribute('target', '_blank')
    await created.getByRole('button', { name: '複製連結' }).click()
    await expect(o.getByText(/已複製分享連結|已選取連結/)).toBeVisible()
    await shot(o, `${width}-share-created`)
    await created.getByRole('button', { name: '完成' }).click()
    await expect(created).toBeHidden()

    // Closed, the token is gone; the list shows only the date and the options
    expect(await o.content()).not.toContain(token)
    const items = section.getByRole('list', { name: '分享連結' }).getByRole('listitem')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toContainText('隱藏金額')
    await expect(items.first()).not.toContainText('隱藏地址')
    await expect(o.locator('body')).toHaveJSProperty('scrollWidth', width)
    await shot(o, `${width}-share-list`)

    // The server hides the money: the public payload carries the option and no amounts
    const payload = await request.get(`/api/share/${token}`)
    expect(payload.status()).toBe(200)
    expect(JSON.stringify(await payload.json())).not.toMatch(/Minor"/)

    // A fresh browser (no member token) opens the share page
    const visitor = await newPage(browser, width)
    const v = visitor.page
    await v.goto(url)
    await expect(v.getByRole('heading', { level: 1, name: tripName })).toBeVisible()
    await shot(v, `${width}-share-page`)

    // An editor who joined through an invite sees no share controls
    const miaToken = await joinAsEditor(request, trip.id, memberToken)
    const editor = await newPage(browser, width, { [trip.id]: miaToken })
    const e = editor.page
    await e.goto(`/trips/${trip.id}/settings`)
    const editorSection = e.getByRole('region', { name: '分享連結' })
    await expect(editorSection.getByText('只有擁有者可以建立或撤銷分享連結。')).toBeVisible()
    await expect(e.getByRole('button', { name: '建立分享連結' })).toHaveCount(0)
    const refused = await request.get(`/api/trips/${trip.id}/shares`, {
      headers: { authorization: `Bearer ${miaToken}` },
    })
    expect(refused.status()).toBe(403)
    await shot(e, `${width}-share-editor`)

    // The owner revokes (after confirming); the link stops working
    await section.getByRole('button', { name: /^撤銷 .* 建立的分享連結$/ }).click()
    const confirm = o.getByRole('dialog', { name: '撤銷這個分享連結？' })
    await confirm.getByRole('button', { name: '撤銷' }).click()
    await expect(o.getByText('分享連結已撤銷')).toBeVisible()
    await expect(section.getByText('目前沒有有效的分享連結。')).toBeVisible()
    await v.reload()
    await expect(v.getByRole('heading', { level: 1, name: '這個連結已失效或不存在' })).toBeVisible()
    await shot(v, `${width}-share-revoked`)

    await editor.context.close()
    await visitor.context.close()
    await owner.context.close()
  })
}

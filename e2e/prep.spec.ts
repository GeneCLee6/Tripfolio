import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// Pre-trip prep (E9): a campervan trip seeded through the API, then in the browser: copy the
// campervan checklist template (the preview first), tick and assign an item; set a lodging budget
// of 2000 AUD, record an expense through the API and see it as actual; upload a PDF as insurance and
// open it; copy the New Zealand notes and edit a section — at phone and desktop widths. Needs
// `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'zh-TW' })

const SHOTS = process.env.SHOTS_DIR
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

// The smallest PDF a viewer accepts
const PDF = Buffer.from(
  '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

interface Seeded {
  tripId: string
  memberId: string
  startDate: string
  headers: { authorization: string }
}

async function seed(request: APIRequestContext, name: string): Promise<Seeded> {
  const startDate = inDays(20)
  const created = await request.post('/api/trips', {
    data: {
      name,
      destination: 'New Zealand',
      startDate,
      endDate: inDays(24),
      tz: 'Pacific/Auckland',
      baseCurrency: 'AUD',
      localCurrencies: ['NZD'],
      style: 'campervan',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(created.status()).toBe(201)
  const body = (await created.json()) as {
    trip: { id: string; ownerMemberId: string }
    memberToken: string
  }
  return {
    tripId: body.trip.id,
    memberId: body.trip.ownerMemberId,
    startDate,
    headers: { authorization: `Bearer ${body.memberToken}` },
  }
}

async function login(page: Page, s: Seeded) {
  await page.addInitScript(
    ([id, value]) => localStorage.setItem('tripfolio.memberTokens', JSON.stringify({ [id]: value })),
    [s.tripId, s.headers.authorization.slice('Bearer '.length)],
  )
}

for (const [label, width, height] of [
  ['phone', 375, 812],
  ['desktop', 1440, 900],
] as const) {
  test(`${label}: checklists, budget, documents and notes`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    const s = await seed(request, `Prep ${label}`)
    await login(page, s)
    const api = (path: string) => `/api/trips/${s.tripId}${path}`

    // ---- Checklists: template with preview, tick, assign
    await page.goto(`/trips/${s.tripId}/checklists`)
    await expect(page.getByRole('heading', { level: 1, name: '清單' })).toBeVisible()
    await page.getByRole('button', { name: '從範本帶入' }).first().click()
    const dialog = page.getByRole('dialog', { name: '從範本帶入' })
    await expect(dialog.getByLabel('旅行型態')).toHaveValue('campervan')
    await expect(dialog.locator('[data-template-preview]')).toContainText('露營車行前')
    await shot(page, `prep-template-${label}`)
    await dialog.getByRole('button', { name: '帶入', exact: true }).click()
    await expect(dialog).toBeHidden()

    const item = page.locator('[data-item="campervan.pretrip.self-contained"]')
    await expect(item).toContainText('self-contained')
    await item.getByRole('checkbox').check()
    await expect
      .poll(async () => {
        const res = await request.get(api('/checklists'), { headers: s.headers })
        const body = (await res.json()) as {
          checklists: { items: { templateKey: string | null; done: boolean }[] }[]
        }
        return body.checklists
          .flatMap((l) => l.items)
          .find((i) => i.templateKey === 'campervan.pretrip.self-contained')?.done
      })
      .toBe(true)
    await item.getByRole('button', { name: /^確認車子/ }).click()
    const sheet = page.getByRole('dialog', { name: '編輯項目' })
    await sheet.getByLabel('負責人').selectOption({ label: 'Gene' })
    await sheet.getByRole('button', { name: '儲存' }).click()
    await expect(item.locator(`[data-assignee="${s.memberId}"]`)).toBeVisible()

    // Packing: claim a shared item with one tap
    await page.getByRole('tab', { name: '打包' }).click()
    const adapter = page.locator('[data-item="general.packing-shared.adapter"]')
    await adapter.getByRole('button', { name: '我帶' }).click()
    await expect(adapter).toContainText('Gene 帶')
    await shot(page, `prep-checklists-${label}`)

    // ---- Budget: lodging 2000 AUD, then an expense recorded through the API shows as actual
    await page.goto(`/trips/${s.tripId}/budget`)
    await page.getByLabel('住宿預算').fill('2000')
    await page.getByRole('button', { name: '儲存預算' }).click()
    await expect(page.getByText('預算已儲存')).toBeVisible()
    const budget = await request.get(api('/budget'), { headers: s.headers })
    expect(((await budget.json()) as { rows: unknown[] }).rows).toEqual([
      { category: 'lodging', plannedMinor: 200000, perPerson: false },
    ])
    const expense = await request.post(api('/expenses'), {
      headers: s.headers,
      data: {
        amountMinor: 50000,
        currency: 'AUD',
        category: 'lodging',
        date: s.startDate,
        payerMemberId: s.memberId,
        splitMethod: 'equal',
        participants: [{ memberId: s.memberId }],
      },
    })
    expect(expense.status()).toBe(201)
    await page.reload()
    const lodging = page.locator('[data-actual="lodging"]')
    await expect(lodging).toContainText('500.00')
    await expect(lodging).toContainText('1,500.00')
    await expect(page.locator('[data-actual-total]')).toContainText('500.00')
    await shot(page, `prep-budget-${label}`)

    // ---- Documents: upload a PDF as insurance, open it
    await page.goto(`/trips/${s.tripId}/documents`)
    await expect(page.locator('[data-never-shared]')).toContainText('文件永不出現在分享頁')
    await page.getByLabel('放進').selectOption({ label: '保單' })
    await page.getByTestId('document-input').setInputFiles({
      name: 'policy.pdf',
      mimeType: 'application/pdf',
      buffer: PDF,
    })
    const doc = page.locator('[data-document]').first()
    await expect(doc).toContainText('保單')
    await expect(doc).toContainText('PDF')
    // The new tab either shows the blob or, in headless Chromium (no PDF viewer), downloads it.
    // Listen before clicking: the download can start before a later listener is attached
    const opened = new Promise<string>((resolve) => {
      page.context().once('page', (tab) => {
        tab.on('download', (download) => resolve(download.url()))
        tab.on('framenavigated', (frame) => {
          if (frame.url().startsWith('blob:')) resolve(frame.url())
        })
      })
    })
    await doc.getByRole('button', { name: '開啟' }).click()
    expect(await opened).toMatch(/^blob:/)
    for (const other of page.context().pages()) if (other !== page) await other.close()
    const docs = await request.get(api('/documents'), { headers: s.headers })
    expect(
      ((await docs.json()) as { documents: { docCategory: string }[] }).documents.map(
        (d) => d.docCategory,
      ),
    ).toEqual(['insurance'])
    await shot(page, `prep-documents-${label}`)

    // ---- Notes: the New Zealand template, edit the driving section
    await page.goto(`/trips/${s.tripId}/notes`)
    await page.getByRole('button', { name: '帶入紐西蘭範本' }).first().click()
    const driving = page.locator('[data-note="nz.driving"]')
    await expect(driving).toContainText('單線橋')
    await driving.getByRole('button', { name: '編輯' }).click()
    const editor = page.locator('[data-note-editor]')
    await editor.getByLabel('內容').fill('- 單線橋：看標誌，紅色箭頭那方讓行\n- 限速再查 https://www.nzta.govt.nz')
    await editor.getByRole('checkbox', { name: '可分享' }).check()
    await editor.getByRole('button', { name: '儲存' }).click()
    await expect(driving).toContainText('紅色箭頭那方讓行')
    await expect(driving.getByRole('link', { name: 'www.nzta.govt.nz' })).toBeVisible()
    await expect(driving).toContainText('可分享')
    await shot(page, `prep-notes-${label}`)

    // Nothing scrolls sideways at this width
    for (const path of ['checklists', 'budget', 'documents', 'notes']) {
      await page.goto(`/trips/${s.tripId}/${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })
}

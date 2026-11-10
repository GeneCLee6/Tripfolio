import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

// e1-t06 optional Google sign-in. Locally GOOGLE_CLIENT_ID is empty, so /api/auth/me answers 503
// and no sign-in UI may appear. A real Google login cannot run here: the signed-in UI is driven by
// mocking /api/auth/me, /api/auth/trips and the member link routes with page.route.

test.use({ locale: 'zh-TW' })

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

interface Created {
  trip: { id: string; name: string }
  member: { id: string; name: string }
  memberToken: string
}

async function createTrip(request: APIRequestContext, name: string): Promise<Created> {
  const response = await request.post('/api/trips', {
    data: {
      name,
      destination: 'Tokyo',
      startDate: inDays(30),
      endDate: inDays(33),
      tz: 'Asia/Tokyo',
      owner: { name: 'Gene', color: '#0F6E74' },
    },
  })
  expect(response.status()).toBe(201)
  return (await response.json()) as Created
}

async function remember(page: Page, tokens: Record<string, string>) {
  await page.addInitScript(
    (value) => {
      if (!sessionStorage.getItem('auth-e2e-seeded')) {
        localStorage.setItem('tripfolio.memberTokens', JSON.stringify(value))
        sessionStorage.setItem('auth-e2e-seeded', '1')
      }
    },
    tokens,
  )
}

const SIGN_IN = '用 Google 登入，換手機也找得到旅程'

test('Google sign-in not configured: no sign-in UI anywhere', async ({ page, request }) => {
  const me = await request.get('/api/auth/me')
  expect(me.status()).toBe(503)
  expect((await me.json()).error.code).toBe('auth_disabled')
  const start = await request.get('/api/auth/google/start', { maxRedirects: 0 })
  expect(start.status()).toBe(503)

  const a = await createTrip(request, '東京散步')
  await remember(page, { [a.trip.id]: a.memberToken })
  await page.goto('/')
  await expect(page.getByRole('link', { name: /東京散步/ })).toBeVisible()
  await expect(page.getByRole('button', { name: SIGN_IN })).toHaveCount(0)
  await page.goto(`/trips/${a.trip.id}/settings`)
  await expect(page.getByRole('heading', { name: '我是誰' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '帳號', exact: true })).toHaveCount(0)
})

test('signed in (mocked): merges the account’s trips, links this identity, signs out', async ({
  page,
  request,
}) => {
  const a = await createTrip(request, '大阪三日')
  const b = await createTrip(request, '京都賞楓') // only "the account" knows this one
  await remember(page, { [a.trip.id]: a.memberToken })

  let signedIn = true
  let linked = false
  const user = { id: 'u1', email: 'gene@example.com', name: 'Gene Lee', picture: null }
  await page.route('**/api/auth/me', (route) =>
    signedIn
      ? route.fulfill({ json: { user } })
      : route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: 'x' } } }),
  )
  const sentTokens: (string | undefined)[] = []
  await page.route('**/api/auth/trips', (route) => {
    sentTokens.push(route.request().headers()['x-member-tokens'])
    return route.fulfill({
      json: { trips: [{ trip: b.trip, member: b.member, memberToken: b.memberToken }] },
    })
  })
  await page.route('**/api/auth/logout', (route) => {
    signedIn = false
    return route.fulfill({ json: { ok: true } })
  })
  await page.route(`**/api/trips/${a.trip.id}/members/me/link`, (route) => {
    const method = route.request().method()
    if (method === 'POST') linked = true
    if (method === 'DELETE') linked = false
    return route.fulfill({ json: { linked, linkedToOther: false } })
  })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByTestId('account-user')).toContainText('已登入：Gene Lee')
  await expect(page.getByRole('link', { name: /大阪三日/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /京都賞楓/ })).toBeVisible()
  expect(sentTokens[0]).toBe(a.memberToken)
  const stored = await page.evaluate(() => localStorage.getItem('tripfolio.memberTokens'))
  expect(JSON.parse(stored!)).toEqual({ [a.trip.id]: a.memberToken, [b.trip.id]: b.memberToken })

  await page.goto(`/trips/${a.trip.id}/settings`)
  const card = page.getByRole('region', { name: '帳號' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '把這個身分綁到我的 Google 帳號' }).click()
  await expect(card.getByText('「Gene」已綁定到 gene@example.com。')).toBeVisible()
  await card.getByRole('button', { name: '解除綁定' }).click()
  await expect(card.getByRole('button', { name: '把這個身分綁到我的 Google 帳號' })).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('button', { name: '登出' }).click()
  await expect(page.getByRole('button', { name: SIGN_IN })).toBeVisible()
  await expect(page.getByTestId('account-user')).toHaveCount(0)
})

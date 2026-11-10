import { execSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// The operator usage page (e11-t05, AC-11.5) against a real local Worker and D1. Needs ADMIN_KEY in
// .dev.vars (gitignored) matching ADMIN_KEY here (default below), and the local D1 migrated:
//   echo ADMIN_KEY=local-admin-key-e2e > .dev.vars
//   npx wrangler d1 migrations apply tripfolio --local
// A ≥ 80 % condition is seeded straight into the local apiUsage table with wrangler.

test.use({ locale: 'zh-TW' })

const KEY = process.env.ADMIN_KEY ?? 'local-admin-key-e2e'
const SHOTS = process.env.SHOTS_DIR
const TRIP = 'e2e-admin-usage'

function d1(sql: string) {
  execSync(`npx wrangler d1 execute tripfolio --local --command "${sql}"`, { stdio: 'pipe' })
}

const today = () => new Date().toISOString().slice(0, 10)

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true })
}

test.describe('usage page', () => {
  test.beforeAll(() => {
    // Link previews: 900 of the 1,000 daily budget → 90 %, a warning but not over
    d1(
      `INSERT INTO apiUsage (date, provider, tripId, count) VALUES ('${today()}', 'og', '${TRIP}', 900) ON CONFLICT (date, provider, tripId) DO UPDATE SET count = 900`,
    )
  })
  test.afterAll(() => {
    d1(`DELETE FROM apiUsage WHERE tripId = '${TRIP}'`)
  })

  test('the API refuses a wrong key', async ({ request }) => {
    const res = await request.get('/api/admin/usage?key=wrong')
    expect(res.status()).toBe(403)
  })

  test('asks for a key, then refuses a wrong one', async ({ page }) => {
    await page.goto('/admin/usage')
    await expect(page.getByRole('heading', { name: '輸入管理金鑰' })).toBeVisible()
    await page.getByLabel('管理金鑰').fill('wrong')
    await page.getByRole('button', { name: '開啟用量頁' }).click()
    await expect(page).toHaveURL(/key=wrong/)
    await expect(page.getByRole('alert')).toHaveText('金鑰不對。')
  })

  for (const width of [375, 1440]) {
    test(`meters and the 80 % warning at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`/admin/usage?key=${encodeURIComponent(KEY)}`)
      await expect(page.getByRole('heading', { level: 1, name: '用量與配額' })).toBeVisible()

      // Every external provider, R2 and D1 have a meter
      await expect(page.getByRole('meter', { name: 'R2 儲存空間' })).toBeVisible()
      expect(await page.getByRole('meter').count()).toBeGreaterThanOrEqual(7)
      await expect(page.getByRole('meter', { name: '今日寫入（估計）' })).toBeVisible()

      // The seeded link-preview usage is ≥ 80 %: amber meter, its own note, and the warning list
      const og = page.locator('tr[data-provider="og"]')
      await expect(og.locator('[data-tone="warning"]')).toBeVisible()
      await expect(og).toContainText('接近上限')
      await expect(page.getByRole('list', { name: '用量警示' })).toContainText(
        /連結預覽 已用 \d+(\.\d)?%，接近上限/,
      )

      // No analytics token locally: the setup hint
      await expect(page.getByTestId('cf-setup')).toContainText('需要設定 token')

      // Trips block and the refresh button
      await expect(page.getByText('待清除')).toBeVisible()
      await page.getByRole('button', { name: '重新整理' }).click()
      await expect(page.getByRole('meter', { name: 'R2 儲存空間' })).toBeVisible()

      // No horizontal page scroll at phone width
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      await shot(page, `admin-usage-${width}`)
    })
  }
})

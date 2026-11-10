import { expect, test, type Locator, type Page } from '@playwright/test'
import { msg, prepare, seedRichTrip, tinyJpeg, type RichTrip } from './a11y-seed.ts'

// e10-t06 (AC-10.5): the core flows with the keyboard alone, in a real browser: create a trip, add a
// stop through the place picker, reorder with Space / arrows / Space, open and close sheets (Esc
// gives the focus back), log an expense, step through the lightbox, switch language and theme; and
// every Tab stop shows a focus ring. Needs `npm run dev` with local D1 migrated, or BASE_URL.

test.use({ locale: 'en-US', viewport: { width: 1024, height: 800 } })

const L = 'en' as const

/** Presses Tab until `target` has the focus: it must be reachable, in a sane number of stops */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let stop = 0; stop < limit; stop++) {
    await page.keyboard.press('Tab')
    const there = await target
      .evaluate((element) => element === document.activeElement, null, { timeout: 1000 })
      .catch(() => false)
    if (there) return
  }
  throw new Error(`Not reached in ${limit} presses of Tab`)
}

/** A key press with a pause after it (the drag library listens from the next tick on) */
async function press(page: Page, key: string) {
  await page.keyboard.press(key)
  await page.waitForTimeout(150)
}

/** The focused element shows it: an outline on it, or on its ::after (a button stretched over a card) */
const focusShown = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null
    if (!element || element === document.body) return 'end'
    const own = getComputedStyle(element)
    const after = getComputedStyle(element, '::after')
    const ring =
      (own.outlineStyle !== 'none' && own.outlineWidth !== '0px') ||
      (after.outlineStyle !== 'none' && after.outlineWidth !== '0px') ||
      own.boxShadow !== 'none'
    return ring ? 'ring' : element.outerHTML.slice(0, 200)
  })

const isFocused = (target: Locator) => target.evaluate((element) => element === document.activeElement)

let trip: RichTrip

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(60_000)
  trip = await seedRichTrip(request, await tinyJpeg(browser), 'Keyboard loop')
})

for (const [name, path] of [
  ['trip list', () => '/'],
  ['trip home', () => `/trips/${trip.tripId}`],
  ['itinerary', () => `/trips/${trip.tripId}/itinerary`],
  ['expenses', () => `/trips/${trip.tripId}/expenses`],
] as const) {
  test(`every Tab stop on the ${name} shows the focus`, async ({ page }) => {
    await prepare(page, trip, L)
    await page.goto(path())
    await expect(page.locator('h1').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    for (let stop = 0; stop < 30; stop++) {
      await page.keyboard.press('Tab')
      const seen = await focusShown(page)
      if (seen === 'end') break
      expect(seen).toBe('ring')
    }
  })
}

test('a trip can be created with the keyboard alone', async ({ page }) => {
  await prepare(page, null, L)
  await page.goto('/trips/new')
  await tabTo(page, page.getByLabel(msg(L, 'tripForm.name')))
  await page.keyboard.type('Keyboard trip')
  await tabTo(
    page,
    page.getByRole('textbox', { name: new RegExp(`^${msg(L, 'tripForm.destination')}`) }),
  )
  await page.keyboard.type('New Zealand')
  await tabTo(page, page.getByLabel(msg(L, 'tripForm.startDate')))
  // A date field takes its parts in the locale's order: month, day, year
  const start = new Date(Date.now() + 30 * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  await page.keyboard.type(`${pad(start.getMonth() + 1)}${pad(start.getDate())}${start.getFullYear()}`)
  await expect(page.getByLabel(msg(L, 'tripForm.endDate'))).not.toHaveValue('')
  await tabTo(page, page.getByLabel(msg(L, 'tripForm.you')))
  await page.keyboard.type('Gene')
  await tabTo(page, page.getByRole('button', { name: msg(L, 'tripForm.create') }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/trips\/[^/]+$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard trip' })).toBeVisible()
})

test('a stop is added through the place picker with the keyboard alone', async ({ page }) => {
  test.setTimeout(60_000)
  await prepare(page, trip, L)
  await page.route('**/api/trips/*/geo/search?*', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            nameLocal: 'Fergburger',
            nameEn: 'Fergburger',
            lat: -45.0318,
            lng: 168.6598,
            address: '42 Shotover Street, Queenstown 9300',
            category: 'food',
            source: 'photon',
            externalId: 'osm:N336415647',
          },
        ],
        source: 'photon',
        cached: false,
      },
    }),
  )
  await page.goto(`/trips/${trip.tripId}/itinerary`)
  const add = page.getByRole('button', { name: msg(L, 'itinerary.addStop') }).first()
  await expect(add).toBeVisible()
  await tabTo(page, add)
  await page.keyboard.press('Enter')
  // The open modal (its search field gives way to the chosen place)
  const sheet = page.locator('dialog[open]')
  const search = sheet.getByLabel(msg(L, 'place.search.label'))
  await expect(sheet).toBeVisible()
  if (!(await isFocused(search))) await tabTo(page, search, 10)
  await page.keyboard.type('Fergburger')
  const result = sheet.getByRole('button', { name: /Fergburger/ })
  await expect(result).toBeVisible()
  await tabTo(page, result, 10)
  await page.keyboard.press('Enter')
  await expect(sheet.getByText('42 Shotover Street, Queenstown 9300')).toBeVisible()
  // Date and time fields take a Tab per part, so the way to Save is long
  await tabTo(page, sheet.getByRole('button', { name: msg(L, 'common.save') }), 150)
  await page.keyboard.press('Enter')
  await expect(sheet).toBeHidden()
  await expect(page.locator('[data-stop-id]').filter({ hasText: 'Fergburger' })).toHaveCount(1)
  // The focus is back where the person was, not lost on the page
  await expect(add).toBeFocused()
})

test('stops reorder with Space, the arrows and Space; Esc cancels', async ({ page }) => {
  await prepare(page, trip, L)
  await page.goto(`/trips/${trip.tripId}/itinerary`)
  const day1 = page.locator('section[data-day-id]').first()
  const names = () =>
    day1.locator('[data-stop-id] > button:first-child > span:first-child').allTextContents()
  await expect.poll(names).toEqual(expect.arrayContaining(['Christchurch', 'Lake Tekapo']))
  const before = await names()
  const handle = page.getByRole('button', {
    name: msg(L, 'itinerary.drag.handle', { name: before[0]! }),
  })
  await tabTo(page, handle)
  await press(page, 'Space')
  await press(page, 'ArrowDown')
  await press(page, 'Space')
  const moved = [before[1], before[0], ...before.slice(2)]
  await expect.poll(names).toEqual(moved)
  // Esc puts it back
  await handle.focus()
  await press(page, 'Space')
  await press(page, 'ArrowUp')
  await press(page, 'Escape')
  await expect.poll(names).toEqual(moved)
  await expect(handle).toBeFocused()
})

test('an expense is logged with the keyboard; Esc closes the sheet and gives the focus back', async ({
  page,
}) => {
  await prepare(page, trip, L)
  await page.goto(`/trips/${trip.tripId}/expenses`)
  const open = page
    .getByRole('main')
    .getByRole('button', { name: msg(L, 'term.logExpense') })
    .first()
  await expect(open).toBeVisible()
  const sheet = page.getByRole('dialog', { name: msg(L, 'term.logExpense') })
  const amount = sheet.getByLabel(msg(L, 'money.amount'))

  // Esc closes, the focus is back on the button
  await tabTo(page, open)
  await page.keyboard.press('Enter')
  await expect(sheet).toBeVisible()
  await expect(amount).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(open).toBeFocused()

  // Log NZD 12 for food
  await page.keyboard.press('Enter')
  await expect(amount).toBeFocused()
  await page.keyboard.type('12')
  const food = sheet.getByRole('radio', { name: msg(L, 'expenses.category.food') })
  await tabTo(page, food, 20)
  await page.keyboard.press('Space')
  await expect(food).toHaveAttribute('aria-checked', 'true')
  await tabTo(page, sheet.getByRole('button', { name: msg(L, 'common.save') }), 40)
  await page.keyboard.press('Enter')
  await expect(sheet).toBeHidden()
  await expect(page.locator('[data-expense-id]').filter({ hasText: 'NZ$12.00' })).toHaveCount(1)
  await expect(open).toBeFocused()
})

test('the lightbox steps with the arrows and Esc gives the focus back to the tile', async ({
  page,
}) => {
  await prepare(page, trip, L)
  await page.goto(`/trips/${trip.tripId}/photos`)
  const tiles = page.getByTestId('photo-grid').first().getByRole('button')
  const tile = tiles.first()
  await expect(tile).toBeVisible()
  const total = await tiles.count()
  expect(total).toBeGreaterThan(1)
  const viewer = (index: number) =>
    page.getByRole('dialog', { name: msg(L, 'photos.viewer.title', { index, total }) })
  await tabTo(page, tile)
  await page.keyboard.press('Enter')
  await expect(viewer(1)).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(viewer(2)).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(viewer(1)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lightbox')).toBeHidden()
  await expect(tile).toBeFocused()
})

test('language and theme switch with the keyboard', async ({ page }) => {
  await prepare(page, trip, L)
  await page.goto('/')
  await expect(page.locator('h1').first()).toBeVisible()
  const language = page.getByRole('radiogroup', { name: msg(L, 'language.label') })
  await tabTo(page, language.getByRole('radio', { checked: true }))
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  const zhLanguage = page.getByRole('radiogroup', { name: msg('zh-TW', 'language.label') })
  await expect(zhLanguage.getByRole('radio', { checked: true })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  const theme = page.getByRole('radiogroup', { name: msg(L, 'theme.label') })
  await tabTo(page, theme.getByRole('radio', { checked: true }), 5)
  await page.keyboard.press('ArrowRight')
  await expect(theme.getByRole('radio', { name: msg(L, 'theme.light') })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

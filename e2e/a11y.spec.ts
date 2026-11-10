import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { msg, prepare, seedRichTrip, tinyJpeg, type RichTrip } from './a11y-seed.ts'

// e10-t06 (AC-10.5): axe on every route, in both color schemes and both languages, over one rich
// trip seeded through the API. "No serious problems" per DESIGN §6: serious and critical fail.
// Needs `npm run dev` with local D1 migrated, or BASE_URL.

const BLOCKING = new Set(['serious', 'critical'])
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa']

async function expectNoSeriousProblems(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const blocking = violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ''))
    .map(({ id, nodes }) => ({
      id,
      nodes: nodes.slice(0, 6).map((node) => `${node.target.join(' ')} ${node.failureSummary ?? ''}`),
    }))
  expect(blocking).toEqual([])
}

/** The page is drawn: an h1, nothing still loading */
async function settled(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible()
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
}

let trip: RichTrip

test.beforeAll(async ({ request, browser }) => {
  test.setTimeout(60_000)
  trip = await seedRichTrip(request, await tinyJpeg(browser))
})

const routes: [string, (t: RichTrip) => string][] = [
  ['trip list', () => '/'],
  ['new trip', () => '/trips/new'],
  ['trip home', (t) => `/trips/${t.tripId}`],
  ['itinerary', (t) => `/trips/${t.tripId}/itinerary`],
  ['map', (t) => `/trips/${t.tripId}/map`],
  ['picks', (t) => `/trips/${t.tripId}/picks`],
  ['places', (t) => `/trips/${t.tripId}/places`],
  ['photos', (t) => `/trips/${t.tripId}/photos`],
  ['bookings', (t) => `/trips/${t.tripId}/bookings`],
  ['expenses', (t) => `/trips/${t.tripId}/expenses`],
  ['balances', (t) => `/trips/${t.tripId}/expenses/balances`],
  ['stats', (t) => `/trips/${t.tripId}/expenses/stats`],
  ['history', (t) => `/trips/${t.tripId}/expenses/history`],
  ['checklists', (t) => `/trips/${t.tripId}/checklists`],
  ['budget', (t) => `/trips/${t.tripId}/budget`],
  ['documents', (t) => `/trips/${t.tripId}/documents`],
  ['notes', (t) => `/trips/${t.tripId}/notes`],
  ['recap', (t) => `/trips/${t.tripId}/recap`],
  ['settings', (t) => `/trips/${t.tripId}/settings`],
  ['join', (t) => `/join/${t.inviteToken}`],
  ['privacy', () => '/privacy'],
  ['share page', (t) => `/s/${t.shareToken}`],
]

for (const scheme of ['light', 'dark'] as const) {
  for (const locale of ['zh-TW', 'en'] as const) {
    test.describe(`axe, ${scheme}, ${locale}`, () => {
      test.use({ colorScheme: scheme, locale })

      for (const [name, path] of routes) {
        test(name, async ({ page }) => {
          // The join page is for someone who is not a member yet
          await prepare(page, name === 'join' ? null : trip, locale)
          await page.goto(path(trip))
          await settled(page)
          await expectNoSeriousProblems(page)
        })
      }

      test('an open sheet (new expense)', async ({ page }) => {
        await prepare(page, trip, locale)
        await page.goto(`/trips/${trip.tripId}/expenses`)
        await settled(page)
        await page
          .getByRole('main')
          .getByRole('button', { name: msg(locale, 'term.logExpense') })
          .first()
          .click()
        await expect(page.getByRole('dialog')).toBeVisible()
        await page.waitForTimeout(400)
        await expectNoSeriousProblems(page)
      })

      test('an open sheet (new stop)', async ({ page }) => {
        // Below desktop width the stop editor is a Sheet (on desktop it is the detail column)
        await page.setViewportSize({ width: 1024, height: 800 })
        await prepare(page, trip, locale)
        await page.goto(`/trips/${trip.tripId}/itinerary`)
        await settled(page)
        await page.getByRole('button', { name: msg(locale, 'itinerary.addStop') }).first().click()
        await expect(page.locator('dialog[open]')).toBeVisible()
        await page.waitForTimeout(400)
        await expectNoSeriousProblems(page)
      })

      test('the lightbox', async ({ page }) => {
        await prepare(page, trip, locale)
        await page.goto(`/trips/${trip.tripId}/photos`)
        await settled(page)
        await page.getByTestId('photo-grid').first().getByRole('button').first().click()
        await expect(page.getByTestId('lightbox')).toBeVisible()
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(400)
        await expectNoSeriousProblems(page)
      })
    })
  }
}

// ---- Touch targets (DESIGN §6): at 375 px with touch, every control is at least 44 × 44 px. Links
// inside running text are exempt (WCAG 2.5.8's inline exception); a checkbox counts with its label.
// MapLibre's attribution control is its own markup (listed as residual in the epic).

test.describe('touch targets at 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, locale: 'en' })

  const touchRoutes = routes.filter(([name]) =>
    [
      'trip list',
      'new trip',
      'trip home',
      'itinerary',
      'map',
      'picks',
      'places',
      'photos',
      'bookings',
      'expenses',
      'balances',
      'stats',
      'checklists',
      'budget',
      'settings',
      'share page',
    ].includes(name),
  )

  for (const [name, path] of touchRoutes) {
    test(name, async ({ page }) => {
      await prepare(page, trip, 'en')
      await page.goto(path(trip))
      await settled(page)
      const small = await page.evaluate((minimum) => {
        const selector = [
          'a[href]',
          'button',
          'select',
          'summary',
          'textarea',
          'input:not([type="hidden"])',
          '[role="button"]',
          '[role="tab"]',
          '[role="radio"]',
          '[role="checkbox"]',
          '[role="switch"]',
        ].join(', ')
        const found: string[] = []
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          if (element.closest('dialog:not([open]), [hidden], .maplibregl-ctrl-attrib')) continue
          const style = getComputedStyle(element)
          if (style.visibility === 'hidden' || style.display === 'none') continue
          let box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          // A link inside running text
          if (element.tagName === 'A' && style.display === 'inline') {
            const block = element.parentElement
            const own = element.textContent?.trim().length ?? 0
            if (block && (block.textContent?.trim().length ?? 0) > own) continue
          }
          // A checkbox or radio is hit through its label too
          const input = element as HTMLInputElement
          if (element.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio')) {
            const label = input.closest('label') ?? input.labels?.[0]
            if (label) box = label.getBoundingClientRect()
          }
          // A button stretched over its card (a ::after covering the positioned parent)
          const after = getComputedStyle(element, '::after')
          if (after.content !== 'none' && after.position === 'absolute' && element.offsetParent) {
            box = element.offsetParent.getBoundingClientRect()
          }
          // The skip link sits above the page until it has the focus
          if (box.bottom <= 0) continue
          if (box.width + 0.5 >= minimum && box.height + 0.5 >= minimum) continue
          const label =
            element.getAttribute('aria-label') ?? element.textContent?.trim() ?? input.type ?? ''
          found.push(
            `${element.tagName.toLowerCase()} "${label.slice(0, 40)}" ${Math.round(box.width)}×${Math.round(box.height)}`,
          )
        }
        return found
      }, 44)
      expect(small).toEqual([])
    })
  }
})

// ---- Reduced motion (DESIGN §6): with prefers-reduced-motion the sheet and the lightbox appear
// without animating; without it they do (so the check is not vacuous). The map's camera path is
// unit tested (tests/src/map/camera.test.ts: duration 0).

/** Names of the animations running on the open modal and everything inside it */
const animations = (page: Page) =>
  page.locator('dialog[open]').evaluate((dialog) =>
    [dialog, ...Array.from(dialog.querySelectorAll('*'))]
      .map((element) => getComputedStyle(element).animationName)
      .filter((name) => name !== 'none'),
  )

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test.describe(`motion: ${reducedMotion}`, () => {
    test.use({ reducedMotion, locale: 'en' })

    test('the expense sheet', async ({ page }) => {
      await prepare(page, trip, 'en')
      await page.goto(`/trips/${trip.tripId}/expenses`)
      await settled(page)
      await page
        .getByRole('main')
        .getByRole('button', { name: msg('en', 'term.logExpense') })
        .first()
        .click()
      await expect(page.getByRole('dialog')).toBeVisible()
      if (reducedMotion === 'reduce') expect(await animations(page)).toEqual([])
      else expect((await animations(page)).length).toBeGreaterThan(0)
    })

    test('the lightbox', async ({ page }) => {
      await prepare(page, trip, 'en')
      await page.goto(`/trips/${trip.tripId}/photos`)
      await settled(page)
      await page.getByTestId('photo-grid').first().getByRole('button').first().click()
      await expect(page.getByTestId('lightbox')).toBeVisible()
      if (reducedMotion === 'reduce') expect(await animations(page)).toEqual([])
      else expect((await animations(page)).length).toBeGreaterThan(0)
    })
  })
}

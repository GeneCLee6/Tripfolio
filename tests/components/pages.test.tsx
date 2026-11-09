import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Member, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TopBar } from '../../src/app/TopBar.tsx'
import { TripLayout } from '../../src/app/TripLayout.tsx'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import { ColorSwatches, ToastProvider } from '../../src/components/index.ts'
import NotFoundPage from '../../src/pages/NotFoundPage.tsx'
import SectionPage from '../../src/pages/SectionPage.tsx'
import TripHomePage from '../../src/pages/TripHomePage.tsx'
import TripSettingsPage from '../../src/pages/TripSettingsPage.tsx'
import { TripForm } from '../../src/pages/trip-form/TripForm.tsx'

// Server-rendered page tests (no DOM): what each page shows for a given trip, in both languages.
// Fetching, clicks and the layouts at real widths are covered by e2e/trips.spec.ts.

afterEach(() => setLocale('zh-TW'))

const trip: Trip = {
  id: 'trip1',
  name: 'South Island campervan',
  destination: 'New Zealand',
  centerLat: null,
  centerLng: null,
  startDate: '2030-12-20',
  endDate: '2030-12-28',
  tz: 'Pacific/Auckland',
  baseCurrency: 'AUD',
  secondaryCurrency: 'TWD',
  localCurrencies: ['NZD'],
  coverColor: '#4C6A92',
  coverAttachmentId: null,
  summary: 'Lakes and stars',
  style: 'campervan',
  driveLimitMin: null,
  ownerMemberId: 'm1',
  rev: 3,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
}

const member = (id: string, name: string, role: Member['role']): Member => ({
  id,
  tripId: 'trip1',
  name,
  color: '#0F6E74',
  email: null,
  role,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
})

const owner = member('m1', 'Gene', 'owner')
const mia = member('m2', 'Mia', 'editor')

function render(
  node: ReactElement,
  {
    me = owner,
    at = '/trips/trip1',
    value,
  }: { me?: Member; at?: string; value?: Partial<TripContextValue> } = {},
) {
  const context: TripContextValue = {
    trip,
    me,
    members: [owner, mia],
    reload: () => {},
    setTrip: () => {},
    ...value,
  }
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <ToastProvider>
        <TripContext.Provider value={context}>{node}</TripContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('TopBar', () => {
  it('links the mark home and shows the trip name and both switches', () => {
    const html = render(<TopBar tripName="South Island campervan" />)
    expect(html).toContain('href="/"')
    expect(html).toContain('aria-label="回到旅程清單"')
    expect(html).toContain('South Island campervan')
    expect(html).toContain('aria-label="語言"')
    expect(html).toContain('aria-label="外觀"')
    expect(html).toContain('href="#main"')
  })
})

describe('TripLayout', () => {
  it('shows a loading state before the trip arrives', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/trips/trip1']}>
        <ToastProvider>
          <Routes>
            <Route path="/trips/:id" element={<TripLayout />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(html).toContain('aria-busy="true"')
  })
})

describe('TripHomePage', () => {
  it('shows the trip, its travellers, the empty deadlines and the five sections', () => {
    const html = render(<TripHomePage />)
    expect(html).toContain('South Island campervan')
    expect(html).toContain('Lakes and stars')
    expect(html).toContain('12月20日 – 28日')
    expect(html).toContain('9 天')
    expect(html).toContain('Gene')
    expect(html).toContain('Mia')
    expect(html).toContain('沒有快到期的事')
    for (const path of ['itinerary', 'map', 'picks', 'expenses', 'settings'])
      expect(html).toContain(`href="/trips/trip1/${path}"`)
    expect(html).toContain('編輯旅程')
  })

  it('speaks English and hides editing from an archived trip', () => {
    setLocale('en')
    const html = render(<TripHomePage />, {
      value: { trip: { ...trip, archivedAt: '2031-01-01T00:00:00Z' } },
    })
    expect(html).toContain('Travellers')
    expect(html).toContain('Archived')
    expect(html).toContain('Dec 20')
    expect(html).not.toContain('Edit trip')
  })
})

describe('SectionPage', () => {
  it('is a designed empty state until its batch arrives', () => {
    const html = render(<SectionPage section="picks" />)
    expect(html).toContain('<h1')
    expect(html).toContain('清單即將開放')
  })
})

describe('TripSettingsPage', () => {
  it('lets the owner archive and lists the travellers with roles', () => {
    const html = render(<TripSettingsPage />)
    expect(html).toContain('封存旅程')
    expect(html).toContain('擁有者')
    expect(html).toContain('編輯者')
    expect(html).toContain('Pacific/Auckland')
    // e1-t03: the owner creates invite links (tests/components/members.test.tsx covers roles)
    expect(html).toContain('產生邀請連結')
  })

  it('tells an editor that only the owner archives', () => {
    const html = render(<TripSettingsPage />, { me: mia })
    expect(html).not.toContain('封存旅程</button>')
    expect(html).toContain('只有擁有者可以封存或取消封存。')
  })

  it('offers unarchive on an archived trip', () => {
    const html = render(<TripSettingsPage />, {
      value: { trip: { ...trip, archivedAt: '2031-01-01T00:00:00Z' } },
    })
    expect(html).toContain('取消封存')
  })
})

describe('TripForm', () => {
  it('asks for everything a trip needs, and the owner when creating', () => {
    const html = render(<TripForm onDone={() => {}} />)
    for (const label of [
      '旅程名稱',
      '目的地',
      '出發日',
      '回程日',
      '目的地時區',
      '主幣別（結算用）',
      '第二顯示幣別',
      '當地幣別',
      '旅行型態',
      '封面色',
      '一句話簡介',
      '你的名字',
    ])
      expect(html).toContain(label)
    expect(html).toContain('value="AUD" selected=""')
    expect(html).toContain('value="TWD" selected=""')
    expect(html).toContain('Pacific/Auckland')
    expect(html).toContain('露營車')
    expect(html).toContain('role="radiogroup"')
  })

  it('fills in the trip when editing and leaves the owner out', () => {
    const html = render(<TripForm trip={trip} onDone={() => {}} />)
    expect(html).toContain('value="South Island campervan"')
    expect(html).toContain('value="campervan" selected=""')
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('你會是這趟旅程的擁有者。')
  })
})

describe('ColorSwatches', () => {
  it('is a radio group of the ten day colours with names', () => {
    const html = renderToStaticMarkup(
      <ColorSwatches label="封面色" value="#5B7B4A" onChange={() => {}} />,
    )
    expect(html.match(/role="radio"/g)).toHaveLength(10)
    expect(html).toContain('aria-label="苔綠"')
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="苔綠"/)
  })
})

describe('NotFoundPage', () => {
  it('points home', () => {
    const html = render(<NotFoundPage />)
    expect(html).toContain('這裡什麼都沒有')
    expect(html).toContain('href="/"')
  })
})

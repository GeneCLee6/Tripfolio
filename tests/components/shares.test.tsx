import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Member, Share, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import { ToastProvider } from '../../src/components/index.ts'
import { activeShareOptions, DEFAULT_SHARE_OPTIONS, shareUrl } from '../../src/lib/shares.ts'
import TripSettingsPage from '../../src/pages/TripSettingsPage.tsx'
import { ShareDialog } from '../../src/pages/shares/ShareDialog.tsx'
import { ShareList, SharesSection } from '../../src/pages/shares/SharesSection.tsx'

// Share link management in settings (e1-t05): the list shows metadata and option chips only, the
// create dialog starts with money and addresses hidden, and only the owner gets the controls.

afterEach(() => setLocale('zh-TW'))

const trip: Trip = {
  id: 'trip1',
  name: 'Bali',
  destination: 'Bali',
  centerLat: null,
  centerLng: null,
  startDate: '2030-12-20',
  endDate: '2030-12-24',
  tz: 'Asia/Makassar',
  baseCurrency: 'AUD',
  secondaryCurrency: 'TWD',
  localCurrencies: ['IDR'],
  coverColor: '#B5654A',
  coverAttachmentId: null,
  summary: '',
  style: 'private-driver',
  driveLimitMin: null,
  ownerMemberId: 'm1',
  rev: 1,
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

const gene = member('m1', 'Gene', 'owner')
const mia = member('m2', 'Mia', 'editor')
const kid = member('m3', 'Kid', 'viewer')

const share = (id: string, options: Share['options']): Share => ({
  id,
  tripId: 'trip1',
  options,
  createdAt: '2026-11-09T00:00:00Z',
  revokedAt: null,
})

function render(node: ReactElement, me: Member, value: Partial<TripContextValue> = {}) {
  const context: TripContextValue = {
    trip,
    me,
    members: [gene, mia, kid],
    reload: () => {},
    setTrip: () => {},
    ...value,
  }
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/trips/trip1/settings']}>
      <ToastProvider>
        <TripContext.Provider value={context}>{node}</TripContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('share helpers', () => {
  it('builds the /s/ URL and lists the options that are on', () => {
    expect(shareUrl('abc_DEF-123', 'https://trip.example/')).toBe(
      'https://trip.example/s/abc_DEF-123',
    )
    expect(DEFAULT_SHARE_OPTIONS).toEqual({
      hideMoney: true,
      hideAddresses: true,
      showRecap: false,
    })
    expect(activeShareOptions(DEFAULT_SHARE_OPTIONS)).toEqual(['hideMoney', 'hideAddresses'])
    expect(activeShareOptions({ hideMoney: false, hideAddresses: false, showRecap: true })).toEqual(
      ['showRecap'],
    )
  })
})

describe('ShareList', () => {
  it('shows the date, option chips and a revoke button, never a token', () => {
    const html = render(
      <ShareList
        shares={[
          share('s1', { hideMoney: true, hideAddresses: false, showRecap: true }),
          share('s2', { hideMoney: false, hideAddresses: false, showRecap: false }),
        ]}
        dateOf={(s) => (s.id === 's1' ? 'D1' : 'D2')}
        onRevoke={() => {}}
      />,
      gene,
    )
    expect(html).toContain('aria-label="分享連結"')
    expect(html).toContain('建立於 D1')
    expect(html).toContain('隱藏金額')
    expect(html).not.toContain('隱藏地址')
    expect(html).toContain('顯示回顧')
    expect(html).toContain('全部顯示')
    expect(html).toContain('aria-label="撤銷 D1 建立的分享連結"')
    expect(html).toContain('aria-label="撤銷 D2 建立的分享連結"')
    expect(html).not.toContain('/s/')
  })
})

describe('ShareDialog', () => {
  it('starts with money and addresses hidden and recap off, explaining each', () => {
    const html = render(
      <ShareDialog tripId="trip1" onClose={() => {}} onCreated={() => {}} />,
      gene,
    )
    expect(html).toContain('建立分享連結')
    const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? []
    expect(boxes).toHaveLength(3)
    expect(boxes.map((box) => box.includes('checked'))).toEqual([true, true, false])
    expect(html).toContain('隱藏地址')
    expect(html).toContain('回顧功能之後才會開放')
    expect(html).toContain('永遠不會出現在分享頁')
  })

  it('speaks English', () => {
    setLocale('en')
    const html = render(
      <ShareDialog tripId="trip1" onClose={() => {}} onCreated={() => {}} />,
      gene,
    )
    expect(html).toContain('Hide money')
    expect(html).toContain('Hide addresses')
    expect(html).toContain('Show recap')
  })
})

describe('SharesSection by role', () => {
  it('owner: create button and explanation', () => {
    const html = render(<SharesSection />, gene)
    expect(html).toContain('建立分享連結')
    expect(html).toContain('不用加入就能看')
    expect(html).not.toContain('只有擁有者可以建立或撤銷分享連結。')
  })

  it('owner of an archived trip can still share', () => {
    const html = render(<SharesSection />, gene, {
      trip: { ...trip, archivedAt: '2026-11-09T02:00:00Z' },
    })
    expect(html).toMatch(/<button[^>]*>建立分享連結<\/button>/)
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>建立分享連結/)
  })

  for (const me of [mia, kid]) {
    it(`${me.role}: no controls, a short explanation`, () => {
      const html = render(<SharesSection />, me)
      expect(html).toContain('分享連結')
      expect(html).toContain('只有擁有者可以建立或撤銷分享連結。')
      expect(html).not.toContain('建立分享連結')
    })
  }

  it('is mounted on the settings page under the invites', () => {
    const html = render(<TripSettingsPage />, gene)
    expect(html.indexOf('id="settings-shares"')).toBeGreaterThan(
      html.indexOf('id="settings-invites"'),
    )
  })
})

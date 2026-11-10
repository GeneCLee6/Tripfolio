import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Member, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import { MemberAvatarRow, ToastProvider } from '../../src/components/index.ts'
import TripHomePage from '../../src/pages/TripHomePage.tsx'
import TripSettingsPage from '../../src/pages/TripSettingsPage.tsx'
import { MemberList } from '../../src/pages/members/MembersSection.tsx'

// Members in settings and on the trip home (e1-t03), and what each role sees (e1-t04).

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

const member = (id: string, name: string, role: Member['role'], createdAt: string): Member => ({
  id,
  tripId: 'trip1',
  name,
  color: '#0F6E74',
  email: null,
  role,
  createdAt,
  updatedAt: createdAt,
})

const gene = member('m1', 'Gene', 'owner', '2026-11-09T00:00:00Z')
const mia = member('m2', 'Mia', 'editor', '2026-11-09T01:00:00Z')
const kid = member('m3', 'Kid', 'viewer', '2026-11-09T00:30:00Z')
const members = [kid, mia, gene]

function render(node: ReactElement, me: Member, value: Partial<TripContextValue> = {}) {
  const context: TripContextValue = {
    trip,
    me,
    members,
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

describe('MemberList', () => {
  it('lists the owner first with role chips and marks "you"', () => {
    const html = renderToStaticMarkup(
      <MemberList members={members} meId="m2" canEdit={(m) => m.id === 'm2'} onEdit={() => {}} />,
    )
    const order = ['Gene', 'Mia', 'Kid'].map((name) => html.indexOf(`aria-label="${name}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(html).toContain('擁有者')
    expect(html).toContain('編輯者')
    expect(html).toContain('檢視者')
    expect(html).toContain('· 你')
    // Only the rows canEdit allows get a button
    expect(html).toContain('aria-label="編輯 Mia"')
    expect(html).not.toContain('aria-label="編輯 Gene"')
  })
})

describe('TripSettingsPage by role', () => {
  it('owner: add, edit everyone, invite links, archive', () => {
    const html = render(<TripSettingsPage />, gene)
    expect(html).toContain('新增旅伴')
    for (const name of ['Gene', 'Mia', 'Kid']) expect(html).toContain(`aria-label="編輯 ${name}"`)
    expect(html).toContain('建立邀請連結')
    expect(html).toContain('封存旅程')
    expect(html).toContain('編輯旅程')
    expect(html).toContain('擁有者的身分不能透過邀請連結換走')
  })

  it('editor: edits the trip and only themselves, no member management', () => {
    const html = render(<TripSettingsPage />, mia)
    expect(html).not.toContain('新增旅伴')
    expect(html).toContain('aria-label="編輯 Mia"')
    expect(html).not.toContain('aria-label="編輯 Gene"')
    expect(html).not.toContain('建立邀請連結')
    expect(html).toContain('只有擁有者可以管理旅伴與邀請連結。')
    expect(html).toContain('編輯旅程')
    expect(html).toContain('這不是我')
  })

  it('viewer: no editing controls but their own name, and says so', () => {
    const html = render(<TripSettingsPage />, kid)
    expect(html).not.toContain('編輯旅程')
    expect(html).not.toContain('新增旅伴')
    expect(html).toContain('aria-label="編輯 Kid"')
    expect(html).not.toContain('aria-label="編輯 Mia"')
    expect(html).toContain('你是檢視者，只能查看這趟旅程。')
  })

  it('archived: the owner can no longer change the list or invite', () => {
    const html = render(<TripSettingsPage />, gene, {
      trip: { ...trip, archivedAt: '2031-01-01T00:00:00Z' },
    })
    expect(html).not.toContain('新增旅伴')
    expect(html).not.toContain('aria-label="編輯 Mia"')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>建立邀請連結/)
    expect(html).toContain('取消封存')
  })
})

describe('trip home', () => {
  it('shows the stacked avatars and count, linking to settings; viewers get no edit button', () => {
    const html = render(<TripHomePage />, kid)
    expect(html).toContain('href="/trips/trip1/settings"')
    expect(html).toContain('3 位旅伴')
    expect(html).not.toContain('編輯旅程')
    expect(render(<TripHomePage />, mia)).toContain('編輯旅程')
  })

  it('MemberAvatarRow folds the rest into +N and speaks English', () => {
    setLocale('en')
    const many = Array.from({ length: 7 }, (_, i) =>
      member(`x${i}`, `P${i}`, 'editor', '2026-11-09T00:00:00Z'),
    )
    const html = renderToStaticMarkup(<MemberAvatarRow members={many} max={4} />)
    expect(html).toContain('+3')
    expect(html).toContain('7 travellers')
    expect(html.match(/role="img"/g)).toHaveLength(4)
  })
})

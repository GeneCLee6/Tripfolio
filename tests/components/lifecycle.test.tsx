import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Member, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import { ToastProvider } from '../../src/components/index.ts'
import PrivacyPage from '../../src/pages/PrivacyPage.tsx'
import { CloneSheet } from '../../src/pages/lifecycle/CloneSheet.tsx'
import { ImportSheet } from '../../src/pages/lifecycle/ImportSheet.tsx'
import { TripDataSection } from '../../src/pages/lifecycle/TripDataSection.tsx'

// The lifecycle screens (e1-t07, e8-t03, e8-t05, e11-t06): what each role sees in settings, the
// clone form's defaults, the import sheet before a file is picked, and the privacy page in both
// languages.

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
  localCurrencies: [],
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

function render(node: ReactElement, me: Member = gene, value: Partial<TripContextValue> = {}) {
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

describe('TripDataSection', () => {
  it('gives the owner export, clone, calendar, delete and the privacy link', () => {
    const html = render(<TripDataSection />, gene)
    expect(html).toContain('旅程檔案')
    expect(html).toContain('匯出旅程檔')
    expect(html).toContain('含花費')
    expect(html).toContain('含照片中繼資料')
    expect(html).toContain('複製為範本')
    expect(html).toContain('下載行事曆（.ics）')
    expect(html).toContain('訂閱網址')
    expect(html).toContain('刪除旅程')
    expect(html).toContain('30 天內擁有者可以')
    expect(html).toContain('href="/privacy"')
    expect(html).not.toContain('只有擁有者可以刪除旅程')
  })

  it('lets an editor export and clone but not delete', () => {
    const html = render(<TripDataSection />, mia)
    expect(html).toContain('匯出旅程檔')
    expect(html).toContain('複製為範本')
    expect(html).toContain('只有擁有者可以刪除旅程')
  })

  it('gives a viewer the calendar only', () => {
    const html = render(<TripDataSection />, kid)
    expect(html).not.toContain('含花費')
    expect(html).not.toContain('>複製為範本<')
    expect(html).toContain('下載行事曆（.ics）')
    expect(html).toContain('匯出與複製需要編輯權限')
  })

  it('is still offered on an archived trip (export and clone allow archived trips)', () => {
    const html = render(<TripDataSection />, gene, {
      trip: { ...trip, archivedAt: '2026-11-09T00:00:00Z' },
    })
    expect(html).toContain('匯出旅程檔')
    expect(html).toContain('刪除旅程')
  })
})

describe('CloneSheet', () => {
  it('starts from a copy name, the same start date and nothing kept', () => {
    const html = render(<CloneSheet trip={trip} onClose={() => {}} />)
    expect(html).toContain('value="Bali（副本）"')
    expect(html).toContain('value="2030-12-20"')
    const boxes = html.match(/<input type="checkbox"[^>]*>/g) ?? []
    expect(boxes).toHaveLength(3)
    expect(boxes.some((box) => box.includes('checked'))).toBe(false)
    expect(html).toContain('保留旅伴')
    expect(html).toContain('保留花費')
    expect(html).toContain('保留照片')
  })
})

describe('ImportSheet', () => {
  it('asks for a .json file first and cannot submit without one', () => {
    const html = render(<ImportSheet onClose={() => {}} onDone={() => {}} />)
    expect(html).toContain('type="file"')
    expect(html).toContain('accept=".json,application/json"')
    expect(html).toContain('旅程檔（.json）')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>匯入<\/button>/)
  })
})

describe('PrivacyPage', () => {
  it('covers storage, access, media, shares, the 30 days, services and contact (zh-TW)', () => {
    const html = render(<PrivacyPage />)
    for (const heading of [
      '我們存什麼',
      '誰看得到',
      '照片與文件',
      '分享連結',
      '刪除與保留 30 天',
      '外部服務',
      '聯絡',
    ])
      expect(html).toContain(heading)
    expect(html).toContain('2048')
    expect(html).toContain('EXIF')
    expect(html).toContain('永遠不會出現在分享頁')
    for (const service of ['OpenFreeMap', 'Photon', 'OpenRouteService', 'open.er-api.com'])
      expect(html).toContain(service)
  })

  it('reads in English', () => {
    setLocale('en')
    const html = render(<PrivacyPage />)
    expect(html).toContain('What we store')
    expect(html).toContain('Deleting, and the 30 days')
    expect(html).toContain('Outside services')
    expect(html).not.toMatch(/[一-鿿]/)
  })
})

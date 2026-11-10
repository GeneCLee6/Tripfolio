import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import type { Member, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { TripContext, type TripContextValue } from '../../src/app/trip-context.ts'
import {
  PhotoThumb,
  StorageMeterView,
  ToastProvider,
} from '../../src/components/index.ts'
import { PhotoUploader, UploadList } from '../../src/components/PhotoUploader.tsx'
import type { UploadItem } from '../../src/lib/upload/queue-items.ts'
import TripHomePage from '../../src/pages/TripHomePage.tsx'
import PhotosPage from '../../src/pages/photos/PhotosPage.tsx'
import { sortPhotos, takenAtText } from '../../src/pages/photos/photos.ts'
import type { Attachment } from '../../shared/api/media.ts'

// The uploader's states, the storage meter, the thumb's loading state, and where photos show on
// the trip home (e6-t02, e6-t05). Server rendering: no effects, so nothing is fetched.

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

const member = (role: Member['role']): Member => ({
  id: 'm1',
  tripId: 'trip1',
  name: 'Gene',
  color: '#0F6E74',
  email: null,
  role,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
})

function render(node: ReactElement, role: Member['role'] = 'editor', tripPatch: Partial<Trip> = {}) {
  const me = member(role)
  const value: TripContextValue = {
    trip: { ...trip, ...tripPatch },
    me,
    members: [me],
    reload: () => {},
    setTrip: () => {},
  }
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/trips/trip1/photos']}>
      <ToastProvider>
        <TripContext.Provider value={value}>{node}</TripContext.Provider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const noop = () => {}
const listProps = { onRetry: noop, onCancel: noop, onDismiss: noop, onCancelAll: noop, onClear: noop }

const item = (patch: Partial<UploadItem> & Pick<UploadItem, 'id' | 'status'>): UploadItem => ({
  name: `${patch.id}.jpg`,
  previewUrl: null,
  loaded: 0,
  total: 0,
  error: null,
  ...patch,
})

describe('PhotoUploader', () => {
  it('offers the drop zone, the picker and the location switch to editors', () => {
    const html = render(<PhotoUploader tripId="trip1" />)
    expect(html).toContain('把照片拖到這裡')
    expect(html).toContain('選擇照片')
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/\*"[^>]*multiple/)
    expect(html).toContain('使用照片位置')
    expect(html).toMatch(/type="checkbox"[^>]*checked/)
    expect(html).toContain('長邊 2048')
    // Not a touch screen in tests: no camera input
    expect(html).not.toContain('capture=')
    expect(html).not.toContain('上傳佇列')
  })

  it('is hidden from viewers and on archived trips', () => {
    expect(render(<PhotoUploader tripId="trip1" />, 'viewer')).not.toContain('選擇照片')
    expect(
      render(<PhotoUploader tripId="trip1" />, 'owner', { archivedAt: '2026-11-09T00:00:00Z' }),
    ).not.toContain('選擇照片')
  })

  it('renders in English', () => {
    setLocale('en')
    expect(render(<PhotoUploader tripId="trip1" />)).toContain('Choose photos')
  })
})

describe('UploadList', () => {
  it('shows every phase, the overall progress and the right actions per row', () => {
    const html = render(
      <UploadList
        {...listProps}
        items={[
          item({ id: 'queued', status: 'queued' }),
          item({ id: 'prep', status: 'preparing' }),
          item({ id: 'up', status: 'uploading', loaded: 40, total: 100 }),
          item({ id: 'done', status: 'done', previewUrl: 'blob:1' }),
          item({
            id: 'heic',
            status: 'failed',
            error: { key: 'photos.upload.error.heic', retryable: false },
          }),
          item({
            id: 'net',
            status: 'failed',
            error: { key: 'error.network', code: 'network', retryable: true },
          }),
          item({ id: 'gone', status: 'cancelled' }),
        ]}
      />,
    )
    expect(html).toContain('上傳佇列')
    // done 1 of 4 counted (failed and cancelled left out); (0 + 0 + 0.4 + 1) / 4 = 35 %
    expect(html).toContain('1／4 張完成 · 35%')
    expect(html).toContain('等待中')
    expect(html).toContain('準備中')
    expect(html).toContain('上傳中 40%')
    expect(html).toContain('aria-valuenow="40"')
    expect(html).toContain('完成')
    expect(html).toContain('src="blob:1"')
    expect(html).toContain('這個瀏覽器讀不了 HEIC')
    expect(html).toContain('連不到伺服器')
    expect(html).toContain('已取消')
    // Retry only where it can help: the network failure and the cancelled file
    expect(html).not.toContain('重試 heic.jpg')
    expect(html).toContain('重試 net.jpg')
    expect(html).toContain('重試 gone.jpg')
    expect(html).toContain('取消上傳 up.jpg')
    expect(html).toContain('從清單移除 done.jpg')
    expect(html).toContain('全部取消')
    expect(html).toContain('清除已完成')
    expect(html).toContain('role="alert"')
  })

  it('hides cancel-all once nothing is running', () => {
    const html = render(<UploadList {...listProps} items={[item({ id: 'a', status: 'done' })]} />)
    expect(html).toContain('1／1 張完成 · 100%')
    expect(html).not.toContain('全部取消')
  })
})

describe('StorageMeterView', () => {
  const warnAtBytes = 1.5 * 1024 ** 3
  it('shows use against 1.5 GB without a warning below 80 %', () => {
    const html = render(<StorageMeterView usage={{ bytes: 300 * 1024 ** 2, count: 9, warnAtBytes }} />)
    expect(html).toContain('照片儲存空間')
    expect(html).toContain('已用 300 MB／1.5 GB')
    expect(html).toContain('role="meter"')
    expect(html).toContain('data-tone="ok"')
    expect(html).not.toContain('建議上限')
  })

  it('warns from 80 % and alerts once over', () => {
    const near = render(<StorageMeterView usage={{ bytes: warnAtBytes * 0.85, count: 1, warnAtBytes }} />)
    expect(near).toContain('data-tone="warning"')
    expect(near).toContain('快到這趟旅程的建議上限了')
    const over = render(<StorageMeterView compact usage={{ bytes: warnAtBytes * 1.1, count: 1, warnAtBytes }} />)
    expect(over).toContain('data-tone="danger"')
    expect(over).toContain('已超過這趟旅程的建議上限 1.5 GB')
    expect(over).toContain('role="alert"')
    // compact: no label line
    expect(over).not.toContain('照片儲存空間</span>')
  })
})

describe('PhotoThumb', () => {
  it('shows a skeleton until the photo is fetched', () => {
    const html = render(<PhotoThumb attachmentId="a1" alt="照片 1" />)
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('<img')
  })
})

describe('photo pages', () => {
  it('trip home: the cover photo in the hero and a way to the photos', () => {
    const plain = render(<TripHomePage />)
    expect(plain).toContain('href="/trips/trip1/photos"')
    expect(plain).toContain('設定封面')
    const withCover = render(<TripHomePage />, 'viewer', { coverAttachmentId: 'a1' })
    expect(withCover).toContain('href="/trips/trip1/photos"')
    expect(withCover).not.toContain('設定封面')
    // The cover is loading (skeleton) inside the hero
    expect(withCover).toMatch(/<header[^>]*>.*aria-hidden="true"/)
  })

  it('photos page: heading, uploader for editors and the loading grid', () => {
    const html = render(<PhotosPage />)
    expect(html).toContain('<h1')
    expect(html).toContain('選擇照片')
    expect(html).toContain('aria-busy="true"')
    expect(render(<PhotosPage />, 'viewer')).not.toContain('選擇照片')
  })

  it('orders by capture time, then upload time', () => {
    const photo = (id: string, takenAt: string | null, createdAt: string) =>
      ({ id, takenAt, createdAt }) as Attachment
    const sorted = sortPhotos([
      photo('c', null, '2030-12-22T00:00:00Z'),
      photo('a', '2030-12-20T08:00:00Z', '2030-12-25T00:00:00Z'),
      photo('b', '2030-12-21T09:00:00', '2030-12-25T00:00:00Z'),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('shows UTC capture times in the trip zone and wall-clock ones as recorded', () => {
    // 08:00Z is 16:00 in Bali (UTC+8)
    expect(takenAtText('2030-12-20T08:00:00Z', 'Asia/Makassar', 'en')).toBe('Fri, Dec 20 16:00')
    expect(takenAtText('2030-12-21T09:30:00', 'Asia/Makassar', 'en')).toBe('Sat, Dec 21 09:30')
  })
})

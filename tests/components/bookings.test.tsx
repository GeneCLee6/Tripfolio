import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { DayLodgingSummary, Lodging } from '../../shared/api/bookings.ts'
import type { DayWithStops, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { BookingTypeIcon, PayStatusChip } from '../../src/components/index.ts'
import { primeLodgings, resetLodgingStore } from '../../src/lib/bookings/lodging-store.ts'
import { LodgingLine } from '../../src/pages/bookings/LodgingLine.tsx'

// The day header's 「今晚住」 line (e4-t02) in its states, server-rendered (no DOM). Opening the
// sheet and saving are covered by e2e/bookings.spec.ts.

afterEach(() => {
  setLocale('zh-TW')
  resetLodgingStore()
})

const trip = {
  id: 'trip1',
  name: 'South Island',
  tz: 'Pacific/Auckland',
  startDate: '2027-02-06',
  endDate: '2027-02-09',
  style: 'campervan',
  localCurrencies: ['NZD'],
  baseCurrency: 'AUD',
} as Trip

const day = (extra: Partial<DayWithStops> = {}): DayWithStops => ({
  id: 'd1',
  tripId: 'trip1',
  date: '2027-02-06',
  idx: 1,
  title: '',
  color: null,
  note: '',
  lodgingId: null,
  rev: 1,
  updatedAt: '',
  stops: [],
  ...extra,
})

const summary = (extra: Partial<DayLodgingSummary> = {}): DayLodgingSummary => ({
  id: 'l1',
  name: 'Punakaiki Beach Camp',
  checkOutTime: '10:00',
  isCheckoutDay: false,
  isCheckinDay: true,
  campType: 'holiday-park',
  ...extra,
})

const lodging: Lodging = {
  id: 'l1',
  tripId: 'trip1',
  placeId: null,
  name: 'Punakaiki Beach Camp',
  checkIn: '2027-02-06',
  checkOut: '2027-02-08',
  checkInTime: '14:00',
  checkOutTime: '10:00',
  roomType: null,
  guests: null,
  platform: null,
  ref: null,
  priceMinor: 6800,
  currency: 'NZD',
  payStatus: 'unpaid',
  cancelBy: null,
  phone: null,
  campType: 'holiday-park',
  campFacilities: { power: true, water: false, dump: true },
  note: '',
  rev: 1,
  createdAt: '',
  updatedAt: '',
}

const render = (d: Parameters<typeof LodgingLine>[0]['day'], editable = true) =>
  renderToStaticMarkup(<LodgingLine day={d} trip={trip} editable={editable} />)

describe('LodgingLine', () => {
  it('no lodging: the placeholder and, for an editor, 「還沒安排住宿」 as a button', () => {
    const html = render(day())
    expect(html).toContain('今晚住：—')
    expect(html).toContain('還沒安排住宿')
    expect(html).toContain('<button')
    const viewer = render(day(), false)
    expect(viewer).toContain('今晚住：—')
    expect(viewer).not.toContain('<button')
    expect(viewer).not.toContain('還沒安排住宿')
  })

  it('works on a day from the old days shape (no lodging fields)', () => {
    expect(render(day({ lodgingId: 'x' }))).toContain('今晚住：—')
  })

  it('an unassigned day shows nothing', () => {
    expect(render(day({ idx: null }))).toBe('')
  })

  it('tonight: the name, camp type; with the lodging loaded the check-in time, facilities and price', () => {
    const d = { ...day(), lodging: summary(), checkout: null }
    const bare = render(d)
    expect(bare).toContain('今晚住：')
    expect(bare).toContain('Punakaiki Beach Camp')
    expect(bare).toContain('假日公園')
    expect(bare).not.toContain('有電')

    primeLodgings('trip1', [lodging])
    const html = render(d)
    expect(html).toContain('入住 14:00 起')
    expect(html).toContain('有電')
    expect(html).toContain('傾倒站')
    expect(html).not.toContain('有水')
    expect(html).toContain('第 1／2 晚')
    expect(html).toContain('NZ$68.00')
    expect(html).toContain('aria-label="編輯今晚住宿「Punakaiki Beach Camp」"')
  })

  it('the checkout morning: 「退房 10:00」 and an empty night', () => {
    const d = {
      ...day({ id: 'd3', date: '2027-02-08', idx: 3 }),
      lodging: summary({ isCheckoutDay: true, isCheckinDay: false }),
      checkout: { id: 'l1', name: 'Punakaiki Beach Camp', checkOutTime: '10:00' },
    }
    const html = render(d)
    expect(html).toContain('退房 10:00')
    expect(html).toContain('今晚住：—')
    expect(html).not.toContain('今晚住：<')
  })

  it('moving on: checking out of one and into another the same day', () => {
    const d = {
      ...day({ id: 'd2', date: '2027-02-07', idx: 2 }),
      lodging: summary({ id: 'l2', name: 'Wanaka Lakeview', campType: null }),
      checkout: { id: 'l1', name: 'Punakaiki Beach Camp', checkOutTime: null },
    }
    const html = render(d)
    expect(html).toContain('今天退房')
    expect(html).toContain('Wanaka Lakeview')
  })

  it('the last day of the trip with a checkout asks for no lodging', () => {
    const d = {
      ...day({ id: 'd4', date: '2027-02-09', idx: 4 }),
      lodging: null,
      checkout: { id: 'l1', name: 'Camp', checkOutTime: '10:00' },
    }
    const html = render(d)
    expect(html).toContain('退房 10:00')
    expect(html).not.toContain('還沒安排住宿')
  })

  it('English', () => {
    setLocale('en')
    const html = render({ ...day(), lodging: summary(), checkout: null })
    expect(html).toContain('Tonight: ')
    expect(html).toContain('Holiday park')
  })
})

describe('PayStatusChip and BookingTypeIcon', () => {
  it('names each payment state', () => {
    expect(renderToStaticMarkup(<PayStatusChip status="unpaid" />)).toContain('未付')
    expect(renderToStaticMarkup(<PayStatusChip status="deposit" />)).toContain('已付訂金')
    expect(renderToStaticMarkup(<PayStatusChip status="paid" />)).toContain('已付清')
  })
  it('draws a decorative glyph', () => {
    const html = renderToStaticMarkup(<BookingTypeIcon type="flight" />)
    expect(html).toContain('aria-hidden="true"')
  })
})

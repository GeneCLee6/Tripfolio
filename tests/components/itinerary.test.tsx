import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { DayWithStops, Place, Stop, Trip } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { PlacePicker, StopTypeIcon } from '../../src/components/index.ts'
import { DayBlock } from '../../src/pages/itinerary/DayBlock.tsx'
import { StopCard } from '../../src/pages/itinerary/StopCard.tsx'
import { StopEditor } from '../../src/pages/itinerary/StopEditor.tsx'
import { assembleDay } from '../../src/lib/itinerary/legs.ts'

// Server-rendered itinerary pieces (no DOM): what a stop card, a day and the editor show.
// Searching, saving and moving against the Worker are covered by e2e/itinerary.spec.ts.

afterEach(() => setLocale('zh-TW'))

const trip: Trip = {
  id: 'trip1',
  name: 'South Island',
  destination: 'New Zealand',
  centerLat: -45.03,
  centerLng: 168.66,
  startDate: '2027-02-06',
  endDate: '2027-02-12',
  tz: 'Pacific/Auckland',
  baseCurrency: 'AUD',
  secondaryCurrency: 'TWD',
  localCurrencies: ['NZD'],
  coverColor: '#4C6A92',
  coverAttachmentId: null,
  summary: '',
  style: 'campervan',
  driveLimitMin: null,
  ownerMemberId: 'm1',
  rev: 3,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
}

const ferg: Place = {
  id: 'p1',
  tripId: 'trip1',
  nameLocal: 'Fergburger',
  nameEn: 'Fergburger',
  lat: -45.0318,
  lng: 168.6598,
  address: '42 Shotover Street',
  category: 'food',
  source: 'photon',
  hours: null,
  links: [],
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
}

const glenorchy: Place = { ...ferg, id: 'p2', nameLocal: 'Glenorchy', lat: -44.8513, lng: 168.3871 }

const stop = (extra: Partial<Stop> = {}): Stop => ({
  id: 's1',
  tripId: 'trip1',
  dayId: 'd1',
  order: 1,
  type: 'food',
  title: '',
  placeId: 'p1',
  // 12:00–13:00 in Queenstown (NZDT)
  startAt: '2027-02-06T23:00:00Z',
  endAt: '2027-02-07T00:00:00Z',
  durationMin: null,
  costMinor: 4250,
  currency: 'NZD',
  booking: 'todo',
  note: 'Queue moves fast.\nOrder the Little Lamby.',
  links: [],
  wishlistItemId: null,
  bookingId: null,
  isBackup: false,
  rev: 1,
  updatedAt: '2026-11-09T00:00:00Z',
  ...extra,
})

const noop = () => {}

const card = (s: Stop, place?: Place) =>
  renderToStaticMarkup(
    <StopCard stop={s} place={place} tz={trip.tz} canMoveUp canMoveDown onOpen={noop} />,
  )

describe('StopCard', () => {
  it('shows name, local time, type, booking, cost and the note', () => {
    const html = card(stop(), ferg)
    expect(html).toContain('Fergburger')
    expect(html).toContain('12:00–13:00')
    expect(html).toContain('餐廳')
    expect(html).toContain('需預訂')
    expect(html).toContain('NZ$42.50')
    expect(html).toContain('Queue moves fast. Order the Little Lamby.')
    expect(html).toContain('aria-label="編輯「Fergburger」"')
    expect(html).toContain('aria-haspopup="menu"')
  })

  it('a booked rainy-day stop with a duration, in English', () => {
    setLocale('en')
    const html = card(
      stop({
        title: 'Onsen Hot Pools',
        type: 'rest',
        startAt: null,
        endAt: null,
        durationMin: 90,
        booking: 'booked',
        isBackup: true,
        costMinor: null,
        currency: null,
        note: '',
      }),
    )
    expect(html).toContain('Onsen Hot Pools')
    expect(html).toContain('1 h 30 min')
    expect(html).toContain('Booked')
    expect(html).toContain('Rainy-day plan')
    expect(html).not.toContain('NZ$')
  })

  it('falls back to a placeholder name', () => {
    expect(card(stop({ placeId: null, title: '' }))).toContain('未命名行程點')
  })
})

describe('DayBlock', () => {
  const day: DayWithStops = {
    id: 'd1',
    tripId: 'trip1',
    date: '2027-02-07',
    idx: 2,
    title: 'Queenstown → Glenorchy',
    color: null,
    note: '',
    lodgingId: null,
    rev: 1,
    updatedAt: '2026-11-09T00:00:00Z',
    stops: [stop(), stop({ id: 's2', placeId: 'p2', title: 'Glenorchy wharf', type: 'sight' })],
  }
  const places = new Map([
    ['p1', ferg],
    ['p2', glenorchy],
  ])

  it('renders the header, lodging placeholder, a leg with 估 and the add button', () => {
    const legs = assembleDay(day.stops, places, {
      style: trip.style,
      limitMinutes: null,
      overrides: {},
      cache: new Map(),
    })
    const html = renderToStaticMarkup(
      <DayBlock
        day={day}
        dayColor="#B5654A"
        trip={trip}
        legs={legs}
        places={places}
        onEditDay={noop}
        onAddStop={noop}
        onOpenStop={noop}
        onMove={noop}
        onMoveToDay={noop}
      />,
    )
    expect(html).toContain('Day 2 · Queenstown → Glenorchy')
    expect(html).toContain('2月7日（日）')
    expect(html).toContain('今晚住：—')
    expect(html).toContain('露營車')
    expect(html).toContain('>估<')
    expect(html).toContain('駕駛')
    expect(html).toContain('＋ 加行程點')
  })

  it('an unassigned day says so', () => {
    const html = renderToStaticMarkup(
      <DayBlock
        day={{ ...day, idx: null, stops: [] }}
        dayColor="#B5654A"
        trip={trip}
        legs={undefined}
        places={places}
        onEditDay={noop}
        onAddStop={noop}
        onOpenStop={noop}
        onMove={noop}
        onMoveToDay={noop}
      />,
    )
    expect(html).toContain('未分配 · 原本 2月7日（日）')
    expect(html).toContain('這天還沒有行程點')
    expect(html).not.toContain('今晚住')
  })
})

describe('StopEditor and PlacePicker', () => {
  it('the editor starts from the stop in local time and the trip currency', () => {
    const html = renderToStaticMarkup(
      <StopEditor
        trip={trip}
        date="2027-02-07"
        stop={stop()}
        places={[ferg]}
        bias={null}
        onSubmit={noop}
        onDelete={noop}
        onPlaceCreated={noop}
        onClose={noop}
      />,
    )
    expect(html).toContain('value="12:00"')
    expect(html).toContain('value="13:00"')
    expect(html).toContain('Fergburger')
    expect(html).toContain('<option value="NZD" selected="">NZD</option>')
    expect(html).toContain('刪除行程點')
  })

  it('a new stop opens on the place search with the manual pin option', () => {
    const html = renderToStaticMarkup(
      <StopEditor
        trip={trip}
        date="2027-02-07"
        stop={null}
        places={[]}
        bias={null}
        onSubmit={noop}
        onPlaceCreated={noop}
        onClose={noop}
      />,
    )
    expect(html).toContain('搜尋地點')
    expect(html).toContain('手動放針')
    expect(html).not.toContain('刪除行程點')
  })

  it('PlacePicker and StopTypeIcon render on their own', () => {
    const html = renderToStaticMarkup(
      <PlacePicker tripId="trip1" places={[]} bias={null} onPick={noop} />,
    )
    expect(html).toContain('輸入地名，或貼上 Google 地圖連結／座標')
    expect(renderToStaticMarkup(<StopTypeIcon type="fuel" />)).toContain('<svg')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { Place } from '../../shared/api/types.ts'
import { setLocale } from '../../shared/i18n/t.ts'
import { HoursEditor } from '../../src/components/index.ts'
import { draftFromHours } from '../../src/lib/places/hours.ts'
import { PlaceRow } from '../../src/pages/places/PlaceRow.tsx'

// The place library row and the hours editor (e3-t05), server-rendered

afterEach(() => setLocale('zh-TW'))

const place: Place = {
  id: 'p1',
  tripId: 't1',
  nameLocal: '富士山',
  nameEn: 'Mount Fuji',
  lat: 35.36063,
  lng: 138.72736,
  address: '静岡県',
  category: 'nature',
  source: 'photon',
  hours: null,
  links: [],
  externalId: 'osm:N1',
  rev: 1,
  createdAt: '2026-11-09T00:00:00Z',
  updatedAt: '2026-11-09T00:00:00Z',
}

const noop = () => {}

describe('PlaceRow', () => {
  it('shows names, address, coordinates, ref count, category and source', () => {
    const html = renderToStaticMarkup(
      <PlaceRow place={place} refs={3} actions={[{ key: 'edit', label: '編輯', onSelect: noop }]} />,
    )
    expect(html).toContain('富士山')
    expect(html).toContain('Mount Fuji')
    expect(html).toContain('静岡県')
    expect(html).toContain('35.36063, 138.72736')
    expect(html).toContain('被 3 個項目引用')
    expect(html).toContain('自然')
    expect(html).toContain('Photon')
    expect(html).not.toContain('未使用')
    expect(html).toContain('「富士山」的更多動作')
  })

  it('marks an unused place and has no menu without actions; English name first in English', () => {
    setLocale('en')
    const html = renderToStaticMarkup(
      <PlaceRow place={{ ...place, address: '', source: 'manual' }} refs={0} actions={[]} />,
    )
    expect(html).toContain('Unused')
    expect(html).toContain('No address')
    expect(html).toContain('Manual')
    expect(html.indexOf('Mount Fuji')).toBeLessThan(html.indexOf('富士山'))
    expect(html).not.toContain('aria-haspopup')
  })
})

describe('HoursEditor', () => {
  it('renders weekday rows Monday first, ranges and closed days', () => {
    const value = draftFromHours({ periods: [{ day: 1, open: '09:00', close: '17:00' }] })
    const html = renderToStaticMarkup(<HoursEditor value={value} onChange={noop} />)
    const monday = html.indexOf('data-weekday="1"')
    const sunday = html.indexOf('data-weekday="0"')
    expect(monday).toBeGreaterThan(-1)
    expect(sunday).toBeGreaterThan(monday)
    expect(html).toContain('value="09:00"')
    expect(html).toContain('value="17:00"')
    // Six other days show 休息
    expect(html.match(/休息<\/span>/g)?.length).toBe(6)
  })

  it('says the hours are unknown when empty', () => {
    const html = renderToStaticMarkup(<HoursEditor value={draftFromHours(null)} onChange={noop} />)
    expect(html).toContain('還沒填營業時間')
    expect(html.match(/未填/g)?.length).toBe(7)
  })
})

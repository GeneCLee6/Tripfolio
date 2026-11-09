import { describe, expect, it } from 'vitest'
import {
  joinSchema,
  placeCreateSchema,
  shareCreateSchema,
  stopCreateSchema,
  tripCreateSchema,
  tripPatchSchema,
} from '../../../shared/schema/index.ts'

const trip = {
  name: 'NZ South Island',
  startDate: '2026-12-20',
  endDate: '2027-01-02',
  tz: 'Pacific/Auckland',
  owner: { name: 'Gene', color: 'teal' },
}

describe('trip schema', () => {
  it('fills the defaults: AUD base, TWD secondary, style other', () => {
    const parsed = tripCreateSchema.parse(trip)
    expect(parsed).toMatchObject({
      baseCurrency: 'AUD',
      secondaryCurrency: 'TWD',
      localCurrencies: [],
      style: 'other',
      driveLimitMin: null,
      summary: '',
    })
  })

  it('rejects bad dates, time zones, styles and currencies', () => {
    expect(tripCreateSchema.safeParse({ ...trip, endDate: '2026-12-01' }).success).toBe(false)
    expect(tripCreateSchema.safeParse({ ...trip, startDate: '2026-13-01' }).success).toBe(false)
    expect(tripCreateSchema.safeParse({ ...trip, tz: 'Mars/Olympus' }).success).toBe(false)
    expect(tripCreateSchema.safeParse({ ...trip, style: 'winter' }).success).toBe(false)
    expect(tripCreateSchema.safeParse({ ...trip, baseCurrency: 'aud' }).success).toBe(false)
    expect(tripCreateSchema.safeParse({ ...trip, style: 'private-driver' }).success).toBe(true)
  })

  it('PATCH applies no defaults', () => {
    expect(tripPatchSchema.parse({ name: 'x' })).toEqual({ name: 'x' })
  })
})

describe('other schemas', () => {
  it('stop: cost needs a currency, times are UTC ISO', () => {
    expect(stopCreateSchema.safeParse({ dayId: 'd', costMinor: 500 }).success).toBe(false)
    expect(
      stopCreateSchema.safeParse({ dayId: 'd', costMinor: 500, currency: 'NZD' }).success,
    ).toBe(true)
    expect(
      stopCreateSchema.safeParse({ dayId: 'd', startAt: '2026-12-20T09:00:00Z' }).success,
    ).toBe(true)
    expect(stopCreateSchema.safeParse({ dayId: 'd', startAt: '09:00' }).success).toBe(false)
    expect(
      stopCreateSchema.safeParse({ dayId: 'd', costMinor: 1.5, currency: 'NZD' }).success,
    ).toBe(false)
  })

  it('place: coordinates and http(s) links only', () => {
    const base = { nameLocal: 'Milford Sound', lat: -44.67, lng: 167.92 }
    expect(placeCreateSchema.parse(base)).toMatchObject({ source: 'manual', links: [] })
    expect(placeCreateSchema.safeParse({ ...base, lat: 91 }).success).toBe(false)
    expect(
      placeCreateSchema.safeParse({ ...base, links: [{ url: 'javascript:alert(1)' }] }).success,
    ).toBe(false)
  })

  it('join: an existing member or a new identity', () => {
    expect(joinSchema.safeParse({ memberId: 'm1' }).success).toBe(true)
    expect(joinSchema.safeParse({ name: 'Amy', color: 'rose' }).success).toBe(true)
    expect(joinSchema.safeParse({ name: 'Amy' }).success).toBe(false)
  })

  it('share options default to showing everything but the recap', () => {
    expect(shareCreateSchema.parse({})).toEqual({
      options: { hideMoney: false, hideAddresses: false, showRecap: false },
    })
  })
})

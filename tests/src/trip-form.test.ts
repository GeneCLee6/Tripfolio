import { describe, expect, it } from 'vitest'
import type { Trip } from '../../shared/api/types.ts'
import {
  emptyTripForm,
  fieldOfPath,
  issuesToErrors,
  tripToForm,
  validateCreate,
  validatePatch,
} from '../../src/lib/trip-form.ts'

const filled = () => ({
  ...emptyTripForm('Pacific/Auckland'),
  name: ' South Island ',
  destination: 'New Zealand',
  startDate: '2026-12-20',
  endDate: '2026-12-28',
  localCurrencies: ['NZD'],
  ownerName: 'Gene',
})

describe('validateCreate', () => {
  it('builds the POST /api/trips body with the defaults', () => {
    const result = validateCreate(filled())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body).toMatchObject({
      name: 'South Island',
      baseCurrency: 'AUD',
      secondaryCurrency: 'TWD',
      localCurrencies: ['NZD'],
      centerLat: null,
      centerLng: null,
      style: 'other',
      owner: { name: 'Gene', color: '#0F6E74' },
    })
  })

  it('maps zod issues onto fields', () => {
    const result = validateCreate({ ...filled(), name: ' ', startDate: '', ownerName: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.errors).sort()).toEqual(['name', 'ownerName', 'startDate'])
    expect(result.errors.name?.key).toBe('tripForm.error.name')
  })

  it('rejects an end before the start and trips over 90 days', () => {
    const backwards = validateCreate({ ...filled(), endDate: '2026-12-01' })
    expect(!backwards.ok && backwards.errors.endDate?.key).toBe('tripForm.error.endDate')
    const tooLong = validateCreate({ ...filled(), endDate: '2027-04-01' })
    expect(!tooLong.ok && tooLong.errors.endDate).toEqual({
      key: 'tripForm.error.tooLong',
      params: { max: 90 },
    })
  })

  it('sends no second currency when none is picked', () => {
    const result = validateCreate({ ...filled(), secondaryCurrency: '' })
    expect(result.ok && result.body.secondaryCurrency).toBeNull()
  })
})

describe('validatePatch', () => {
  const trip = {
    id: 't',
    name: 'Bali',
    destination: 'Bali',
    startDate: '2027-02-01',
    endDate: '2027-02-06',
    tz: 'Asia/Makassar',
    baseCurrency: 'AUD',
    secondaryCurrency: null,
    localCurrencies: ['IDR'],
    coverColor: '#B5654A',
    summary: '',
    style: 'private-driver',
  } as unknown as Trip

  it('round-trips a trip through the form without the owner', () => {
    const values = tripToForm(trip)
    expect(values.secondaryCurrency).toBe('')
    const result = validatePatch(values)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.body).not.toHaveProperty('owner')
    expect(result.body).toMatchObject({
      style: 'private-driver',
      coverColor: '#B5654A',
      secondaryCurrency: null,
    })
  })

  it('still checks the date order', () => {
    const result = validatePatch({ ...tripToForm(trip), endDate: '2027-01-01' })
    expect(!result.ok && result.errors.endDate?.key).toBe('tripForm.error.endDate')
  })
})

describe('issue paths', () => {
  it('maps the owner and ignores unknown paths', () => {
    expect(fieldOfPath(['owner', 'name'])).toBe('ownerName')
    expect(fieldOfPath(['owner', 'color'])).toBe('ownerColor')
    expect(fieldOfPath(['nope'])).toBeNull()
    expect(issuesToErrors('junk')).toEqual({})
    expect(issuesToErrors([{ path: ['tz'] }, { path: ['tz'] }, {}])).toEqual({
      tz: { key: 'tripForm.error.tz' },
    })
  })
})

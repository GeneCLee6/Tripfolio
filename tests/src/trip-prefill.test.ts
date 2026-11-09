import { describe, expect, it } from 'vitest'
import { isValidTimeZone } from '../../shared/schema/common.ts'
import { guessFromDestination, TIME_ZONES, timeZoneOptions } from '../../src/lib/trip-prefill.ts'

describe('guessFromDestination', () => {
  it.each([
    ['紐西蘭南島露營車', 'Pacific/Auckland', ['NZD']],
    ['South Island, New Zealand', 'Pacific/Auckland', ['NZD']],
    ['峇里島包車', 'Asia/Makassar', ['IDR']],
    ['Bali', 'Asia/Makassar', ['IDR']],
    ['印尼', 'Asia/Jakarta', ['IDR']],
    ['泰國清邁', 'Asia/Bangkok', ['THB']],
    ['Thailand', 'Asia/Bangkok', ['THB']],
    ['斐濟', 'Pacific/Fiji', ['FJD']],
    ['Fiji islands', 'Pacific/Fiji', ['FJD']],
    ['帛琉', 'Pacific/Palau', ['USD']],
    ['Palau', 'Pacific/Palau', ['USD']],
    ['歐洲', null, ['EUR']],
    ['Europe by rail', null, ['EUR']],
  ])('%s', (destination, tz, currencies) => {
    expect(guessFromDestination(destination)).toEqual({ tz, localCurrencies: currencies })
  })

  it('adds the currencies of every place, in the order written', () => {
    expect(guessFromDestination('歐洲：布拉格、維也納')).toEqual({
      tz: 'Europe/Prague',
      localCurrencies: ['EUR', 'CZK'],
    })
    expect(guessFromDestination('Prague and Vienna')).toEqual({
      tz: 'Europe/Prague',
      localCurrencies: ['CZK', 'EUR'],
    })
  })

  it('leaves unknown places empty', () => {
    expect(guessFromDestination('')).toEqual({ tz: null, localCurrencies: [] })
    expect(guessFromDestination('somewhere warm')).toEqual({ tz: null, localCurrencies: [] })
  })
})

describe('time zones', () => {
  it('offers about forty real zones, the owner’s destinations included', () => {
    expect(TIME_ZONES.length).toBeGreaterThanOrEqual(40)
    for (const zone of TIME_ZONES) expect(isValidTimeZone(zone), zone).toBe(true)
    for (const zone of [
      'Pacific/Auckland',
      'Asia/Makassar',
      'Asia/Bangkok',
      'Pacific/Fiji',
      'Pacific/Palau',
      'Asia/Taipei',
      'Europe/Paris',
      'Australia/Sydney',
    ])
      expect(TIME_ZONES).toContain(zone)
    expect(new Set(TIME_ZONES).size).toBe(TIME_ZONES.length)
  })

  it('puts a missing extra zone first', () => {
    expect(timeZoneOptions('America/Chicago')[0]).toBe('America/Chicago')
    expect(timeZoneOptions('Asia/Taipei')).toEqual([...TIME_ZONES])
  })
})

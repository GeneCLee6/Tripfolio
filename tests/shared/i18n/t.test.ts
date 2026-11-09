import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../../../shared/i18n/en.ts'
import {
  detectLocale,
  getLocale,
  interpolate,
  setLocale,
  subscribeLocale,
  t,
  tp,
} from '../../../shared/i18n/t.ts'
import { zhTW } from '../../../shared/i18n/zh-TW.ts'

afterEach(() => setLocale('zh-TW'))

describe('t()', () => {
  it('uses zh-TW (the source) by default and the current locale after a switch', () => {
    expect(getLocale()).toBe('zh-TW')
    expect(t('term.logExpense')).toBe('記一筆')
    setLocale('en')
    expect(t('term.logExpense')).toBe('Log expense')
  })

  it('takes an explicit locale without changing the current one', () => {
    expect(t('term.settleUp', undefined, 'en')).toBe('Settle up')
    expect(getLocale()).toBe('zh-TW')
  })

  it('fills placeholders, numbers included, and leaves unknown ones visible', () => {
    expect(t('day.label', { n: 3 })).toBe('第 3 天')
    expect(t('day.label', { n: 3 }, 'en')).toBe('Day 3')
    expect(t('money.invalid', {}, 'en')).toBe('Enter a valid amount, up to {digits} decimals')
    expect(interpolate('{a} and {a} but {b}', { a: 'x' })).toBe('x and x but {b}')
  })

  it('tells subscribers about a change, once', () => {
    const seen: string[] = []
    const unsubscribe = subscribeLocale((locale) => seen.push(locale))
    setLocale('en')
    setLocale('en')
    unsubscribe()
    setLocale('zh-TW')
    expect(seen).toEqual(['en'])
  })
})

describe('tp() plurals', () => {
  it('picks one/other with Intl.PluralRules in English', () => {
    expect(tp('count.stops', 1, undefined, 'en')).toBe('1 stop')
    expect(tp('count.stops', 0, undefined, 'en')).toBe('0 stops')
    expect(tp('count.stops', 2, undefined, 'en')).toBe('2 stops')
    expect(tp('count.members', 1, undefined, 'en')).toBe('1 person')
  })

  it('uses other for every count in Chinese', () => {
    expect(tp('count.stops', 1, undefined, 'zh-TW')).toBe('1 個行程點')
    expect(tp('count.days', 12, undefined, 'zh-TW')).toBe('12 天')
  })

  it('formats the count with the locale number format', () => {
    expect(tp('count.stops', 1200, undefined, 'en')).toBe('1,200 stops')
  })
})

describe('detectLocale()', () => {
  it('gives zh-TW to any Chinese and English to anything else', () => {
    expect(detectLocale(['zh-TW', 'en'])).toBe('zh-TW')
    expect(detectLocale(['zh-HK'])).toBe('zh-TW')
    expect(detectLocale(['zh'])).toBe('zh-TW')
    expect(detectLocale(['en-AU', 'zh-TW'])).toBe('en')
    expect(detectLocale(['ja-JP'])).toBe('en')
  })

  it('keeps the default when the browser says nothing', () => {
    expect(detectLocale([])).toBe('zh-TW')
    expect(detectLocale(undefined)).toBe('zh-TW')
  })
})

describe('catalogs', () => {
  it('have the same keys and placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort())
    const holes = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(zhTW) as (keyof typeof zhTW)[]) {
      expect(holes(en[key]), key).toEqual(holes(zhTW[key]))
    }
  })

  it('carry the DESIGN.md glossary', () => {
    expect([zhTW['term.sharedFund'], en['term.sharedFund']]).toEqual(['公基金', 'Shared fund'])
    expect([zhTW['term.getsBack'], en['term.getsBack']]).toEqual(['應收', 'Gets back'])
    expect([zhTW['term.leg'], en['term.leg']]).toEqual(['移動段', 'Leg'])
  })
})

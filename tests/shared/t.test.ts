import { describe, expect, it } from 'vitest'
import { en } from '../../shared/i18n/en.ts'
import { getLanguage, setLanguage, t } from '../../shared/i18n/t.ts'
import { zhTW } from '../../shared/i18n/zh-TW.ts'

describe('t()', () => {
  it('defaults to Traditional Chinese', () => {
    expect(getLanguage()).toBe('zh-TW')
    expect(t('app.name')).toBe('旅誌')
  })

  it('switches language and fills placeholders', () => {
    setLanguage('en')
    expect(t('health.ok', { version: 'abc123' })).toBe('Server OK · version abc123')
    setLanguage('zh-TW')
    expect(t('health.ok', { version: 'abc123' })).toBe('伺服器正常 · 版本 abc123')
  })

  it('leaves an unknown placeholder visible', () => {
    expect(t('health.ok', {}, 'en')).toBe('Server OK · version {version}')
  })

  it('has the same keys in both catalogs', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhTW).sort())
  })
})

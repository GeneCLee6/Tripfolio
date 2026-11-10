import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../../../shared/i18n/t.ts'
import { ApiError } from '../../../src/lib/api.ts'
import {
  cfMeters,
  doGbSeconds,
  formatPct,
  metricLabelKey,
  usageErrorKind,
} from '../../../src/lib/admin/usage.ts'
import { Meter } from '../../../src/components/index.ts'
import UsagePage from '../../../src/pages/admin/UsagePage.tsx'

// e11-t05: the usage page's helpers and the meter's 80 % / over states. Server rendering, so
// nothing is fetched.

afterEach(() => setLocale('zh-TW'))

describe('usage helpers', () => {
  it('maps API errors to messages', () => {
    expect(usageErrorKind(new ApiError(503, 'admin_disabled', ''))).toBe('disabled')
    expect(usageErrorKind(new ApiError(403, 'forbidden', ''))).toBe('forbidden')
    expect(usageErrorKind(new ApiError(429, 'rate_limited', ''))).toBe('rateLimited')
    expect(usageErrorKind(new ApiError(500, 'internal', ''))).toBe('other')
    expect(usageErrorKind(new Error('x'))).toBe('other')
  })
  it('formats percentages in the locale', () => {
    expect(formatPct(85, 'en')).toBe('85%')
    expect(formatPct(12.5, 'en')).toBe('12.5%')
  })
  it('labels every warning metric', () => {
    expect(metricLabelKey('external.ors')).toBe('admin.usage.provider.ors')
    expect(metricLabelKey('r2')).toBe('admin.usage.metric.r2')
    expect(metricLabelKey('cf.do')).toBe('admin.usage.cf.do')
  })
  it('builds the Cloudflare meters against the free limits', () => {
    const meters = cfMeters({ requests24h: 1000, d1Reads: 5, d1Writes: 7, doDuration: 80 }, 'en')
    expect(meters.map((m) => [m.key, m.value, m.limit])).toEqual([
      ['requests', 1000, 100_000],
      ['d1Reads', 5, 5_000_000],
      ['d1Writes', 7, 100_000],
      ['do', doGbSeconds(80), 13_000],
    ])
    expect(meters[0]?.used).toBe('1,000')
    expect(meters[3]?.used).toBe('10')
  })
})

describe('Meter', () => {
  const render = (value: number) =>
    renderToStaticMarkup(
      <Meter label="ORS" value={value} limit={100} valueText="x" nearText="NEAR" overText="OVER" />,
    )
  it('is calm below 80 %', () => {
    const html = render(79)
    expect(html).toContain('data-tone="ok"')
    expect(html).not.toContain('NEAR')
  })
  it('warns from 80 % with a text line', () => {
    const html = render(80)
    expect(html).toContain('data-tone="warning"')
    expect(html).toContain('NEAR')
    expect(html).toContain('role="meter"')
  })
  it('is danger over the limit', () => {
    const html = render(101)
    expect(html).toContain('data-tone="danger"')
    expect(html).toContain('OVER')
    expect(html).toContain('aria-valuenow="100"')
  })
})

describe('UsagePage', () => {
  it('asks for the key when the address has none', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/admin/usage']}>
        <UsagePage />
      </MemoryRouter>,
    )
    expect(html).toContain('輸入管理金鑰')
    expect(html).toContain('type="password"')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import '../../shared/i18n/t.ts'
import { BarList, SegmentBar, Sparkline } from '../../src/components/index.ts'

// BarList, SegmentBar and Sparkline (e7-t06): labels and values as text, bars sized against the
// largest value, zero parts left out of the stacked bar but kept in its legend.

describe('BarList', () => {
  const html = renderToStaticMarkup(
    <BarList
      label="By category"
      items={[
        { key: 'fuel', label: 'Fuel', value: 6000, valueText: 'A$60.00', detail: '60%' },
        { key: 'food', label: 'Food', value: 3000, valueText: 'A$30.00', detail: '30%' },
        { key: 'misc', label: 'Misc', value: 0, valueText: 'A$0.00' },
        { key: 'neg', label: 'Refund', value: -50, valueText: '-A$0.50' },
      ]}
    />,
  )

  it('is a named list with every label, value and detail as text', () => {
    expect(html).toContain('aria-label="By category"')
    expect(html.match(/<li/g)).toHaveLength(4)
    for (const text of ['Fuel', 'A$60.00', '60%', 'Food', 'A$30.00', '30%', 'Misc'])
      expect(html).toContain(text)
  })

  it('keeps the bars out of the accessibility tree and in item order', () => {
    expect(html).toContain('aria-hidden="true"')
    expect(html.indexOf('data-bar="fuel"')).toBeLessThan(html.indexOf('data-bar="food"'))
  })

  it('draws the bars against the largest item (100%, 50%, 0, 0)', () => {
    const shares = [...html.matchAll(/data-share="([\d.]+)"/g)].map((m) => Number(m[1]))
    expect(shares).toEqual([1, 0.5, 0, 0])
  })
})

describe('SegmentBar', () => {
  const html = renderToStaticMarkup(
    <SegmentBar
      label="Share of the costs"
      segments={[
        { key: 'a', label: 'Gene', value: 2000, colorIndex: 0, detail: '50%' },
        { key: 'b', label: 'Mei', value: 2000, colorIndex: 1, detail: '50%' },
        { key: 'c', label: 'Lin', value: 0, colorIndex: 2, detail: '0%' },
      ]}
    />,
  )

  it('names every member in the legend with the percentage', () => {
    expect(html).toContain('aria-label="Share of the costs"')
    for (const text of ['Gene', 'Mei', 'Lin', '50%', '0%']) expect(html).toContain(text)
    expect(html.match(/<li/g)).toHaveLength(3)
  })

  it('draws only the positive parts, each with a tooltip', () => {
    expect(html.match(/data-segment=/g)).toHaveLength(2)
    expect(html).toContain('title="Gene 50%"')
    expect(html).not.toContain('data-segment="c"')
  })

  it('draws an empty track when nothing is positive', () => {
    const empty = renderToStaticMarkup(
      <SegmentBar label="x" segments={[{ key: 'a', label: 'Gene', value: 0, colorIndex: 0 }]} />,
    )
    expect(empty).not.toContain('data-segment=')
    expect(empty).toContain('Gene')
  })
})

describe('Sparkline', () => {
  it('is a named image with a line through every value and a dot on the last', () => {
    const html = renderToStaticMarkup(<Sparkline label="Trend" values={[0, 10, 5]} width={100} height={20} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Trend"')
    expect(html).toContain('points="2,18 50,2 98,10"')
    expect(html).toContain('cx="98"')
  })

  it('draws only a dot for a single value', () => {
    const html = renderToStaticMarkup(<Sparkline label="Trend" values={[5]} />)
    expect(html).not.toContain('<polyline')
    expect(html).toContain('<circle')
  })
})

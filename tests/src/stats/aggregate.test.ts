import { describe, expect, it } from 'vitest'
import type { SummaryRow } from '../../../shared/api/expenses.ts'
import {
  averageDays,
  categoryBars,
  daysBetween,
  eachDate,
  fillDays,
  kpis,
  MAX_DAYS,
  memberStats,
  percentages,
  rangeBounds,
} from '../../../src/lib/stats/aggregate.ts'

// The statistics page's pure helpers (e7-t06)

const trip = { startDate: '2030-02-01', endDate: '2030-02-05' }

describe('rangeBounds', () => {
  const custom = { from: '2030-02-02', to: '' }
  it('maps the quick ranges to from / to', () => {
    expect(rangeBounds('all', custom, trip, '2030-02-03')).toEqual({ from: null, to: null })
    expect(rangeBounds('today', custom, trip, '2030-02-03')).toEqual({
      from: '2030-02-03',
      to: '2030-02-03',
    })
    expect(rangeBounds('trip', custom, trip, '2030-02-03')).toEqual({
      from: '2030-02-01',
      to: '2030-02-05',
    })
    expect(rangeBounds('custom', custom, trip, '2030-02-03')).toEqual({
      from: '2030-02-02',
      to: null,
    })
  })
})

describe('dates', () => {
  it('counts and lists days across month ends', () => {
    expect(daysBetween('2030-02-27', '2030-03-02')).toBe(3)
    expect(eachDate('2030-02-27', '2030-03-02')).toEqual([
      '2030-02-27',
      '2030-02-28',
      '2030-03-01',
      '2030-03-02',
    ])
    expect(eachDate('2030-03-02', '2030-03-01')).toEqual([])
    expect(eachDate('2000-01-01', '2100-01-01')).toHaveLength(MAX_DAYS)
  })
})

describe('fillDays', () => {
  const rows: SummaryRow[] = [
    { key: '2030-02-02', baseMinor: 1000, count: 2 },
    { key: '2030-02-04', baseMinor: 500, count: 1 },
  ]

  it('fills the gaps with zero days over the whole trip when the range is open', () => {
    const days = fillDays(rows, { from: null, to: null }, trip)
    expect(days.map((d) => [d.date, d.baseMinor, d.count, d.dayIndex])).toEqual([
      ['2030-02-01', 0, 0, 0],
      ['2030-02-02', 1000, 2, 1],
      ['2030-02-03', 0, 0, 2],
      ['2030-02-04', 500, 1, 3],
      ['2030-02-05', 0, 0, 4],
    ])
  })

  it('reaches past the trip for rows outside it, without a day colour there', () => {
    const days = fillDays(
      [...rows, { key: '2030-02-07', baseMinor: 300, count: 1 }],
      { from: null, to: null },
      trip,
    )
    expect(days).toHaveLength(7)
    expect(days[6]).toEqual({ date: '2030-02-07', baseMinor: 300, count: 1, dayIndex: null })
  })

  it('keeps to the range when one is chosen', () => {
    const days = fillDays(rows, { from: '2030-02-02', to: '2030-02-03' }, trip)
    expect(days.map((d) => d.date)).toEqual(['2030-02-02', '2030-02-03'])
    expect(days.reduce((sum, d) => sum + d.baseMinor, 0)).toBe(1000)
  })
})

describe('percentages', () => {
  it('always adds up to 100 (largest remainder)', () => {
    for (const values of [
      [1, 1, 1],
      [2, 1, 1, 1, 1, 1, 1],
      [333, 333, 334],
      [1, 0, 0, 999_999],
      [17, 23, 31, 7, 11, 5, 3, 2],
    ]) {
      const out = percentages(values)
      expect(out.reduce((a, b) => a + b, 0)).toBe(100)
      expect(out.every((p) => Number.isInteger(p) && p >= 0)).toBe(true)
    }
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33])
  })

  it('is all zeros without a positive total, and ignores negatives', () => {
    expect(percentages([0, 0])).toEqual([0, 0])
    expect(percentages([])).toEqual([])
    expect(percentages([-5, 5])).toEqual([0, 100])
  })
})

describe('categoryBars', () => {
  it('sorts largest first with percentages summing to 100', () => {
    const bars = categoryBars([
      { key: 'food', baseMinor: 3000, count: 3 },
      { key: 'fuel', baseMinor: 6000, count: 1 },
      { key: 'tickets', baseMinor: 1000, count: 1 },
    ])
    expect(bars.map((b) => [b.category, b.percent])).toEqual([
      ['fuel', 60],
      ['food', 30],
      ['tickets', 10],
    ])
  })
})

describe('memberStats', () => {
  const members = [
    { id: 'a', name: 'Gene', color: '#0F6E74' },
    { id: 'b', name: 'Mei', color: '#B5654A' },
    { id: 'c', name: 'Lin', color: '#5B7B4A' },
  ]

  it('orders by member, works out paid − share and share percentages', () => {
    const rows: SummaryRow[] = [
      { key: 'c', baseMinor: 1000, count: 1, paidMinor: 0, shareMinor: 1000 },
      { key: 'a', baseMinor: 1000, count: 1, paidMinor: 3000, shareMinor: 1000 },
      { key: 'gone', baseMinor: 0, count: 0, paidMinor: 500, shareMinor: 0 },
      { key: 'b', baseMinor: 1000, count: 1, paidMinor: 0, shareMinor: 1000 },
    ]
    const stats = memberStats(rows, members)
    expect(stats.map((s) => s.memberId)).toEqual(['a', 'b', 'c', 'gone'])
    expect(stats[0]).toMatchObject({ name: 'Gene', paidMinor: 3000, shareMinor: 1000, diffMinor: 2000, colorIndex: 0 })
    expect(stats[1]).toMatchObject({ name: 'Mei', diffMinor: -1000, colorIndex: 1 })
    expect(stats[3]).toMatchObject({ name: null, paidMinor: 500, sharePercent: 0 })
    expect(stats.reduce((sum, s) => sum + s.sharePercent, 0)).toBe(100)
    // paid and share both add up to what was spent by members
    expect(stats.reduce((sum, s) => sum + s.diffMinor, 0)).toBe(500)
  })
})

describe('averages', () => {
  const days = ['2030-02-01', '2030-02-02', '2030-02-03', '2030-02-04'].map((date) => ({ date }))
  it('divides by the days so far, or the whole range before it starts', () => {
    expect(averageDays(days, '2030-02-02')).toBe(2)
    expect(averageDays(days, '2030-03-01')).toBe(4)
    expect(averageDays(days, '2030-01-01')).toBe(4)
    expect(averageDays([], '2030-01-01')).toBe(1)
  })

  it('rounds the averages to whole minor units', () => {
    expect(kpis(1000, 3, 2)).toEqual({ totalMinor: 1000, perPersonMinor: 333, perDayMinor: 500 })
    expect(kpis(1000, 0, 0)).toEqual({ totalMinor: 1000, perPersonMinor: 1000, perDayMinor: 1000 })
  })
})

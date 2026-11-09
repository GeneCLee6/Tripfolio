import { describe, expect, it } from 'vitest'
import { addDays, dayCount, planDays } from '../../worker/trips/day-plan.ts'
import { MIN_ORDER_GAP, orderBetween, planPlacement } from '../../worker/trips/order.ts'

describe('orderBetween', () => {
  it('handles empty, ends and middle', () => {
    expect(orderBetween(null, null)).toBe(1)
    expect(orderBetween(null, 1)).toBe(0)
    expect(orderBetween(3, null)).toBe(4)
    expect(orderBetween(1, 2)).toBe(1.5)
  })
})

describe('planPlacement', () => {
  const day = [
    { id: 'a', order: 1 },
    { id: 'b', order: 2 },
    { id: 'c', order: 3 },
  ]

  it('appends, prepends and inserts after a sibling', () => {
    expect(planPlacement(day, 'end')).toEqual({ order: 4, renumbered: [] })
    expect(planPlacement(day, null)).toEqual({ order: 0, renumbered: [] })
    expect(planPlacement(day, 'a')).toEqual({ order: 1.5, renumbered: [] })
    expect(planPlacement(day, 'c')).toEqual({ order: 4, renumbered: [] })
    expect(planPlacement([], null)).toEqual({ order: 1, renumbered: [] })
  })

  it('returns null for an unknown afterId', () => {
    expect(planPlacement(day, 'zzz')).toBeNull()
  })

  it('renumbers when the gap gets too small', () => {
    const tight = [
      { id: 'a', order: 1 },
      { id: 'b', order: 1 + MIN_ORDER_GAP / 2 },
      { id: 'c', order: 5 },
    ]
    const placed = planPlacement(tight, 'a')
    expect(placed).toEqual({
      order: 1.5,
      renumbered: [
        { id: 'b', order: 2 },
        { id: 'c', order: 3 },
      ],
    })
  })

  it('survives many inserts at the same spot', () => {
    let items = [
      { id: 'first', order: 1 },
      { id: 'last', order: 2 },
    ]
    for (let i = 0; i < 100; i++) {
      const placed = planPlacement(items, 'first')
      if (!placed) throw new Error('placement failed')
      const changed = new Map(placed.renumbered.map((r) => [r.id, r.order]))
      items = items.map((s) => ({ ...s, order: changed.get(s.id) ?? s.order }))
      items.splice(1, 0, { id: `n${i}`, order: placed.order })
      items.sort((x, y) => x.order - y.order)
    }
    expect(items[0].id).toBe('first')
    expect(items[1].id).toBe('n99')
    expect(items[items.length - 1].id).toBe('last')
    const orders = items.map((s) => s.order)
    expect(new Set(orders).size).toBe(orders.length)
  })
})

describe('planDays', () => {
  it('counts and adds dates across month ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(dayCount('2026-12-20', '2027-01-02')).toBe(14)
  })

  it('creates every date for a new trip', () => {
    expect(planDays([], '2026-12-20', '2026-12-22')).toEqual({
      assign: [],
      unassign: [],
      create: [
        { date: '2026-12-20', idx: 1 },
        { date: '2026-12-21', idx: 2 },
        { date: '2026-12-22', idx: 3 },
      ],
    })
  })

  const existing = [
    { id: 'd1', date: '2026-12-20', idx: 1 },
    { id: 'd2', date: '2026-12-21', idx: 2 },
    { id: 'd3', date: '2026-12-22', idx: 3 },
  ]

  it('keeps extra days as unassigned when the range shrinks', () => {
    expect(planDays(existing, '2026-12-20', '2026-12-21')).toEqual({
      assign: [],
      unassign: ['d3'],
      create: [],
    })
  })

  it('moves the plan along when the trip shifts', () => {
    const plan = planDays(existing, '2026-12-25', '2026-12-27')
    expect(plan.assign).toEqual([
      { id: 'd1', date: '2026-12-25', idx: 1 },
      { id: 'd2', date: '2026-12-26', idx: 2 },
      { id: 'd3', date: '2026-12-27', idx: 3 },
    ])
    expect(plan.create).toEqual([])
  })

  it('re-attaches unassigned days before creating new ones', () => {
    const shrunk = [...existing.slice(0, 2), { id: 'd3', date: '2026-12-22', idx: null }]
    expect(planDays(shrunk, '2026-12-20', '2026-12-23')).toEqual({
      assign: [{ id: 'd3', date: '2026-12-22', idx: 3 }],
      unassign: [],
      create: [{ date: '2026-12-23', idx: 4 }],
    })
  })
})

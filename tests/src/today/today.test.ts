import { describe, expect, it } from 'vitest'
import type { BudgetCategoryProgress, Checklist, ChecklistItem } from '../../../shared/api/prep.ts'
import type { Stop } from '../../../shared/api/types.ts'
import { budgetGaps } from '../../../src/lib/today/budget-gaps.ts'
import { countdownLabel } from '../../../src/lib/today/countdown.ts'
import {
  dayFor,
  homePhase,
  pretripProgress,
  todayStops,
  todayTodos,
  tripToday,
  weatherPoint,
  weatherUrl,
} from '../../../src/lib/today/today.ts'
import type { Translate } from '../../../src/lib/i18n.ts'
import { countdown } from '../../../src/lib/trip-groups.ts'

const trip = (
  startDate: string,
  endDate: string,
  extra: { tz?: string; archivedAt?: string } = {},
) => ({
  startDate,
  endDate,
  tz: extra.tz ?? 'Pacific/Auckland',
  archivedAt: extra.archivedAt ?? null,
  centerLat: -45.03 as number | null,
  centerLng: 168.66 as number | null,
})

// 10:59Z on 9 Nov = 23:59 in Auckland (UTC+13); 11:00Z = 00:00 on 10 Nov there
const BEFORE_MIDNIGHT = Date.UTC(2026, 10, 9, 10, 59)
const AFTER_MIDNIGHT = Date.UTC(2026, 10, 9, 11, 0)

describe('today in the trip time zone', () => {
  it('flips at midnight in the trip zone, not the browser or UTC', () => {
    expect(tripToday(trip('2026-11-10', '2026-11-14'), BEFORE_MIDNIGHT)).toBe('2026-11-09')
    expect(tripToday(trip('2026-11-10', '2026-11-14'), AFTER_MIDNIGHT)).toBe('2026-11-10')
    // The same instant is still 19:00 on 9 Nov in Taipei
    const taipei = trip('2026-11-10', '2026-11-14', { tz: 'Asia/Taipei' })
    expect(tripToday(taipei, AFTER_MIDNIGHT)).toBe('2026-11-09')
  })

  it('picks the assigned day dated today, ignoring unassigned days with the same old date', () => {
    const days = [
      { id: 'old', date: '2026-11-10', idx: null },
      { id: 'd1', date: '2026-11-10', idx: 1 },
      { id: 'd2', date: '2026-11-11', idx: 2 },
    ]
    expect(dayFor(days, '2026-11-10')?.id).toBe('d1')
    expect(dayFor(days, '2026-11-12')).toBeNull()
  })
})

describe('phase', () => {
  const nz = trip('2026-11-10', '2026-11-14')

  it('is before until local midnight of the start date, then today', () => {
    expect(homePhase(nz, BEFORE_MIDNIGHT)).toBe('before')
    expect(homePhase(nz, AFTER_MIDNIGHT)).toBe('today')
  })

  it('is after from the day after the end date, and for archived trips', () => {
    // 15 Nov 00:00 in Auckland = 14 Nov 11:00Z
    expect(homePhase(nz, Date.UTC(2026, 10, 14, 10, 59))).toBe('today')
    expect(homePhase(nz, Date.UTC(2026, 10, 14, 11, 0))).toBe('after')
    expect(homePhase({ ...nz, archivedAt: 'x' }, AFTER_MIDNIGHT)).toBe('after')
  })

  it('countdown text: days to go, day N of M, nothing after', () => {
    const fake = Object.assign(
      (key: string, params?: Record<string, unknown>) => `${key}:${JSON.stringify(params ?? {})}`,
      { plural: (base: string, count: number) => `${base}:${count}` },
    ) as unknown as Translate
    expect(countdownLabel(fake, countdown(nz, BEFORE_MIDNIGHT))).toBe('count.daysToGo:1')
    expect(countdownLabel(fake, countdown(nz, AFTER_MIDNIGHT))).toBe(
      'trips.dayOf:{"day":1,"total":5}',
    )
    expect(countdownLabel(fake, countdown(nz, Date.UTC(2026, 10, 20)))).toBeNull()
    expect(countdownLabel(fake, countdown({ ...nz, archivedAt: 'x' }, AFTER_MIDNIGHT))).toBeNull()
  })
})

const stop = (id: string, order: number, isBackup = false) =>
  ({ id, order, isBackup, type: 'sight', title: id }) as Stop

describe('stops', () => {
  it('keeps order, drops backups, shows the first five', () => {
    const stops = [
      stop('c', 3),
      stop('a', 1),
      stop('b', 2, true),
      ...[4, 5, 6, 7, 8].map((n) => stop(`s${n}`, n)),
    ]
    const result = todayStops(stops)
    expect(result.shown.map((s) => s.id)).toEqual(['a', 'c', 's4', 's5', 's6'])
    expect(result.more).toBe(2)
    expect(result.all).toHaveLength(7)
  })
})

const item = (id: string, extra: Partial<ChecklistItem>): ChecklistItem =>
  ({
    id,
    checklistId: 'l',
    text: id,
    done: false,
    assigneeMemberId: null,
    dueAt: null,
    order: 0,
    ...extra,
  }) as ChecklistItem

const list = (id: string, kind: 'pretrip' | 'packing', items: ChecklistItem[], order = 0) =>
  ({ id, kind, title: id, order, items }) as Checklist

describe('to-dos', () => {
  const lists = [
    list('pre', 'pretrip', [
      item('today-me', { dueAt: '2026-11-10', assigneeMemberId: 'me', order: 1 }),
      item('today-nobody', { dueAt: '2026-11-10', order: 2 }),
      item('today-other', { dueAt: '2026-11-10', assigneeMemberId: 'other' }),
      item('today-done', { dueAt: '2026-11-10', done: true }),
      item('tomorrow', { dueAt: '2026-11-11' }),
      item('no-date', {}),
      item('overdue', { dueAt: '2026-11-08', order: 3 }),
    ]),
    list('pack', 'packing', [item('pack-today', { dueAt: '2026-11-10', done: true })], 1),
  ]

  it('shows open items due today or overdue, mine or unassigned, overdue first', () => {
    const todos = todayTodos(lists, '2026-11-10', 'me')
    expect(todos.map((x) => x.item.id)).toEqual(['overdue', 'today-me', 'today-nobody'])
    expect(todos[0].overdue).toBe(true)
    expect(todos[0].listTitle).toBe('pre')
  })

  it('counts pre-trip progress only', () => {
    expect(pretripProgress(lists)).toEqual({ done: 1, total: 7 })
    expect(pretripProgress([])).toEqual({ done: 0, total: 0 })
  })
})

describe('weather link', () => {
  it('prefers the first stop, falls back to the trip centre, else none', () => {
    const t = trip('2026-11-10', '2026-11-14')
    expect(weatherPoint(t, { lat: -44.5, lng: 169.1 })).toEqual({ lat: -44.5, lng: 169.1 })
    expect(weatherPoint(t, { lat: null, lng: null })).toEqual({ lat: -45.03, lng: 168.66 })
    expect(weatherPoint({ centerLat: null, centerLng: null }, null)).toBeNull()
    expect(weatherPoint({ centerLat: 120, centerLng: 0 }, null)).toBeNull()
    expect(weatherUrl({ lat: -45.03, lng: 168.66 })).toBe(
      'https://www.windy.com/?-45.030,168.660,10',
    )
  })
})

describe('budget gaps', () => {
  const c = (category: string, plannedMinor: number, actualMinor: number | null) =>
    ({
      category,
      plannedMinor,
      actualMinor,
      remainingMinor: actualMinor === null ? null : plannedMinor - actualMinor,
    }) as BudgetCategoryProgress

  it('takes the three furthest from budget, skipping unbudgeted and untracked ones', () => {
    const gaps = budgetGaps([
      c('flights', 100000, null),
      c('lodging', 50000, 70000),
      c('food', 30000, 10000),
      c('fuel', 20000, 19000),
      c('shopping', 0, 5000),
      c('tickets', 10000, 0),
    ])
    expect(gaps.map((g) => g.category)).toEqual(['lodging', 'food', 'tickets'])
    expect(gaps[0].remainingMinor).toBe(-20000)
  })
})

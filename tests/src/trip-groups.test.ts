import { describe, expect, it } from 'vitest'
import {
  countdown,
  daysBetween,
  groupTrips,
  todayIn,
  tripLength,
  tripPhase,
} from '../../src/lib/trip-groups.ts'

const trip = (
  id: string,
  startDate: string,
  endDate: string,
  extra: { tz?: string; archivedAt?: string | null } = {},
) => ({
  id,
  startDate,
  endDate,
  tz: extra.tz ?? 'Pacific/Auckland',
  archivedAt: extra.archivedAt ?? null,
})

// 2026-11-09T12:00Z is 2026-11-10 01:00 in Auckland (NZDT, UTC+13) and 2026-11-09 20:00 in Taipei
const NOW = Date.UTC(2026, 10, 9, 12, 0)

describe('dates', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-11-09', '2026-11-14')).toBe(5)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(tripLength({ startDate: '2026-11-09', endDate: '2026-11-09' })).toBe(1)
    expect(tripLength({ startDate: '2026-02-27', endDate: '2026-03-02' })).toBe(4)
  })

  it("reads today in the trip's zone, not the browser's", () => {
    expect(todayIn('Pacific/Auckland', NOW)).toBe('2026-11-10')
    expect(todayIn('Asia/Taipei', NOW)).toBe('2026-11-09')
    expect(todayIn('Not/AZone', NOW)).toBe('2026-11-09')
  })
})

describe('tripPhase', () => {
  it('is ongoing from the first to the last day, in the trip zone', () => {
    // Already the 10th in Auckland: a trip starting on the 10th has begun there
    expect(tripPhase(trip('a', '2026-11-10', '2026-11-20'), NOW)).toBe('ongoing')
    expect(tripPhase(trip('a', '2026-11-10', '2026-11-20', { tz: 'Asia/Taipei' }), NOW)).toBe(
      'upcoming',
    )
    expect(tripPhase(trip('a', '2026-11-01', '2026-11-10'), NOW)).toBe('ongoing')
    expect(tripPhase(trip('a', '2026-11-01', '2026-11-09'), NOW)).toBe('past')
  })

  it('puts archived trips in the past whatever their dates', () => {
    expect(
      tripPhase(trip('a', '2027-01-01', '2027-01-05', { archivedAt: '2026-11-01T00:00:00Z' }), NOW),
    ).toBe('past')
  })
})

describe('countdown', () => {
  it('counts days to go, the day of the trip, or over', () => {
    expect(countdown(trip('a', '2026-11-13', '2026-11-20'), NOW)).toEqual({
      kind: 'upcoming',
      days: 3,
    })
    expect(countdown(trip('a', '2026-11-11', '2026-11-20'), NOW)).toEqual({
      kind: 'upcoming',
      days: 1,
    })
    expect(countdown(trip('a', '2026-11-08', '2026-11-12'), NOW)).toEqual({
      kind: 'ongoing',
      day: 3,
      of: 5,
    })
    expect(countdown(trip('a', '2026-10-01', '2026-10-05'), NOW)).toEqual({ kind: 'past' })
    expect(countdown(trip('a', '2027-01-01', '2027-01-05', { archivedAt: 'x' }), NOW)).toEqual({
      kind: 'archived',
    })
  })
})

describe('groupTrips', () => {
  it('sorts upcoming soonest first and past most recent first', () => {
    const entries = [
      { trip: trip('late', '2027-03-01', '2027-03-05') },
      { trip: trip('old', '2025-01-01', '2025-01-03') },
      { trip: trip('soon', '2026-12-01', '2026-12-05') },
      { trip: trip('now', '2026-11-05', '2026-11-15') },
      { trip: trip('recent', '2026-10-01', '2026-10-03') },
      { trip: trip('shelved', '2027-05-01', '2027-05-02', { archivedAt: '2026-11-01T00:00:00Z' }) },
    ]
    const groups = groupTrips(entries, (entry) => entry.trip, NOW)
    const ids = (list: typeof entries) => list.map((entry) => entry.trip.id)
    expect(ids(groups.upcoming)).toEqual(['soon', 'late'])
    expect(ids(groups.ongoing)).toEqual(['now'])
    expect(ids(groups.past)).toEqual(['shelved', 'recent', 'old'])
  })
})

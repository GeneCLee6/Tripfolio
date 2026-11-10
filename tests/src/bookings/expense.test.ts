import { describe, expect, it } from 'vitest'
import type { Booking, Lodging } from '../../../shared/api/bookings.ts'
import {
  EXPENSE_CATEGORY_OF_BOOKING,
  bookingExpensePrefill,
  loggedBookingIds,
} from '../../../src/lib/bookings/expense.ts'

// e4-t06: what the 記一筆 form starts with from a booking's 「誰先付」

const lodging = {
  id: 'lg1',
  name: 'Queenstown Holiday Park',
  checkIn: '2026-12-20',
  checkOut: '2026-12-22',
  priceMinor: 18000,
  currency: 'NZD',
} as Lodging

const flight = {
  id: 'bk1',
  type: 'flight',
  title: 'NZ 878 SYD → ZQN',
  // 23:30 UTC on the 19th is already the 20th in Sydney (UTC+11)
  startAt: '2026-12-19T23:30:00.000Z',
  startTz: 'Australia/Sydney',
  priceMinor: 45000,
  currency: 'AUD',
  payerMemberId: 'mei',
} as Booking

describe('booking → expense prefill', () => {
  it('a lodging: price, lodging category, name, check-in date, payer, its id as bookingId', () => {
    expect(bookingExpensePrefill({ kind: 'lodging', lodging }, 'gene', 'Pacific/Auckland')).toEqual({
      amountMinor: 18000,
      currency: 'NZD',
      category: 'lodging',
      note: 'Queenstown Holiday Park',
      date: '2026-12-20',
      payerMemberId: 'gene',
      bookingId: 'lg1',
    })
  })

  it('a flight: transport, the local date where it leaves, the pool as payer', () => {
    expect(bookingExpensePrefill({ kind: 'booking', booking: flight }, 'pool', 'Pacific/Auckland')).toEqual({
      amountMinor: 45000,
      currency: 'AUD',
      category: 'transport',
      note: 'NZ 878 SYD → ZQN',
      date: '2026-12-20',
      payerMemberId: 'pool',
      bookingId: 'bk1',
    })
  })

  it('no price or date: left to the form', () => {
    const bare = { ...flight, priceMinor: null, startAt: null } as Booking
    expect(bookingExpensePrefill({ kind: 'booking', booking: bare }, 'mei', 'UTC')).toMatchObject({
      amountMinor: null,
      currency: null,
      date: null,
    })
  })

  it('categories by type', () => {
    expect(EXPENSE_CATEGORY_OF_BOOKING).toMatchObject({
      lodging: 'lodging',
      rental: 'transport',
      ferry: 'transport',
      activity: 'tickets',
    })
  })

  it('logged ids skip deleted and unlinked expenses', () => {
    expect(
      loggedBookingIds([
        { bookingId: 'bk1', deletedAt: null },
        { bookingId: 'bk2', deletedAt: '2026-12-01T00:00:00Z' },
        { bookingId: null, deletedAt: null },
      ]),
    ).toEqual(new Set(['bk1']))
  })
})

import type { Booking, Lodging } from '../../../shared/api/bookings.ts'
import type { ExpenseView } from '../../../shared/api/expenses.ts'
import type { BookingType } from '../../../shared/schema/booking.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import type { ExpenseInitial } from '../expenses/form.ts'
import { todayIn } from '../trip-groups.ts'

// 誰先付 → 記帳 (e4-t06): what the 記一筆 form starts with when a booking or lodging is logged as an
// expense — its price, a category from its type, its title as the note, its date, the member who
// paid first (or the pool) and the link back. A lodging has no column of its own on expenses, so
// its id goes into `bookingId` too (ids are unique across tables; the server does not check it).

/** Booking type → expense category */
export const EXPENSE_CATEGORY_OF_BOOKING: Record<BookingType | 'lodging', ExpenseCategory> = {
  lodging: 'lodging',
  flight: 'transport',
  rental: 'transport',
  driver: 'transport',
  ferry: 'transport',
  rail: 'transport',
  bus: 'transport',
  activity: 'tickets',
}

export type Bookable = { kind: 'lodging'; lodging: Lodging } | { kind: 'booking'; booking: Booking }

/** `payer` is a member id or the form's POOL value */
export function bookingExpensePrefill(
  item: Bookable,
  payer: string,
  tripTz: string,
): ExpenseInitial {
  if (item.kind === 'lodging') {
    const { lodging } = item
    const priced = lodging.priceMinor !== null && lodging.currency !== null
    return {
      amountMinor: priced ? lodging.priceMinor : null,
      currency: priced ? lodging.currency : null,
      category: EXPENSE_CATEGORY_OF_BOOKING.lodging,
      note: lodging.name,
      date: lodging.checkIn,
      payerMemberId: payer,
      bookingId: lodging.id,
    }
  }
  const { booking } = item
  const priced = booking.priceMinor !== null && booking.currency !== null
  const start = booking.startAt ? Date.parse(booking.startAt) : NaN
  return {
    amountMinor: priced ? booking.priceMinor : null,
    currency: priced ? booking.currency : null,
    category: EXPENSE_CATEGORY_OF_BOOKING[booking.type],
    note: booking.title,
    date: Number.isFinite(start) ? todayIn(booking.startTz ?? tripTz, start) : null,
    payerMemberId: payer,
    bookingId: booking.id,
  }
}

/** The bookings (and lodgings) that already have a live expense (GET /expenses has no filter) */
export function loggedBookingIds(
  expenses: readonly Pick<ExpenseView, 'bookingId' | 'deletedAt'>[],
): Set<string> {
  const ids = new Set<string>()
  for (const expense of expenses) if (expense.bookingId && !expense.deletedAt) ids.add(expense.bookingId)
  return ids
}

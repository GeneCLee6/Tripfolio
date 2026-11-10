import type { WishlistItemView } from '../../../shared/api/types.ts'
import type { ExpenseCategory } from '../../../shared/schema/expense.ts'
import type { WishlistCategory } from '../../../shared/schema/index.ts'

// 完成即記帳 (e5-t05, E5 需求「一鍵記帳」): what the 記一筆 form starts with when a pick is marked
// done — the estimated price, the item's name as the note, a category from the pick's, and the links
// back to the item and its stop. Pure, so the mapping is tested on its own.

/** Pick category → expense category */
export const EXPENSE_CATEGORY_OF_PICK: Record<WishlistCategory, ExpenseCategory> = {
  eat: 'food',
  buy: 'shopping',
  see: 'tickets',
  experience: 'tickets',
}

export interface ExpensePrefill {
  amountMinor: number | null
  /** The item's currency, or null to keep the form's own default */
  currency: string | null
  category: ExpenseCategory
  note: string
  wishlistItemId: string
  stopId: string | null
}

export function expensePrefill(
  item: Pick<WishlistItemView, 'id' | 'name' | 'category' | 'estMinor' | 'currency' | 'stopId'>,
): ExpensePrefill {
  const priced = item.estMinor !== null && item.currency !== null
  return {
    amountMinor: priced ? item.estMinor : null,
    currency: priced ? item.currency : null,
    category: EXPENSE_CATEGORY_OF_PICK[item.category],
    note: item.name,
    wishlistItemId: item.id,
    stopId: item.stopId,
  }
}
